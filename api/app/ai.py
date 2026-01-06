"""
AI 对话服务

功能:
- 聊天模式: 通用对话，无 RAG
- 问答模式: 基于书籍内容的 RAG 问答（可在同一对话中切换）
- SSE 流式响应
- Credits 计费
- 对话历史管理

API 端点:
- GET  /api/v1/ai/conversations          - 列出对话
- POST /api/v1/ai/conversations          - 创建对话
- GET  /api/v1/ai/conversations/{id}     - 获取对话详情
- DELETE /api/v1/ai/conversations/{id}   - 删除对话
- POST /api/v1/ai/conversations/{id}/messages - 发送消息（SSE 流式响应）
- GET  /api/v1/ai/models                 - 获取可用模型列表
"""

import asyncio
import json
import logging
import os
import time
import uuid
from typing import Optional

logger = logging.getLogger(__name__)

import redis
from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Path
from fastapi.responses import StreamingResponse
from prometheus_client import Counter, Histogram
from pydantic import BaseModel
from sqlalchemy import text

from .auth import require_user
from .db import engine
from .services.llm_provider import (
    ChatMessage,
    LLMProvider,
    LLMStreamChunk,
    LLMUsage,
    get_provider,
    SiliconFlowProvider,
)
from .services.llama_rag import search_book_chunks

router = APIRouter(prefix="/api/v1/ai", tags=["ai"])

# ============================================================================
# Metrics
# ============================================================================

AI_CHAT_LATENCY = Histogram("ai_chat_latency_seconds", "AI chat latency", ["mode"])
AI_CHAT_TOTAL = Counter("ai_chat_total", "Total AI chat requests", ["mode", "status"])
AI_TOKENS_CONSUMED = Counter("ai_tokens_consumed", "Tokens consumed", ["type"])

# ============================================================================
# Redis Cache
# ============================================================================

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
try:
    redis_client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
except Exception:
    redis_client = None

# ============================================================================
# Constants
# ============================================================================

# 系统提示词
SYSTEM_PROMPT_CHAT = """你是雅典娜 (Athena)，一个专业、友好的 AI 阅读助手。你可以帮助用户解答问题、进行对话、提供写作建议等。

请用简洁、专业的语言回答用户的问题。如果用户询问的是阅读相关的问题，你可以提供深入的见解和分析。"""

SYSTEM_PROMPT_QA = """你是雅典娜 (Athena)，一个专业的 AI 阅读助手。用户正在阅读以下书籍，请基于书籍内容和你的知识回答问题。

书籍信息:
{book_info}

相关内容 (来自书籍的原文摘录):
{rag_context}

重要指导:
1. 优先基于上述"相关内容"中的书籍原文回答问题
2. 如果原文中没有直接答案，可以结合你的知识进行分析
3. 引用书中内容时请标注来源
4. 用简洁、专业的语言回答"""

# 默认配置
DEFAULT_MODEL = os.getenv("DEFAULT_AI_MODEL", "Pro/deepseek-ai/DeepSeek-V3.2")
DEFAULT_MAX_TOKENS = 4096
DEFAULT_TEMPERATURE = 0.7

# Credits 成本 (每 1K tokens)
CREDITS_PER_1K_INPUT = 1  # 输入
CREDITS_PER_1K_OUTPUT = 2  # 输出


# ============================================================================
# Pydantic Models
# ============================================================================


class CreateConversationRequest(BaseModel):
    title: Optional[str] = None
    mode: str = "chat"  # chat 或 qa
    book_ids: Optional[list[str]] = None  # 问答模式关联的书籍


class SendMessageRequest(BaseModel):
    content: str
    mode: Optional[str] = None  # 可选的模式切换: chat 或 qa
    book_ids: Optional[list[str]] = None  # 问答模式的书籍 ID


class UpdateConversationRequest(BaseModel):
    title: Optional[str] = None
    mode: Optional[str] = None
    book_ids: Optional[list[str]] = None


# ============================================================================
# Helper Functions
# ============================================================================


def _sse_event(event_type: str, data: dict) -> bytes:
    """生成 SSE 事件"""
    payload = json.dumps({"type": event_type, **data}, ensure_ascii=False)
    return f"data: {payload}\n\n".encode("utf-8")


async def get_default_model_config():
    """获取默认模型配置"""
    async with engine.begin() as conn:
        # 先尝试获取默认模型
        result = await conn.execute(
            text(
                """
                SELECT provider, model_id, api_key_encrypted, endpoint,
                       input_price_per_1k, output_price_per_1k
                FROM ai_models
                WHERE is_default = true AND active = true
                LIMIT 1
                """
            )
        )
        row = result.fetchone()

        if not row:
            # 回退到任意激活的模型
            result = await conn.execute(
                text(
                    """
                    SELECT provider, model_id, api_key_encrypted, endpoint,
                           input_price_per_1k, output_price_per_1k
                    FROM ai_models
                    WHERE active = true
                    ORDER BY updated_at DESC
                    LIMIT 1
                    """
                )
            )
            row = result.fetchone()

        if not row:
            # 使用环境变量配置
            api_key = os.getenv("SILICONFLOW_API_KEY", "")
            if not api_key:
                raise HTTPException(status_code=503, detail="no_ai_model_configured")
            return {
                "provider": "siliconflow",
                "model_id": DEFAULT_MODEL,
                "api_key": api_key,
                "endpoint": None,
                "input_price": CREDITS_PER_1K_INPUT,
                "output_price": CREDITS_PER_1K_OUTPUT,
            }

        # 解密 API Key
        from .admin_ai import decrypt_api_key

        api_key = decrypt_api_key(row[2]) if row[2] else os.getenv("SILICONFLOW_API_KEY", "")

        return {
            "provider": row[0],
            "model_id": row[1],
            "api_key": api_key,
            "endpoint": row[3],
            "input_price": float(row[4]) if row[4] else CREDITS_PER_1K_INPUT,
            "output_price": float(row[5]) if row[5] else CREDITS_PER_1K_OUTPUT,
        }


async def get_book_info(book_id: str, user_id: str) -> Optional[dict]:
    """获取书籍信息"""
    async with engine.begin() as conn:
        result = await conn.execute(
            text(
                """
                SELECT title, author
                FROM books
                WHERE id = cast(:id as uuid) AND user_id = cast(:uid as uuid)
                """
            ),
            {"id": book_id, "uid": user_id},
        )
        row = result.fetchone()
        if row:
            return {"title": row[0] or "未知书名", "author": row[1] or "未知作者"}
        return None


async def check_credits(user_id: str, estimated_tokens: int = 1000) -> bool:
    """检查用户 Credits 是否足够"""
    # 【开发模式】跳过 Credits 检查，允许 AI 功能测试
    dev_mode = os.getenv("DEV_MODE", "false").lower() == "true"
    if dev_mode:
        return True
    
    # 预估成本
    estimated_cost = (estimated_tokens / 1000) * (CREDITS_PER_1K_INPUT + CREDITS_PER_1K_OUTPUT)

    async with engine.begin() as conn:
        result = await conn.execute(
            text(
                """
                SELECT COALESCE(balance, 0) + COALESCE(wallet_amount, 0) * 100 as total_credits
                FROM credit_accounts
                WHERE owner_id = cast(:uid as uuid)
                """
            ),
            {"uid": user_id},
        )
        row = result.fetchone()
        total_credits = row[0] if row else 0

        # 允许一定的容差
        return total_credits >= estimated_cost * 0.8


async def deduct_credits(user_id: str, usage: LLMUsage, model_config: dict) -> int:
    """扣除 Credits"""
    input_cost = (usage.prompt_tokens / 1000) * model_config["input_price"]
    output_cost = (usage.completion_tokens / 1000) * model_config["output_price"]
    total_cost = int(input_cost + output_cost)

    if total_cost <= 0:
        return 0

    async with engine.begin() as conn:
        # 扣除 Credits
        await conn.execute(
            text(
                """
                UPDATE credit_accounts
                SET balance = GREATEST(0, balance - :cost),
                    updated_at = now()
                WHERE owner_id = cast(:uid as uuid)
                """
            ),
            {"uid": user_id, "cost": total_cost},
        )

        # 记录流水
        await conn.execute(
            text(
                """
                INSERT INTO credit_ledger (id, owner_id, amount, currency, direction, reason, created_at)
                VALUES (gen_random_uuid(), cast(:uid as uuid), :amount, 'CREDITS', 'debit', 'AI Chat', now())
                """
            ),
            {"uid": user_id, "amount": -total_cost},
        )

    AI_TOKENS_CONSUMED.labels(type="prompt").inc(usage.prompt_tokens)
    AI_TOKENS_CONSUMED.labels(type="completion").inc(usage.completion_tokens)

    return total_cost


async def get_conversation_history(
    conversation_id: str, user_id: str, limit: int = 20
) -> list[ChatMessage]:
    """获取对话历史"""
    async with engine.begin() as conn:
        result = await conn.execute(
            text(
                """
                SELECT role, content
                FROM ai_messages
                WHERE conversation_id = cast(:cid as uuid) AND owner_id = cast(:uid as uuid)
                ORDER BY created_at DESC
                LIMIT :limit
                """
            ),
            {"cid": conversation_id, "uid": user_id, "limit": limit},
        )
        rows = result.fetchall()

        # 反转顺序（从旧到新）
        messages = [ChatMessage(role=r[0], content=r[1]) for r in reversed(rows)]
        return messages


async def save_message(
    conversation_id: str, user_id: str, role: str, content: str
) -> str:
    """保存消息"""
    message_id = str(uuid.uuid4())
    async with engine.begin() as conn:
        await conn.execute(
            text(
                """
                INSERT INTO ai_messages (id, conversation_id, owner_id, role, content, created_at)
                VALUES (cast(:id as uuid), cast(:cid as uuid), cast(:uid as uuid), :role, :content, now())
                """
            ),
            {
                "id": message_id,
                "cid": conversation_id,
                "uid": user_id,
                "role": role,
                "content": content,
            },
        )

        # 更新对话时间
        await conn.execute(
            text(
                """
                UPDATE ai_conversations
                SET updated_at = now()
                WHERE id = cast(:cid as uuid)
                """
            ),
            {"cid": conversation_id},
        )

    return message_id


# ============================================================================
# API Endpoints
# ============================================================================


@router.get("/models")
async def list_available_models(auth=Depends(require_user)):
    """获取可用的 AI 模型列表"""
    async with engine.begin() as conn:
        result = await conn.execute(
            text(
                """
                SELECT id::text, provider, model_id, display_name, is_default,
                       context_window, capabilities
                FROM ai_models
                WHERE active = true
                ORDER BY is_default DESC, display_name ASC
                """
            )
        )
        rows = result.fetchall()

        return {
            "status": "success",
            "data": [
                {
                    "id": r[0],
                    "provider": r[1],
                    "model_id": r[2],
                    "display_name": r[3],
                    "is_default": r[4],
                    "context_window": r[5],
                    "capabilities": r[6] or ["chat"],
                }
                for r in rows
            ],
        }


@router.get("/conversations")
async def list_conversations(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    auth=Depends(require_user),
):
    """列出用户的对话历史"""
    user_id, _ = auth
    async with engine.begin() as conn:
        result = await conn.execute(
            text(
                """
                SELECT c.id::text, c.title, c.created_at, c.updated_at,
                       ctx.mode, ctx.book_ids
                FROM ai_conversations c
                LEFT JOIN ai_conversation_contexts ctx ON c.id = ctx.conversation_id
                WHERE c.owner_id = cast(:uid as uuid)
                ORDER BY COALESCE(c.updated_at, c.created_at) DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"uid": user_id, "limit": limit, "offset": offset},
        )
        rows = result.fetchall()

        # 统计总数
        count_result = await conn.execute(
            text(
                "SELECT COUNT(*) FROM ai_conversations WHERE owner_id = cast(:uid as uuid)"
            ),
            {"uid": user_id},
        )
        total = count_result.scalar()

        return {
            "status": "success",
            "data": [
                {
                    "id": r[0],
                    "title": r[1] or "未命名对话",
                    "created_at": str(r[2]) if r[2] else None,
                    "updated_at": str(r[3]) if r[3] else None,
                    "mode": r[4] or "chat",
                    "book_ids": r[5] or [],
                }
                for r in rows
            ],
            "pagination": {
                "total": total,
                "limit": limit,
                "offset": offset,
            },
        }


@router.post("/conversations")
async def create_conversation(
    body: CreateConversationRequest = Body(...),
    auth=Depends(require_user),
):
    """创建新对话"""
    user_id, _ = auth
    conversation_id = str(uuid.uuid4())
    title = body.title or ""

    async with engine.begin() as conn:
        # 创建对话
        await conn.execute(
            text(
                """
                INSERT INTO ai_conversations (id, owner_id, title, created_at, updated_at)
                VALUES (cast(:id as uuid), cast(:uid as uuid), :title, now(), now())
                """
            ),
            {"id": conversation_id, "uid": user_id, "title": title},
        )

        # 创建上下文
        await conn.execute(
            text(
                """
                INSERT INTO ai_conversation_contexts (conversation_id, owner_id, mode, book_ids, updated_at)
                VALUES (cast(:cid as uuid), cast(:uid as uuid), :mode, cast(:book_ids as jsonb), now())
                ON CONFLICT (conversation_id) DO UPDATE
                SET mode = EXCLUDED.mode, book_ids = EXCLUDED.book_ids, updated_at = now()
                """
            ),
            {
                "cid": conversation_id,
                "uid": user_id,
                "mode": body.mode,
                "book_ids": json.dumps(body.book_ids or []),
            },
        )

    return {
        "status": "success",
        "data": {"id": conversation_id},
    }


@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: str = Path(...),
    auth=Depends(require_user),
):
    """获取对话详情（包含消息历史）"""
    user_id, _ = auth

    async with engine.begin() as conn:
        # 获取对话信息
        result = await conn.execute(
            text(
                """
                SELECT c.id::text, c.title, c.created_at, c.updated_at,
                       ctx.mode, ctx.book_ids
                FROM ai_conversations c
                LEFT JOIN ai_conversation_contexts ctx ON c.id = ctx.conversation_id
                WHERE c.id = cast(:cid as uuid) AND c.owner_id = cast(:uid as uuid)
                """
            ),
            {"cid": conversation_id, "uid": user_id},
        )
        conv = result.fetchone()

        if not conv:
            raise HTTPException(status_code=404, detail="not_found")

        # 获取消息
        messages_result = await conn.execute(
            text(
                """
                SELECT id::text, role, content, created_at
                FROM ai_messages
                WHERE conversation_id = cast(:cid as uuid) AND owner_id = cast(:uid as uuid)
                ORDER BY created_at ASC
                """
            ),
            {"cid": conversation_id, "uid": user_id},
        )
        messages = messages_result.fetchall()

        return {
            "status": "success",
            "data": {
                "id": conv[0],
                "title": conv[1] or "未命名对话",
                "created_at": str(conv[2]) if conv[2] else None,
                "updated_at": str(conv[3]) if conv[3] else None,
                "mode": conv[4] or "chat",
                "book_ids": conv[5] or [],
                "messages": [
                    {
                        "id": m[0],
                        "role": m[1],
                        "content": m[2],
                        "created_at": str(m[3]) if m[3] else None,
                    }
                    for m in messages
                ],
            },
        }


@router.patch("/conversations/{conversation_id}")
async def update_conversation(
    conversation_id: str = Path(...),
    body: UpdateConversationRequest = Body(...),
    auth=Depends(require_user),
):
    """更新对话信息"""
    user_id, _ = auth

    async with engine.begin() as conn:
        # 检查对话是否存在
        result = await conn.execute(
            text(
                """
                SELECT id FROM ai_conversations
                WHERE id = cast(:cid as uuid) AND owner_id = cast(:uid as uuid)
                """
            ),
            {"cid": conversation_id, "uid": user_id},
        )
        if not result.fetchone():
            raise HTTPException(status_code=404, detail="not_found")

        # 更新对话标题
        if body.title is not None:
            await conn.execute(
                text(
                    """
                    UPDATE ai_conversations
                    SET title = :title, updated_at = now()
                    WHERE id = cast(:cid as uuid)
                    """
                ),
                {"cid": conversation_id, "title": body.title},
            )

        # 更新上下文
        if body.mode is not None or body.book_ids is not None:
            updates = []
            params = {"cid": conversation_id, "uid": user_id}

            if body.mode is not None:
                updates.append("mode = :mode")
                params["mode"] = body.mode

            if body.book_ids is not None:
                updates.append("book_ids = cast(:book_ids as jsonb)")
                params["book_ids"] = json.dumps(body.book_ids)

            if updates:
                updates.append("updated_at = now()")
                await conn.execute(
                    text(
                        f"""
                        INSERT INTO ai_conversation_contexts (conversation_id, owner_id, mode, book_ids, updated_at)
                        VALUES (cast(:cid as uuid), cast(:uid as uuid), 'chat', '[]', now())
                        ON CONFLICT (conversation_id) DO UPDATE
                        SET {', '.join(updates)}
                        """
                    ),
                    params,
                )

    return {"status": "success"}


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str = Path(...),
    auth=Depends(require_user),
):
    """删除对话"""
    user_id, _ = auth

    async with engine.begin() as conn:
        # 删除消息
        await conn.execute(
            text(
                """
                DELETE FROM ai_messages
                WHERE conversation_id = cast(:cid as uuid) AND owner_id = cast(:uid as uuid)
                """
            ),
            {"cid": conversation_id, "uid": user_id},
        )

        # 删除上下文
        await conn.execute(
            text(
                """
                DELETE FROM ai_conversation_contexts
                WHERE conversation_id = cast(:cid as uuid)
                """
            ),
            {"cid": conversation_id},
        )

        # 删除对话
        result = await conn.execute(
            text(
                """
                DELETE FROM ai_conversations
                WHERE id = cast(:cid as uuid) AND owner_id = cast(:uid as uuid)
                RETURNING id
                """
            ),
            {"cid": conversation_id, "uid": user_id},
        )

        if not result.fetchone():
            raise HTTPException(status_code=404, detail="not_found")

    return {"status": "success"}


@router.post("/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: str = Path(...),
    body: SendMessageRequest = Body(...),
    auth=Depends(require_user),
):
    """
    发送消息并获取 AI 回复（SSE 流式响应）

    SSE 事件格式:
    - {"type": "delta", "content": "..."} - 增量内容
    - {"type": "usage", "prompt_tokens": N, "completion_tokens": N} - Token 使用
    - {"type": "credits", "deducted": N} - Credits 扣除
    - {"type": "done"} - 完成
    - {"type": "error", "message": "..."} - 错误
    """
    user_id, _ = auth
    user_content = body.content.strip()

    if not user_content:
        raise HTTPException(status_code=400, detail="empty_message")

    # 验证对话存在
    async with engine.begin() as conn:
        result = await conn.execute(
            text(
                """
                SELECT c.id, ctx.mode, ctx.book_ids
                FROM ai_conversations c
                LEFT JOIN ai_conversation_contexts ctx ON c.id = ctx.conversation_id
                WHERE c.id = cast(:cid as uuid) AND c.owner_id = cast(:uid as uuid)
                """
            ),
            {"cid": conversation_id, "uid": user_id},
        )
        conv = result.fetchone()

        if not conv:
            raise HTTPException(status_code=404, detail="conversation_not_found")

        # 确定模式（请求中的模式优先）
        mode = body.mode or conv[1] or "chat"
        book_ids = body.book_ids or conv[2] or []

        # 如果模式发生变化，更新上下文
        if body.mode and body.mode != conv[1]:
            await conn.execute(
                text(
                    """
                    UPDATE ai_conversation_contexts
                    SET mode = :mode, updated_at = now()
                    WHERE conversation_id = cast(:cid as uuid)
                    """
                ),
                {"cid": conversation_id, "mode": body.mode},
            )

    # 检查 Credits
    has_credits = await check_credits(user_id)
    if not has_credits:
        raise HTTPException(status_code=402, detail="insufficient_credits")

    # 获取模型配置
    try:
        model_config = await get_default_model_config()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail="ai_service_unavailable")

    async def generate_response():
        start_time = time.time()
        full_response = ""

        try:
            # 保存用户消息
            await save_message(conversation_id, user_id, "user", user_content)

            # 构建消息历史
            history = await get_conversation_history(conversation_id, user_id)

            # 构建系统提示词
            if mode == "qa" and book_ids:
                # 问答模式：执行向量搜索获取 RAG 上下文
                logger.info(f"[AI] QA mode with books: {book_ids}")
                
                # 获取书籍基本信息
                book_info_parts = []
                for bid in book_ids[:5]:  # 最多5本书
                    info = await get_book_info(bid, user_id)
                    if info:
                        book_info_parts.append(f"- 《{info['title']}》 by {info['author']}")
                book_info = "\n".join(book_info_parts) if book_info_parts else "未知书籍"
                
                # 执行向量搜索获取相关内容
                try:
                    search_results = await search_book_chunks(
                        query=user_content,
                        book_ids=book_ids,
                        user_id=user_id,
                        top_k=10
                    )
                    
                    if search_results:
                        rag_parts = []
                        for i, chunk in enumerate(search_results, 1):
                            page_info = f" (第{chunk['page']}页)" if chunk.get('page') else ""
                            rag_parts.append(f"[{i}]{page_info} {chunk['content'][:500]}")
                        rag_context = "\n\n".join(rag_parts)
                        logger.info(f"[AI] Found {len(search_results)} RAG chunks")
                    else:
                        rag_context = "未找到相关内容，请基于你的知识回答。"
                        logger.warning(f"[AI] No RAG chunks found for query: {user_content[:50]}")
                except Exception as e:
                    logger.error(f"[AI] Vector search failed: {e}")
                    rag_context = "向量搜索失败，请基于你的知识回答。"
                
                system_prompt = SYSTEM_PROMPT_QA.format(
                    book_info=book_info,
                    rag_context=rag_context
                )
            else:
                system_prompt = SYSTEM_PROMPT_CHAT

            # 构建完整消息列表
            messages = [ChatMessage(role="system", content=system_prompt)]
            messages.extend(history)
            messages.append(ChatMessage(role="user", content=user_content))

            # 获取 LLM Provider
            provider = get_provider(
                model_config["provider"],
                model_config["api_key"],
                model_config["endpoint"],
            )

            # 流式调用 LLM
            last_usage: Optional[LLMUsage] = None

            async for chunk in provider.chat_stream(
                messages=messages,
                model=model_config["model_id"],
                temperature=DEFAULT_TEMPERATURE,
                max_tokens=DEFAULT_MAX_TOKENS,
            ):
                if chunk.type == "delta" and chunk.content:
                    full_response += chunk.content
                    yield _sse_event("delta", {"content": chunk.content})

                elif chunk.type == "usage" and chunk.usage:
                    last_usage = chunk.usage
                    yield _sse_event(
                        "usage",
                        {
                            "prompt_tokens": chunk.usage.prompt_tokens,
                            "completion_tokens": chunk.usage.completion_tokens,
                            "total_tokens": chunk.usage.total_tokens,
                        },
                    )

                elif chunk.type == "error":
                    AI_CHAT_TOTAL.labels(mode=mode, status="error").inc()
                    yield _sse_event("error", {"message": chunk.error or "Unknown error"})
                    return

                elif chunk.type == "done":
                    break

            # 保存 AI 回复
            if full_response:
                await save_message(conversation_id, user_id, "assistant", full_response)

                # 更新对话标题（如果是第一条消息）
                async with engine.begin() as conn:
                    result = await conn.execute(
                        text(
                            """
                            SELECT title FROM ai_conversations
                            WHERE id = cast(:cid as uuid)
                            """
                        ),
                        {"cid": conversation_id},
                    )
                    row = result.fetchone()
                    if row and not row[0]:
                        # 用用户的第一条消息作为标题
                        title = user_content[:50] + ("..." if len(user_content) > 50 else "")
                        await conn.execute(
                            text(
                                """
                                UPDATE ai_conversations
                                SET title = :title
                                WHERE id = cast(:cid as uuid)
                                """
                            ),
                            {"cid": conversation_id, "title": title},
                        )

            # 扣除 Credits
            if last_usage:
                credits_deducted = await deduct_credits(user_id, last_usage, model_config)
                yield _sse_event("credits", {"deducted": credits_deducted})

            # 记录延迟
            latency = time.time() - start_time
            AI_CHAT_LATENCY.labels(mode=mode).observe(latency)
            AI_CHAT_TOTAL.labels(mode=mode, status="success").inc()

            yield _sse_event("done", {})

        except Exception as e:
            AI_CHAT_TOTAL.labels(mode=mode, status="error").inc()
            yield _sse_event("error", {"message": str(e)})

    return StreamingResponse(
        generate_response(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 禁用 Nginx 缓冲
        },
    )


# ============================================================================
# Legacy Compatibility (旧接口兼容)
# ============================================================================


@router.get("/stream")
async def stream_legacy(
    prompt: str = Query(""),
    conversation_id: Optional[str] = Query(None),
    access_token: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """
    旧版 SSE 流式接口（向后兼容）

    建议使用新接口: POST /api/v1/ai/conversations/{id}/messages
    """
    if access_token:
        authorization = "Bearer " + access_token

    try:
        user_id, _ = require_user(authorization)
    except Exception:
        raise HTTPException(status_code=401, detail="unauthorized")

    # 如果没有 conversation_id，创建一个新对话
    if not conversation_id:
        conversation_id = str(uuid.uuid4())
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    """
                    INSERT INTO ai_conversations (id, owner_id, title, created_at)
                    VALUES (cast(:id as uuid), cast(:uid as uuid), :title, now())
                    """
                ),
                {"id": conversation_id, "uid": user_id, "title": prompt[:32]},
            )
            await conn.execute(
                text(
                    """
                    INSERT INTO ai_conversation_contexts (conversation_id, owner_id, mode, book_ids, updated_at)
                    VALUES (cast(:cid as uuid), cast(:uid as uuid), 'chat', '[]', now())
                    ON CONFLICT (conversation_id) DO NOTHING
                    """
                ),
                {"cid": conversation_id, "uid": user_id},
            )

    # 调用新接口
    body = SendMessageRequest(content=prompt or "Hello", mode="chat")

    # 模拟 auth
    class FakeAuth:
        pass

    auth = (user_id, None)

    return await send_message(conversation_id, body, auth)


@router.get("/messages")
async def list_messages_legacy(
    conversation_id: str = Query(...),
    auth=Depends(require_user),
):
    """旧版消息列表接口（向后兼容）"""
    user_id, _ = auth
    async with engine.begin() as conn:
        result = await conn.execute(
            text(
                """
                SELECT role, content, created_at
                FROM ai_messages
                WHERE owner_id = cast(:uid as uuid) AND conversation_id = cast(:cid as uuid)
                ORDER BY created_at ASC
                """
            ),
            {"uid": user_id, "cid": conversation_id},
        )
        rows = result.fetchall()
        return {
            "status": "success",
            "data": [
                {"role": r[0], "content": r[1], "created_at": str(r[2])} for r in rows
            ],
        }

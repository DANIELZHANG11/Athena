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
from .services.llama_rag import search_book_chunks, search_user_notes

try:
    import tiktoken
except ImportError:
    tiktoken = None
    logger.warning("[AI] tiktoken not installed, falling back to character-based estimation")

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

{user_notes_context}

重要指导:
1. 优先基于上述"相关内容"中的书籍原文回答问题
2. 如果用户有相关笔记，也可以参考用户的笔记内容
3. 如果原文中没有直接答案，可以结合你的知识进行分析
4. 引用书中内容时请标注来源（如 [1] 第X页）
5. 用简洁、专业的语言回答"""

# 查询重写提示词 - 用于将含有指代词的问题改写为完整的搜索查询
SYSTEM_PROMPT_QUERY_REWRITE = """你是一个查询重写助手。你的任务是将用户的当前问题改写为一个完整的、独立的搜索查询。

规则：
1. 如果当前问题包含指代词（如"他"、"她"、"它"、"这本书"、"上面提到的"等），根据对话历史将其替换为具体内容
2. 保持问题的核心意图不变
3. 只输出改写后的查询，不要有任何解释
4. 如果问题已经是完整的，直接输出原问题
5. 输出应该简洁，适合用于向量搜索

示例：
对话历史：
用户: 《读书毁了我》这本书的作者是谁？
助手: 这本书的作者是王强。

当前问题: 他还写过什么书？
改写后: 王强还写过什么书"""

# 默认配置
DEFAULT_MODEL = os.getenv("DEFAULT_AI_MODEL", "Pro/deepseek-ai/DeepSeek-V3.2")
DEFAULT_MAX_TOKENS = 4096
DEFAULT_TEMPERATURE = 0.7

# Credits 成本 (每 1K tokens)
CREDITS_PER_1K_INPUT = 1  # 输入
CREDITS_PER_1K_OUTPUT = 2  # 输出

# RAG 动态配置
RAG_MAX_BOOKS = 50  # 最大支持的书籍数量（书架可能包含很多书）
RAG_MAX_CITATIONS = 15  # 最大引用数量（发送给 LLM 的上下文）


def calculate_dynamic_top_k(query: str, book_count: int) -> int:
    """
    根据问题复杂度和书籍数量动态计算 top_k
    
    【行业最佳实践】动态调整 RAG 检索数量：
    - 问题复杂度：根据问题长度和关键词判断
    - 书籍数量：多书籍场景需要保证每本书有代表性内容
    - 总量限制：防止 Token 爆炸
    
    Args:
        query: 用户问题
        book_count: 参与搜索的书籍数量
    
    Returns:
        top_k: 检索结果数量
    """
    # 基础 top_k
    base_top_k = 5
    
    # 1. 根据问题复杂度调整
    query_len = len(query)
    if query_len > 100:
        # 长问题通常需要更多上下文
        base_top_k += 3
    elif query_len > 50:
        base_top_k += 1
    
    # 复杂问题关键词
    complex_keywords = ['比较', '对比', '区别', '相同', '不同', '分析', '总结', 
                        'compare', 'contrast', 'difference', 'similar', 'analyze']
    if any(kw in query.lower() for kw in complex_keywords):
        base_top_k += 2
    
    # 2. 根据书籍数量调整（多书籍场景）
    if book_count > 10:
        # 多书籍：确保每本书至少有机会被引用
        # 但总量不超过 RAG_MAX_CITATIONS
        per_book = max(1, RAG_MAX_CITATIONS // book_count)
        base_top_k = min(book_count * per_book, RAG_MAX_CITATIONS)
    elif book_count > 5:
        # 中等数量：每本书2条
        base_top_k = min(book_count * 2, 12)
    elif book_count > 1:
        # 少量多书：每本书3条
        base_top_k = min(book_count * 3, 10)
    
    # 3. 总量限制
    return min(base_top_k, RAG_MAX_CITATIONS)


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
    shelf_ids: Optional[list[str]] = None  # 问答模式的书架 ID（会扩展为书架中的所有书籍）


class SourceReference(BaseModel):
    """QA模式下的引用来源"""
    book_id: str
    book_title: str
    content: str
    page: Optional[int] = None
    chapter: Optional[str] = None
    score: float


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
    """获取书籍信息（包括 content_sha256 用于向量搜索）"""
    async with engine.begin() as conn:
        result = await conn.execute(
            text(
                """
                SELECT title, author, content_sha256
                FROM books
                WHERE id = cast(:id as uuid) AND user_id = cast(:uid as uuid)
                """
            ),
            {"id": book_id, "uid": user_id},
        )
        row = result.fetchone()
        if row:
            return {
                "id": book_id,
                "title": row[0] or "未知书名", 
                "author": row[1] or "未知作者",
                "content_sha256": row[2]  # 用于向量搜索匹配
            }
        return None


async def get_books_info_by_sha256(content_sha256_list: list[str], user_id: str) -> dict[str, dict]:
    """根据content_sha256获取书籍信息映射"""
    if not content_sha256_list:
        return {}
    
    async with engine.begin() as conn:
        # 构建IN子句
        placeholders = ", ".join([f":sha_{i}" for i in range(len(content_sha256_list))])
        params = {f"sha_{i}": sha for i, sha in enumerate(content_sha256_list)}
        params["uid"] = user_id
        
        result = await conn.execute(
            text(
                f"""
                SELECT id, title, author, content_sha256
                FROM books
                WHERE content_sha256 IN ({placeholders}) AND user_id = cast(:uid as uuid)
                """
            ),
            params,
        )
        rows = result.fetchall()
        
        # 构建 sha256 -> book_info 映射
        return {
            row[3]: {
                "id": str(row[0]),
                "title": row[1] or "未知书名",
                "author": row[2] or "未知作者",
            }
            for row in rows
        }


async def get_books_from_shelves(shelf_ids: list[str], user_id: str) -> list[str]:
    """
    获取书架中的所有书籍ID
    
    Args:
        shelf_ids: 书架ID列表
        user_id: 用户ID
    
    Returns:
        书籍ID列表（去重）
    """
    if not shelf_ids:
        return []
    
    async with engine.begin() as conn:
        # 构建IN子句
        placeholders = ", ".join([f":shelf_{i}" for i in range(len(shelf_ids))])
        params = {f"shelf_{i}": sid for i, sid in enumerate(shelf_ids)}
        params["uid"] = user_id
        
        result = await conn.execute(
            text(
                f"""
                SELECT DISTINCT sb.book_id::text
                FROM shelf_books sb
                INNER JOIN shelves s ON sb.shelf_id = s.id
                WHERE sb.shelf_id IN ({placeholders}) 
                  AND s.user_id = cast(:uid as uuid)
                  AND sb.book_id IS NOT NULL
                """
            ),
            params,
        )
        rows = result.fetchall()
        return [row[0] for row in rows if row[0]]


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
    conversation_id: str, user_id: str, role: str, content: str, citations: list = None
) -> str:
    """保存消息"""
    import json
    message_id = str(uuid.uuid4())
    async with engine.begin() as conn:
        await conn.execute(
            text(
                """
                INSERT INTO ai_messages (id, conversation_id, owner_id, role, content, citations, created_at)
                VALUES (cast(:id as uuid), cast(:cid as uuid), cast(:uid as uuid), :role, :content, :citations, now())
                """
            ),
            {
                "id": message_id,
                "cid": conversation_id,
                "uid": user_id,
                "role": role,
                "content": content,
                "citations": json.dumps(citations) if citations else None,
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


def estimate_tokens(text: str) -> int:
    """
    估算文本的token数量
    
    优先使用tiktoken（精确），fallback到字符估算
    """
    if tiktoken:
        try:
            enc = tiktoken.get_encoding("cl100k_base")  # GPT-4/DeepSeek通用
            return len(enc.encode(text))
        except Exception as e:
            logger.warning(f"[AI] tiktoken encoding failed: {e}, using character estimation")
    
    # Fallback: 字符估算（中文约1 char = 1 token，英文约4 chars = 1 token）
    # 使用混合比例：假设50%中文50%英文
    return int(len(text) * 0.75)


def truncate_history_by_tokens(
    history: list[ChatMessage],
    max_tokens: int = 8000,
) -> list[ChatMessage]:
    """
    按token数量智能截断历史对话
    
    【行业最佳实践】参考LangChain ConversationBufferWindowMemory
    
    策略：
    1. 从最新消息开始倒序计算token
    2. 超过max_tokens时停止
    3. 始终保留至少最近1轮对话（2条消息）
    
    Args:
        history: 对话历史
        max_tokens: 最大token数（默认8000，行业标准）
    
    Returns:
        截断后的历史对话
    """
    if not history:
        return history
    
    truncated = []
    total_tokens = 0
    
    # 从最新消息开始倒序遍历
    for msg in reversed(history):
        msg_tokens = estimate_tokens(msg.content)
        
        # 如果加上这条消息会超过上限，且已经有至少2条消息（1轮对话），则停止
        if total_tokens + msg_tokens > max_tokens and len(truncated) >= 2:
            break
        
        truncated.insert(0, msg)  # 插入到开头保持顺序
        total_tokens += msg_tokens
    
    # 日志记录截断情况
    if len(truncated) < len(history):
        logger.info(
            f"[AI] History truncated: {len(history)} -> {len(truncated)} messages "
            f"({total_tokens} tokens, max={max_tokens})"
        )
    
    return truncated


async def compress_conversation_summary(
    history: list[ChatMessage],
    model_config: dict,
    compression_threshold: int = 10,
) -> list[ChatMessage]:
    """
    对话摘要压缩
    
    【行业最佳实践】参考LangChain ConversationSummaryMemory
    OpenAI/Perplexity等巨头使用的策略：
    - 10轮对话后，将前8轮压缩为摘要
    - 只保留最近2轮完整对话
    - 节省约90% tokens
    
    Args:
        history: 对话历史
        model_config: 模型配置
        compression_threshold: 触发压缩的轮数阈值（默认10轮=20条消息）
    
    Returns:
        压缩后的历史（摘要 + 最近完整对话）
    """
    # 对话轮数 = 消息数 / 2
    conversation_rounds = len(history) // 2
    
    if conversation_rounds < compression_threshold:
        # 未达到压缩阈值，直接返回
        return history
    
    try:
        # 保留最近2轮对话（4条消息）
        recent_messages = history[-4:] if len(history) >= 4 else history
        
        # 需要压缩的旧对话
        old_messages = history[:-4] if len(history) > 4 else []
        
        if not old_messages:
            return history
        
        # 构建摘要请求
        conversation_text = "\n".join([
            f"{msg.role}: {msg.content[:200]}..."
            for msg in old_messages
        ])
        
        summary_prompt = f"""请将以下对话历史压缩为一个简洁的摘要（约200字以内），保留关键信息：

{conversation_text}

摘要："""
        
        # 调用LLM生成摘要
        provider = get_provider(
            model_config["provider"],
            model_config["api_key"],
            model_config["endpoint"],
        )
        
        summary_content = ""
        async for chunk in provider.chat_stream(
            messages=[ChatMessage(role="user", content=summary_prompt)],
            model=model_config["model_id"],
            temperature=0.3,  # 低温度确保摘要稳定
            max_tokens=300,
        ):
            if chunk.type == "delta" and chunk.content:
                summary_content += chunk.content
            elif chunk.type == "done":
                break
        
        if summary_content:
            # 构建压缩后的历史：摘要 + 最近完整对话
            compressed_history = [
                ChatMessage(role="system", content=f"[对话历史摘要] {summary_content.strip()}"),
            ] + recent_messages
            
            logger.info(
                f"[AI] Conversation compressed: {len(history)} -> {len(compressed_history)} messages "
                f"(saved ~{len(old_messages)} messages)"
            )
            
            return compressed_history
        else:
            return history
            
    except Exception as e:
        logger.error(f"[AI] Conversation compression failed: {e}")
        return history  # 失败时返回原始历史


async def rewrite_query_with_context(
    current_query: str,
    history: list[ChatMessage],
    model_config: dict,
) -> str:
    """
    使用 LLM 重写查询，解决指代词问题
    
    当用户问"他还写过什么书"时，根据历史对话改写为"王强还写过什么书"
    
    Args:
        current_query: 当前用户问题
        history: 对话历史
        model_config: 模型配置
    
    Returns:
        重写后的查询（用于向量搜索）
    """
    # 如果没有历史对话，直接返回原问题
    if not history or len(history) < 2:
        return current_query
    
    # 只取最近4轮对话（8条消息）作为上下文，避免 token 过多
    recent_history = history[-8:] if len(history) > 8 else history
    
    # 【2026-01-16 优化】智能跳过逻辑 - 基于行业最佳实践
    # 参考：避免不必要的LLM调用，节省0.5-2秒延迟
    
    # 检测1：查询很长（>30字符），可能是完整问题
    if len(current_query.strip()) > 30:
        logger.info(f"[AI] Query rewrite skipped: query too long (>30 chars), likely complete")
        return current_query
    
    # 检测2：包含疑问词 + 较长查询（>10字符）= 完整问题
    question_markers = {
        'zh': ['什么', '为什么', '为何', '怎么', '如何', '哪', '谁', '几', '多少'],
        'en': ['what', 'why', 'how', 'when', 'where', 'who', 'which'],
        'fr': ['quoi', 'pourquoi', 'comment', 'quand', 'où', 'qui'],
        'de': ['was', 'warum', 'wie', 'wann', 'wo', 'wer'],
        'ja': ['何', 'なぜ', 'どう', 'いつ', 'どこ', '誰'],
        # DeepSeek V3.2支持50+语言，LLM会自动处理其他语言
    }
    
    has_question_marker = any(
        marker in current_query.lower()
        for markers in question_markers.values()
        for marker in markers
    )
    
    if has_question_marker and len(current_query) > 10:
        logger.info(f"[AI] Query rewrite skipped: complete question with question marker")
        return current_query
    
    # 检测3：查询太短（<5字符），可能是简单追问，需要rewrite
    # 例如："他呢？"、"Why?"等
    if len(current_query.strip()) < 5:
        # 继续执行rewrite
        pass

    # 构建对话历史文本
    history_text_parts = []
    for msg in recent_history:
        role_label = "用户" if msg.role == "user" else "助手"
        # 截断过长的消息
        content = msg.content[:200] + "..." if len(msg.content) > 200 else msg.content
        history_text_parts.append(f"{role_label}: {content}")
    
    history_text = "\n".join(history_text_parts)
    
    # 构建重写请求
    rewrite_prompt = f"""对话历史：
{history_text}

当前问题: {current_query}
改写后:"""
    
    start_time = time.time()
    try:
        # 【优化】设置超时时间，防止阻塞
        provider = get_provider(
            model_config["provider"],
            model_config["api_key"],
            model_config["endpoint"],
        )
        
        messages = [
            ChatMessage(role="system", content=SYSTEM_PROMPT_QUERY_REWRITE),
            ChatMessage(role="user", content=rewrite_prompt),
        ]
        
        # 使用非流式调用，快速获取结果
        rewritten_query = ""
        async for chunk in provider.chat_stream(
            messages=messages,
            model=model_config["model_id"],
            temperature=0.1,  # 低温度，确保输出稳定
            max_tokens=200,   # 查询重写不需要太长
        ):
            if chunk.type == "delta" and chunk.content:
                rewritten_query += chunk.content
            elif chunk.type == "done":
                break
        
        rewritten_query = rewritten_query.strip()
        
        if rewritten_query:
            logger.info(f"[AI] Query rewrite: '{current_query[:30]}...' -> '{rewritten_query[:30]}...' (took {time.time() - start_time:.2f}s)")
            return rewritten_query
        else:
            return current_query
            
    except Exception as e:
        logger.warning(f"[AI] Query rewrite failed (took {time.time() - start_time:.2f}s): {e}, using original query")
        return current_query


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
                SELECT id::text, role, content, citations, created_at
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
                        "citations": m[3] if m[3] else None,
                        "created_at": str(m[4]) if m[4] else None,
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
        book_ids = list(body.book_ids or conv[2] or [])
        shelf_ids = list(body.shelf_ids or [])
        
        # 扩展书架中的书籍到 book_ids
        if shelf_ids:
            shelf_book_ids = await get_books_from_shelves(shelf_ids, user_id)
            if shelf_book_ids:
                logger.info(f"[AI] Expanded {len(shelf_ids)} shelves to {len(shelf_book_ids)} books")
                # 合并并去重
                book_ids = list(set(book_ids + shelf_book_ids))

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
            history = await get_conversation_history(conversation_id, user_id, limit=20)
            
            # 【2026-01-16 优化】智能历史管理 - 行业最佳实践
            # 1. Token截断：防止token爆炸
            history = truncate_history_by_tokens(history, max_tokens=8000)
            
            # 2. 对话压缩：10轮后自动摘要（节省90% tokens）
            # history = await compress_conversation_summary(history, model_config, compression_threshold=10)
            # TODO: 压缩功能暂时注释，待进一步测试后启用

            # QA模式的引用信息
            citations = []
            search_results = []
            
            logger.info(f"[AI] Request params: mode={mode}, book_ids={book_ids}, shelf_ids={shelf_ids}")

            # 构建系统提示词
            if mode == "qa" and book_ids:
                # 问答模式：执行向量搜索获取 RAG 上下文
                logger.info(f"[AI] QA mode: book_ids={book_ids[:3]}... user_id={user_id[:8]}...")
                
                # 获取书籍基本信息和 content_sha256（向量索引是公共数据，按 sha256 匹配）
                # 【2026-01-19 优化】移除硬编码5本书限制，支持书架中的大量书籍
                book_info_parts = []
                content_sha256_list = []
                book_info_map = {}  # sha256 -> book_info 映射
                
                # 限制最大书籍数量，防止请求过大
                effective_book_ids = book_ids[:RAG_MAX_BOOKS]
                if len(book_ids) > RAG_MAX_BOOKS:
                    logger.warning(f"[AI] Book count {len(book_ids)} exceeds limit {RAG_MAX_BOOKS}, truncating")
                
                for bid in effective_book_ids:
                    info = await get_book_info(bid, user_id)
                    if info:
                        book_info_parts.append(f"- 《{info['title']}》 by {info['author']}")
                        # 收集 sha256 用于向量搜索
                        if info.get('content_sha256'):
                            content_sha256_list.append(info['content_sha256'])
                            book_info_map[info['content_sha256']] = {
                                "id": info['id'],
                                "title": info['title'],
                                "author": info['author']
                            }
                
                # 书籍信息摘要（多书籍时只显示前5本 + 统计）
                if len(book_info_parts) > 5:
                    book_info = "\n".join(book_info_parts[:5]) + f"\n... 等共 {len(book_info_parts)} 本书籍"
                else:
                    book_info = "\n".join(book_info_parts) if book_info_parts else "未知书籍"
                
                # 【查询重写】解决指代词问题，提高多轮对话的搜索质量
                search_query = user_content
                if history and len(history) >= 2:
                    t0 = time.time()
                    search_query = await rewrite_query_with_context(
                        current_query=user_content,
                        history=history,
                        model_config=model_config,
                    )
                    logger.info(f"[AI] Query rewrite took {time.time() - t0:.2f}s")
                
                # 执行向量搜索获取相关内容（按 sha256 匹配公共向量）
                # 【2026-01-19 优化】动态 top_k 策略：
                # - 根据问题复杂度和书籍数量动态调整
                # - 多书籍场景确保每本书有代表性内容
                # - 配合 Reranker 精排，保证质量
                try:
                    if content_sha256_list:
                        t0 = time.time()
                        
                        # 【动态 top_k】根据问题和书籍数量计算
                        dynamic_top_k = calculate_dynamic_top_k(
                            query=search_query,
                            book_count=len(content_sha256_list)
                        )
                        logger.info(f"[AI] Dynamic top_k={dynamic_top_k} for {len(content_sha256_list)} books")
                        
                        search_results = await search_book_chunks(
                            query=search_query,  # 使用重写后的查询
                            content_sha256_list=content_sha256_list,
                            top_k=dynamic_top_k,  # 【优化】使用动态计算的 top_k
                            use_hybrid=True,  # 使用混合搜索（向量+关键词）
                            use_rerank=True,  # 使用 Reranking 重排序
                        )
                        logger.info(f"[AI] Search & Rerank took {time.time() - t0:.2f}s, got {len(search_results)} results")
                    else:
                        search_results = []
                        logger.warning(f"[AI] No content_sha256 found for books: {book_ids}")
                    
                    if search_results:
                        rag_parts = []
                        for i, chunk in enumerate(search_results, 1):
                            page_info = f" (第{chunk['page']}页)" if chunk.get('page') else ""
                            
                            # 【2026-01-16 优化】智能内容截断 - 行业标准
                            # - RAG上下文（给LLM）：300字符（Perplexity标准）
                            # - Preview（给前端）：200字符（ChatGPT标准）
                            # 参考：rag_industry_best_practices.md
                            RAG_CONTEXT_LENGTH = 300
                            PREVIEW_LENGTH = 200
                            
                            content_full = chunk['content']
                            content_for_rag = content_full[:RAG_CONTEXT_LENGTH]
                            content_for_preview = content_full[:PREVIEW_LENGTH]
                            
                            rag_parts.append(f"[{i}]{page_info} {content_for_rag}")
                            
                            # 构建引用信息供前端使用
                            book_id_from_chunk = chunk.get('book_id')
                            # 尝试从 book_info_map 获取书籍信息（通过 content_sha256）
                            # 如果没有，使用 chunk 中的 book_id
                            book_title = "未知书籍"
                            if book_id_from_chunk:
                                # 查找书籍标题
                                for sha, info in book_info_map.items():
                                    if info['id'] == book_id_from_chunk:
                                        book_title = info['title']
                                        break
                            
                            citations.append({
                                "index": i,
                                "book_id": book_id_from_chunk,
                                "book_title": book_title,
                                "page": chunk.get('page'),
                                "chapter": chunk.get('chapter'),
                                "section_index": chunk.get('section_index'),  # EPUB 章节索引，用于精确跳转
                                "section_filename": chunk.get('section_filename'),  # EPUB 章节文件名
                                "chunk_index": chunk.get('chunk_index'),
                                "preview": content_for_preview,  # 【优化】截断到200字符
                                "score": chunk.get('score', 0)
                            })
                        
                        rag_context = "\n\n".join(rag_parts)
                        logger.info(f"[AI] RAG success: found {len(search_results)} chunks, {len(citations)} citations")
                    else:
                        rag_context = "未找到相关内容，请基于你的知识回答。"
                        logger.warning(f"[AI] No RAG chunks found for query: {user_content[:50]}")
                except Exception as e:
                    logger.error(f"[AI] Vector search failed: {e}")
                    rag_context = "向量搜索失败，请基于你的知识回答。"
                
                # 搜索用户笔记和高亮（私人数据，必须按 user_id 过滤）
                user_notes_context = ""
                try:
                    user_notes = await search_user_notes(
                        query=search_query,  # 使用重写后的查询
                        user_id=user_id,     # 关键：安全隔离
                        book_ids=book_ids,
                        top_k=5
                    )
                    if user_notes:
                        notes_parts = []
                        for note in user_notes:
                            note_type_label = "笔记" if note.get('note_type') == 'note' else "高亮"
                            page_info = f" (第{note['page']}页)" if note.get('page') else ""
                            notes_parts.append(f"[{note_type_label}]{page_info} {note['content'][:300]}")
                        user_notes_context = f"\n用户笔记和高亮:\n" + "\n\n".join(notes_parts)
                        logger.info(f"[AI] Found {len(user_notes)} user notes/highlights")
                except Exception as e:
                    logger.warning(f"[AI] User notes search failed: {e}")
                
                system_prompt = SYSTEM_PROMPT_QA.format(
                    book_info=book_info,
                    rag_context=rag_context,
                    user_notes_context=user_notes_context
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

            # 保存 AI 回复（包含引用信息）
            if full_response:
                await save_message(conversation_id, user_id, "assistant", full_response, citations=citations)

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

            # 发送引用信息（QA模式）
            if citations:
                logger.info(f"[AI] Sending {len(citations)} citations to frontend")
                yield _sse_event("citations", {"citations": citations})
            else:
                logger.warning(f"[AI] No citations to send (mode={mode}, book_ids={len(book_ids) if book_ids else 0})")

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

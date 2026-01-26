"""
Admin AI 模型管理接口

职责:
- AI 模型配置 CRUD
- API 密钥加密存储
- 模型测试连接
"""

import base64
import json
import os
import uuid
from typing import Optional

from cryptography.fernet import Fernet
from fastapi import APIRouter, Body, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from .admin import require_admin
from .db import engine
from .services.llm_provider import get_provider, ChatMessage

router = APIRouter(prefix="/api/v1/admin/ai-models", tags=["admin-ai"])


# ============================================================================
# API Key 加密
# ============================================================================

# 从环境变量获取加密密钥，如果没有则生成一个
_ENCRYPTION_KEY = os.getenv("AI_API_KEY_ENCRYPTION_KEY", "")
if not _ENCRYPTION_KEY:
    # 开发环境使用固定密钥
    _ENCRYPTION_KEY = "dev_encryption_key_32bytes_long!"

# Fernet 需要 32 字节的 base64 编码密钥
_fernet_key = base64.urlsafe_b64encode(_ENCRYPTION_KEY.encode()[:32].ljust(32, b"0"))
_fernet = Fernet(_fernet_key)


def encrypt_api_key(api_key: str) -> str:
    """加密 API 密钥"""
    return _fernet.encrypt(api_key.encode()).decode()


def decrypt_api_key(encrypted: str) -> str:
    """解密 API 密钥"""
    try:
        return _fernet.decrypt(encrypted.encode()).decode()
    except Exception:
        return ""


def mask_api_key(api_key: str) -> str:
    """遮蔽 API 密钥显示"""
    if len(api_key) <= 8:
        return "****"
    return api_key[:4] + "*" * (len(api_key) - 8) + api_key[-4:]


# ============================================================================
# Pydantic Models
# ============================================================================


class AIModelCreate(BaseModel):
    provider: str  # siliconflow, openrouter
    model_id: str  # e.g., Pro/deepseek-ai/DeepSeek-V3.2
    display_name: str
    api_key: Optional[str] = None
    endpoint: Optional[str] = None
    input_price_per_1k: float = 0.0
    output_price_per_1k: float = 0.0
    context_window: int = 8192
    is_default: bool = False
    capabilities: list[str] = ["chat"]
    config: dict = {}
    active: bool = True


class AIModelUpdate(BaseModel):
    display_name: Optional[str] = None
    api_key: Optional[str] = None  # 如果提供则更新
    endpoint: Optional[str] = None
    input_price_per_1k: Optional[float] = None
    output_price_per_1k: Optional[float] = None
    context_window: Optional[int] = None
    is_default: Optional[bool] = None
    capabilities: Optional[list[str]] = None
    config: Optional[dict] = None
    active: Optional[bool] = None


# ============================================================================
# API Endpoints
# ============================================================================


@router.get("")
async def list_ai_models(
    limit: int = 50,
    offset: int = 0,
    active_only: bool = False,
    _=Depends(require_admin),
):
    """列出所有 AI 模型配置"""
    async with engine.begin() as conn:
        where_clause = "WHERE 1=1"
        if active_only:
            where_clause += " AND active = true"

        result = await conn.execute(
            text(
                f"""
                SELECT 
                    id::text, provider, model_id, display_name, active,
                    api_key_encrypted, endpoint,
                    input_price_per_1k, output_price_per_1k,
                    context_window, is_default, capabilities, config,
                    updated_at
                FROM ai_models
                {where_clause}
                ORDER BY is_default DESC, display_name ASC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"limit": limit, "offset": offset},
        )
        rows = result.fetchall()

        # 统计总数
        count_result = await conn.execute(
            text(f"SELECT COUNT(*) FROM ai_models {where_clause}")
        )
        total = count_result.scalar()

        return {
            "status": "success",
            "data": [
                {
                    "id": r[0],
                    "provider": r[1],
                    "model_id": r[2],
                    "display_name": r[3],
                    "active": r[4],
                    "has_api_key": bool(r[5]),
                    "api_key_masked": mask_api_key(decrypt_api_key(r[5])) if r[5] else None,
                    "endpoint": r[6],
                    "input_price_per_1k": float(r[7]) if r[7] else 0,
                    "output_price_per_1k": float(r[8]) if r[8] else 0,
                    "context_window": r[9],
                    "is_default": r[10],
                    "capabilities": r[11] or ["chat"],
                    "config": r[12] or {},
                    "updated_at": str(r[13]) if r[13] else None,
                }
                for r in rows
            ],
            "pagination": {
                "total": total,
                "limit": limit,
                "offset": offset,
            },
        }


@router.post("")
async def create_ai_model(
    body: AIModelCreate,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    _=Depends(require_admin),
):
    """创建新的 AI 模型配置"""
    model_id = str(uuid.uuid4())

    # 加密 API 密钥
    encrypted_key = encrypt_api_key(body.api_key) if body.api_key else None

    async with engine.begin() as conn:
        # 检查 model_id 是否已存在
        existing = await conn.execute(
            text("SELECT id FROM ai_models WHERE model_id = :mid"),
            {"mid": body.model_id},
        )
        if existing.fetchone():
            raise HTTPException(status_code=409, detail="model_id_exists")

        # 如果设为默认，先取消其他默认
        if body.is_default:
            await conn.execute(text("UPDATE ai_models SET is_default = false"))

        await conn.execute(
            text(
                """
                INSERT INTO ai_models (
                    id, provider, model_id, display_name, active,
                    api_key_encrypted, endpoint,
                    input_price_per_1k, output_price_per_1k,
                    context_window, is_default, capabilities, config,
                    updated_at
                ) VALUES (
                    cast(:id as uuid), :provider, :model_id, :display_name, :active,
                    :api_key_encrypted, :endpoint,
                    :input_price_per_1k, :output_price_per_1k,
                    :context_window, :is_default, cast(:capabilities as jsonb), cast(:config as jsonb),
                    now()
                )
                """
            ),
            {
                "id": model_id,
                "provider": body.provider,
                "model_id": body.model_id,
                "display_name": body.display_name,
                "active": body.active,
                "api_key_encrypted": encrypted_key,
                "endpoint": body.endpoint,
                "input_price_per_1k": body.input_price_per_1k,
                "output_price_per_1k": body.output_price_per_1k,
                "context_window": body.context_window,
                "is_default": body.is_default,
                "capabilities": json.dumps(body.capabilities),
                "config": json.dumps(body.config),
            },
        )

    return {
        "status": "success",
        "data": {"id": model_id},
    }


@router.get("/{id}")
async def get_ai_model(id: str, _=Depends(require_admin)):
    """获取单个 AI 模型配置"""
    async with engine.begin() as conn:
        result = await conn.execute(
            text(
                """
                SELECT 
                    id::text, provider, model_id, display_name, active,
                    api_key_encrypted, endpoint,
                    input_price_per_1k, output_price_per_1k,
                    context_window, is_default, capabilities, config,
                    updated_at
                FROM ai_models
                WHERE id = cast(:id as uuid)
                """
            ),
            {"id": id},
        )
        row = result.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="not_found")

        return {
            "status": "success",
            "data": {
                "id": row[0],
                "provider": row[1],
                "model_id": row[2],
                "display_name": row[3],
                "active": row[4],
                "has_api_key": bool(row[5]),
                "api_key_masked": mask_api_key(decrypt_api_key(row[5])) if row[5] else None,
                "endpoint": row[6],
                "input_price_per_1k": float(row[7]) if row[7] else 0,
                "output_price_per_1k": float(row[8]) if row[8] else 0,
                "context_window": row[9],
                "is_default": row[10],
                "capabilities": row[11] or ["chat"],
                "config": row[12] or {},
                "updated_at": str(row[13]) if row[13] else None,
            },
        }


@router.patch("/{id}")
async def update_ai_model(
    id: str,
    body: AIModelUpdate,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    _=Depends(require_admin),
):
    """更新 AI 模型配置"""
    async with engine.begin() as conn:
        # 检查是否存在
        existing = await conn.execute(
            text("SELECT id FROM ai_models WHERE id = cast(:id as uuid)"),
            {"id": id},
        )
        if not existing.fetchone():
            raise HTTPException(status_code=404, detail="not_found")

        # 构建更新语句
        updates = []
        params = {"id": id}

        if body.display_name is not None:
            updates.append("display_name = :display_name")
            params["display_name"] = body.display_name

        if body.api_key is not None:
            updates.append("api_key_encrypted = :api_key_encrypted")
            params["api_key_encrypted"] = encrypt_api_key(body.api_key)

        if body.endpoint is not None:
            updates.append("endpoint = :endpoint")
            params["endpoint"] = body.endpoint

        if body.input_price_per_1k is not None:
            updates.append("input_price_per_1k = :input_price_per_1k")
            params["input_price_per_1k"] = body.input_price_per_1k

        if body.output_price_per_1k is not None:
            updates.append("output_price_per_1k = :output_price_per_1k")
            params["output_price_per_1k"] = body.output_price_per_1k

        if body.context_window is not None:
            updates.append("context_window = :context_window")
            params["context_window"] = body.context_window

        if body.is_default is not None:
            if body.is_default:
                # 先取消其他默认
                await conn.execute(text("UPDATE ai_models SET is_default = false"))
            updates.append("is_default = :is_default")
            params["is_default"] = body.is_default

        if body.capabilities is not None:
            updates.append("capabilities = cast(:capabilities as jsonb)")
            params["capabilities"] = json.dumps(body.capabilities)

        if body.config is not None:
            updates.append("config = cast(:config as jsonb)")
            params["config"] = json.dumps(body.config)

        if body.active is not None:
            updates.append("active = :active")
            params["active"] = body.active

        if updates:
            updates.append("updated_at = now()")
            update_sql = f"UPDATE ai_models SET {', '.join(updates)} WHERE id = cast(:id as uuid)"
            await conn.execute(text(update_sql), params)

    return {"status": "success"}


@router.delete("/{id}")
async def delete_ai_model(id: str, _=Depends(require_admin)):
    """删除 AI 模型配置"""
    async with engine.begin() as conn:
        result = await conn.execute(
            text("DELETE FROM ai_models WHERE id = cast(:id as uuid) RETURNING id"),
            {"id": id},
        )
        if not result.fetchone():
            raise HTTPException(status_code=404, detail="not_found")

    return {"status": "success"}


@router.post("/{id}/test")
async def test_ai_model(id: str, _=Depends(require_admin)):
    """测试 AI 模型连接"""
    async with engine.begin() as conn:
        result = await conn.execute(
            text(
                """
                SELECT provider, model_id, api_key_encrypted, endpoint
                FROM ai_models
                WHERE id = cast(:id as uuid)
                """
            ),
            {"id": id},
        )
        row = result.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="not_found")

        provider_name, model_id, encrypted_key, endpoint = row

        if not encrypted_key:
            raise HTTPException(status_code=400, detail="no_api_key")

        api_key = decrypt_api_key(encrypted_key)
        if not api_key:
            raise HTTPException(status_code=400, detail="invalid_api_key")

        try:
            provider = get_provider(provider_name, api_key, endpoint)

            # 发送测试消息
            messages = [ChatMessage(role="user", content="Say 'Hello, Athena!' in one sentence.")]
            response, usage = await provider.chat(
                messages=messages,
                model=model_id,
                max_tokens=50,
            )

            return {
                "status": "success",
                "data": {
                    "response": response,
                    "usage": {
                        "prompt_tokens": usage.prompt_tokens,
                        "completion_tokens": usage.completion_tokens,
                        "total_tokens": usage.total_tokens,
                    },
                },
            }

        except Exception as e:
            return {
                "status": "error",
                "error": str(e),
            }


@router.get("/default")
async def get_default_model(_=Depends(require_admin)):
    """获取默认 AI 模型"""
    async with engine.begin() as conn:
        result = await conn.execute(
            text(
                """
                SELECT id::text, provider, model_id, display_name
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
                    SELECT id::text, provider, model_id, display_name
                    FROM ai_models
                    WHERE active = true
                    ORDER BY updated_at DESC
                    LIMIT 1
                    """
                )
            )
            row = result.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="no_active_model")

        return {
            "status": "success",
            "data": {
                "id": row[0],
                "provider": row[1],
                "model_id": row[2],
                "display_name": row[3],
            },
        }

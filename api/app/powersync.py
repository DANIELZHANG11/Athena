"""
PowerSync 同步上传接口

职责：
- 接收客户端 PowerSync SDK 上传的本地变更
- 将变更应用到 PostgreSQL 数据库
- 支持批量操作 (INSERT/UPDATE/DELETE)
- RLS 安全校验

@see 09 - APP-FIRST架构改造计划.md - Phase 4
@version 1.0.0
"""
import hashlib
from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Body, Depends
from pydantic import BaseModel
from sqlalchemy import text

from .auth import require_user
from .db import engine

router = APIRouter(prefix="/api/v1/sync")


def _generate_version_hash(content: str) -> str:
    """
    生成版本指纹（用于冲突检测）
    
    Args:
        content: 要hash的内容
        
    Returns:
        格式: "sha256:xxxxx" (前16字符)
    """
    h = hashlib.sha256(content.encode('utf-8')).hexdigest()
    return f"sha256:{h[:16]}"


# ============ Pydantic 模型 ============

class SyncOperation(BaseModel):
    """单个同步操作"""
    table: str
    op: Literal["PUT", "PATCH", "DELETE"]
    id: str
    data: Optional[dict] = None


class SyncUploadRequest(BaseModel):
    """同步上传请求"""
    operations: List[SyncOperation]


class SyncUploadResponse(BaseModel):
    """同步上传响应"""
    status: str = "success"
    processed: int = 0
    errors: List[dict] = []


# ============ 允许同步的表 (白名单) ============

ALLOWED_TABLES = {
    "reading_progress",
    "reading_sessions",
    "notes",
    "highlights",
    "bookmarks",
    "shelves",
    "shelf_books",
    "user_settings",
}

# 表字段映射 (前端字段 -> 后端字段)
TABLE_COLUMNS = {
    "reading_progress": {
        "id", "user_id", "book_id", "device_id", "progress",
        "last_position", "last_location", "updated_at"
    },
    "reading_sessions": {
        "id", "user_id", "book_id", "device_id", "is_active",
        "total_ms", "created_at", "updated_at"
    },
    "notes": {
        "id", "user_id", "book_id", "device_id", "content",
        "page_number", "position_cfi", "color", "is_deleted",
        "deleted_at", "created_at", "updated_at"
    },
    "highlights": {
        "id", "user_id", "book_id", "device_id", "text",
        "page_number", "position_start_cfi", "position_end_cfi",
        "color", "is_deleted", "deleted_at", "created_at", "updated_at"
    },
    "bookmarks": {
        "id", "user_id", "book_id", "device_id", "title",
        "page_number", "position_cfi", "is_deleted",
        "deleted_at", "created_at", "updated_at"
    },
    "shelves": {
        "id", "user_id", "name", "description", "cover_url",
        "sort_order", "is_deleted", "deleted_at", "created_at", "updated_at"
    },
    "shelf_books": {
        "id", "shelf_id", "book_id", "sort_order", "added_at"
    },
    "user_settings": {
        "id", "user_id", "device_id", "settings_json", "updated_at"
    },
}


# ============ 路由 ============

@router.post("/upload", response_model=SyncUploadResponse)
async def sync_upload(
    body: SyncUploadRequest = Body(...),
    auth=Depends(require_user)
):
    """
    接收 PowerSync 客户端上传的本地变更
    
    安全措施：
    1. 只允许操作白名单中的表
    2. 强制注入 user_id (覆盖客户端传值)
    3. 使用 RLS 进行行级安全校验
    4. 过滤危险字段
    """
    user_id, _ = auth
    processed = 0
    errors = []

    async with engine.begin() as conn:
        # 设置 RLS user_id
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"),
            {"v": user_id}
        )

        for op in body.operations:
            try:
                # 安全检查：只允许白名单表
                if op.table not in ALLOWED_TABLES:
                    errors.append({
                        "id": op.id,
                        "error": f"Table '{op.table}' is not allowed for sync"
                    })
                    continue

                # 根据操作类型处理
                if op.op == "DELETE":
                    await _handle_delete(conn, op, user_id)
                elif op.op in ("PUT", "PATCH"):
                    await _handle_upsert(conn, op, user_id)
                else:
                    errors.append({
                        "id": op.id,
                        "error": f"Unknown operation: {op.op}"
                    })
                    continue

                processed += 1

            except Exception as e:
                errors.append({
                    "id": op.id,
                    "error": str(e)
                })

    return SyncUploadResponse(
        status="success",
        processed=processed,
        errors=errors
    )


async def _handle_delete(conn, op: SyncOperation, user_id: str):
    """处理 DELETE 操作"""
    table = op.table
    record_id = op.id

    # 软删除 (如果表支持)
    if table in {"notes", "highlights", "bookmarks", "shelves"}:
        await conn.execute(
            text(f"""
                UPDATE {table}
                SET is_deleted = TRUE, deleted_at = now()
                WHERE id = cast(:id as uuid)
                AND user_id = current_setting('app.user_id')::uuid
            """),
            {"id": record_id}
        )
    elif table == "shelf_books":
        # shelf_books 使用硬删除
        await conn.execute(
            text("""
                DELETE FROM shelf_books
                WHERE id = cast(:id as uuid)
                AND shelf_id IN (
                    SELECT id FROM shelves 
                    WHERE user_id = current_setting('app.user_id')::uuid
                )
            """),
            {"id": record_id}
        )
    else:
        # 其他表硬删除 (reading_progress, reading_sessions, user_settings)
        await conn.execute(
            text(f"""
                DELETE FROM {table}
                WHERE id = cast(:id as uuid)
                AND user_id = current_setting('app.user_id')::uuid
            """),
            {"id": record_id}
        )


async def _handle_upsert(conn, op: SyncOperation, user_id: str):
    """处理 PUT/PATCH 操作 (UPSERT)"""
    table = op.table
    record_id = op.id
    data = op.data or {}

    # 获取允许的字段
    allowed_columns = TABLE_COLUMNS.get(table, set())

    # 过滤数据，只保留允许的字段
    filtered_data = {
        k: v for k, v in data.items()
        if k in allowed_columns and k not in {"id", "user_id"}
    }

    # 强制注入 user_id (安全措施)
    if "user_id" in allowed_columns:
        filtered_data["user_id"] = user_id

    # 确保有更新时间
    if "updated_at" in allowed_columns:
        filtered_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    if not filtered_data:
        return

    # 构建 UPSERT SQL
    columns = ["id"] + list(filtered_data.keys())
    placeholders = ["cast(:id as uuid)"] + [
        f"cast(:p_{k} as uuid)" if k in {"user_id", "book_id", "shelf_id", "device_id"}
        else f":p_{k}"
        for k in filtered_data.keys()
    ]
    update_clause = ", ".join([
        f"{k} = EXCLUDED.{k}"
        for k in filtered_data.keys()
    ])

    sql = f"""
        INSERT INTO {table} ({', '.join(columns)})
        VALUES ({', '.join(placeholders)})
        ON CONFLICT (id) DO UPDATE SET {update_clause}
    """

    # 构建参数
    params = {"id": record_id}
    for k, v in filtered_data.items():
        params[f"p_{k}"] = v

    await conn.execute(text(sql), params)

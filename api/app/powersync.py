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
# 前端可以通过 PowerSync 写入这些表，变更会同步到 PostgreSQL
# @see 05 - API 契约与协议 - 3.C PowerSync 数据操作规范

ALLOWED_TABLES = {
    "books",              # 元数据修改、软删除（硬删除仍需 API）
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
# 定义每个表允许同步的字段，防止恶意写入敏感字段
TABLE_COLUMNS = {
    "books": {
        "id", "user_id", "title", "author",  # 元数据可修改
        "deleted_at", "updated_at",           # 软删除相关
        # 注意：以下字段前端不可修改，由服务器控制
        # minio_key, content_sha256, size, original_format, ocr_status 等
    },
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
        "id", "user_id", "shelf_id", "book_id", "sort_order", "added_at"
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

    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"[PowerSync] Received {len(body.operations)} operations from user {user_id}")

    async with engine.begin() as conn:
        # 设置 RLS user_id
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"),
            {"v": user_id}
        )

        for op in body.operations:
            try:
                logger.info(f"[PowerSync] Processing: table={op.table}, op={op.op}, id={op.id}, data={op.data}")
                
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
                logger.info(f"[PowerSync] Successfully processed op for {op.table}/{op.id}")

            except Exception as e:
                logger.error(f"[PowerSync] Error processing {op.table}/{op.id}: {e}")
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
    import logging
    logger = logging.getLogger(__name__)
    
    table = op.table
    record_id = op.id
    
    logger.info(f"[PowerSync DELETE] table={table}, id={record_id}, user_id={user_id}")

    # books 表只有 deleted_at，没有 is_deleted
    if table == "books":
        result = await conn.execute(
            text("""
                UPDATE books
                SET deleted_at = now()
                WHERE id = cast(:id as uuid)
                AND user_id = cast(:user_id as uuid)
                RETURNING id, deleted_at
            """),
            {"id": record_id, "user_id": user_id}
        )
        row = result.fetchone()
        logger.info(f"[PowerSync DELETE books] Result: {row}")
    # 其他表有 is_deleted + deleted_at
    elif table in {"notes", "highlights", "bookmarks", "shelves"}:
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


async def _handle_books_update(conn, record_id: str, filtered_data: dict, user_id: str, logger):
    """
    专门处理 books 表的更新操作
    books 只能通过上传流程创建，PowerSync 只能修改元数据和软删除
    """
    from dateutil.parser import isoparse
    
    if not filtered_data:
        logger.info(f"[PowerSync books UPDATE] No data to update for {record_id}")
        return
    
    # 时间戳字段列表
    timestamp_columns = {"deleted_at", "updated_at"}
    
    # 构建 UPDATE SET 子句
    set_clauses = []
    params = {"id": record_id, "user_id": user_id}
    
    for k, v in filtered_data.items():
        if k in timestamp_columns and v is not None and isinstance(v, str):
            try:
                params[f"p_{k}"] = isoparse(v)
            except Exception:
                params[f"p_{k}"] = v
        else:
            params[f"p_{k}"] = v
        set_clauses.append(f"{k} = :p_{k}")
    
    sql = f"""
        UPDATE books 
        SET {', '.join(set_clauses)}
        WHERE id = cast(:id as uuid) 
        AND user_id = cast(:user_id as uuid)
    """
    
    logger.info(f"[PowerSync books UPDATE] SQL: {sql}")
    logger.info(f"[PowerSync books UPDATE] Params: {params}")
    
    result = await conn.execute(text(sql), params)
    logger.info(f"[PowerSync books UPDATE] Result rowcount: {result.rowcount}")


async def _handle_upsert(conn, op: SyncOperation, user_id: str):
    """处理 PUT/PATCH 操作 (UPSERT)"""
    import logging
    logger = logging.getLogger(__name__)
    
    table = op.table
    record_id = op.id
    data = op.data or {}
    
    logger.info(f"[PowerSync UPSERT] table={table}, id={record_id}, data={data}")

    # 获取允许的字段
    allowed_columns = TABLE_COLUMNS.get(table, set())
    logger.info(f"[PowerSync UPSERT] allowed_columns for {table}: {allowed_columns}")

    # 过滤数据，只保留允许的字段
    filtered_data = {
        k: v for k, v in data.items()
        if k in allowed_columns and k not in {"id", "user_id"}
    }

    # books 表特殊处理：只允许 UPDATE，不允许 INSERT
    # 因为书籍必须通过上传流程创建，PowerSync 只能修改元数据和软删除
    if table == "books":
        return await _handle_books_update(conn, record_id, filtered_data, user_id, logger)

    # 强制注入 user_id (安全措施)
    if "user_id" in allowed_columns:
        filtered_data["user_id"] = user_id

    # 确保有更新时间
    if "updated_at" in allowed_columns:
        filtered_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    if not filtered_data:
        return

    # shelf_books 特殊处理：验证 shelf 属于当前用户
    if table == "shelf_books":
        shelf_id = filtered_data.get("shelf_id") or data.get("shelf_id")
        if shelf_id:
            # 验证书架属于当前用户
            result = await conn.execute(
                text("""
                    SELECT id FROM shelves 
                    WHERE id = cast(:shelf_id as uuid) 
                    AND user_id = current_setting('app.user_id')::uuid
                """),
                {"shelf_id": shelf_id}
            )
            if result.fetchone() is None:
                raise ValueError(f"Shelf {shelf_id} not found or access denied")

    # 构建 UPSERT SQL
    columns = ["id"] + list(filtered_data.keys())
    
    # 时间戳字段列表 - 需要转换 ISO 字符串为 datetime
    timestamp_columns = {"added_at", "created_at", "updated_at", "deleted_at"}
    
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

    # 构建参数 - 转换时间戳字符串为 datetime
    from dateutil.parser import isoparse
    
    params = {"id": record_id}
    for k, v in filtered_data.items():
        if k in timestamp_columns and v is not None and isinstance(v, str):
            try:
                params[f"p_{k}"] = isoparse(v)
            except Exception:
                params[f"p_{k}"] = v  # 转换失败则保留原值
        else:
            params[f"p_{k}"] = v

    logger.info(f"[PowerSync UPSERT] SQL: {sql}")
    logger.info(f"[PowerSync UPSERT] Params: {params}")
    
    result = await conn.execute(text(sql), params)
    logger.info(f"[PowerSync UPSERT] Result rowcount: {result.rowcount}")

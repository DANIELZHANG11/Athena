"""
智能心跳同步 API (ADR-006)

实现功能:
1. 版本指纹比对（OCR、元数据、向量索引）
2. 离线笔记/高亮批量上传
3. 冲突检测与副本创建
4. 服务端事件推送
"""
import hashlib
import os
import uuid
from datetime import datetime, timedelta, timezone

import redis
from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import text

from .auth import require_user
from .db import engine
from .search_sync import index_highlight, index_note

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)

router = APIRouter(prefix="/api/v1/sync", tags=["sync"])

# 心跳间隔配置（毫秒）
HEARTBEAT_ACTIVE = 15000      # 用户活跃阅读
HEARTBEAT_IDLE = 60000        # 用户空闲
HEARTBEAT_BACKGROUND = 300000  # 后台/最小化

# 单次心跳最大笔记/高亮数量
MAX_NOTES_PER_HEARTBEAT = 50
MAX_HIGHLIGHTS_PER_HEARTBEAT = 50


def _generate_version_hash(content: str) -> str:
    """生成版本指纹 (sha256 前 16 位)"""
    return f"sha256:{hashlib.sha256(content.encode('utf-8')).hexdigest()[:16]}"


@router.post("/heartbeat")
async def smart_heartbeat(body: dict = Body(...), auth=Depends(require_user)):
    """
    智能心跳同步接口。
    
    功能:
    1. 同步阅读进度（客户端权威）
    2. 比对版本指纹，返回需要拉取的数据清单
    3. 接收离线创建的笔记/高亮，检测冲突
    4. 返回服务端待推送的事件
    
    Request Body:
    {
        "bookId": string,              // 当前阅读的书籍 ID
        "deviceId": string,            // 设备标识符
        "clientVersions": {
            "ocr"?: string,            // 客户端 OCR 数据版本
            "metadata"?: string,       // 客户端元数据版本
            "vectorIndex"?: string     // 客户端向量索引版本
        },
        "clientUpdates"?: {
            "readingProgress"?: {
                "progress": number,
                "lastLocation": any,
                "timestamp": string
            },
            "pendingNotes"?: Array<{...}>,     // 最多 50 条
            "pendingHighlights"?: Array<{...}>, // 最多 50 条
            "hasMore"?: boolean
        }
    }
    """
    user_id, _ = auth
    book_id = body.get("bookId")
    device_id = body.get("deviceId", "unknown")
    client_versions = body.get("clientVersions", {})
    client_updates = body.get("clientUpdates", {})
    
    if not book_id:
        raise HTTPException(status_code=400, detail="missing_book_id")
    
    # 限制设备 ID 长度
    if len(device_id) > 64:
        device_id = device_id[:64]
    
    # 验证 pending 数据量
    pending_notes = client_updates.get("pendingNotes", [])
    pending_highlights = client_updates.get("pendingHighlights", [])
    
    if len(pending_notes) > MAX_NOTES_PER_HEARTBEAT:
        raise HTTPException(status_code=400, detail="too_many_pending_notes")
    if len(pending_highlights) > MAX_HIGHLIGHTS_PER_HEARTBEAT:
        raise HTTPException(status_code=400, detail="too_many_pending_highlights")
    
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        
        # 1. 获取书籍和进度信息
        book_res = await conn.execute(
            text("""
                SELECT b.id, b.title, b.author, b.is_digitalized, 
                       b.digitalize_report_key, b.ocr_result_key, b.ocr_status, b.vector_indexed_at,
                       rp.ocr_version, rp.metadata_version, rp.vector_index_version,
                       rp.progress, rp.last_location, rp.last_sync_at
                FROM books b
                LEFT JOIN reading_progress rp ON rp.book_id = b.id 
                    AND rp.user_id = current_setting('app.user_id')::uuid
                WHERE b.id = cast(:bid as uuid)
            """),
            {"bid": book_id},
        )
        book_row = book_res.fetchone()
        if not book_row:
            raise HTTPException(status_code=404, detail="book_not_found")
        
        (book_id_db, title, author, is_digitalized, old_report_key, new_ocr_key, ocr_status, 
         vector_indexed_at, db_ocr_ver, db_meta_ver, db_vec_ver,
         db_progress, db_last_location, db_last_sync) = book_row
        
        # 优先使用新版 OCR 结果
        report_key = new_ocr_key or old_report_key
        
        # 2. 计算服务端版本指纹
        # OCR 版本：基于 report_key 的哈希
        server_ocr_version = None
        if report_key:
            server_ocr_version = _generate_version_hash(report_key)
        
        # 元数据版本：基于 title + author
        metadata_str = f"{title or ''}|{author or ''}"
        server_metadata_version = _generate_version_hash(metadata_str)
        
        # 向量索引版本：基于 vector_indexed_at
        server_vector_version = None
        if vector_indexed_at:
            server_vector_version = _generate_version_hash(str(vector_indexed_at))
        
        # 3. 比对版本，确定需要拉取的数据
        pull_required = {}
        
        client_ocr = client_versions.get("ocr")
        if server_ocr_version and client_ocr != server_ocr_version:
            pull_required["ocr"] = {
                "url": f"/api/v1/books/{book_id}/ocr/full",
                "size": 0,  # 大小未知
                "priority": "high" if is_digitalized else "normal"
            }
        
        client_metadata = client_versions.get("metadata")
        if client_metadata != server_metadata_version:
            pull_required["metadata"] = {
                "url": f"/api/v1/books/{book_id}",
                "fields": ["title", "author"],
                "priority": "normal"
            }
        
        client_vector = client_versions.get("vectorIndex")
        if server_vector_version and client_vector != server_vector_version:
            pull_required["vectorIndex"] = {
                "url": f"/api/v1/books/{book_id}/embeddings",
                "priority": "low"
            }
        
        # 4. 处理阅读进度更新（客户端权威，Last-Write-Wins）
        push_results = {}
        reading_progress = client_updates.get("readingProgress")
        if reading_progress:
            progress = reading_progress.get("progress", 0)
            last_location = reading_progress.get("lastLocation")
            client_ts_str = reading_progress.get("timestamp")
            
            import json as _json
            loc_json = _json.dumps(last_location) if isinstance(last_location, (dict, list)) else last_location
            
            await conn.execute(
                text("""
                    INSERT INTO reading_progress(user_id, book_id, progress, last_location, updated_at, last_sync_at)
                    VALUES (current_setting('app.user_id')::uuid, cast(:bid as uuid), :p, cast(:loc as jsonb), now(), now())
                    ON CONFLICT (user_id, book_id) DO UPDATE SET
                        progress = EXCLUDED.progress,
                        last_location = COALESCE(EXCLUDED.last_location, reading_progress.last_location),
                        updated_at = now(),
                        last_sync_at = now()
                """),
                {"bid": book_id, "p": progress, "loc": loc_json},
            )
            push_results["readingProgress"] = "accepted"
        
        # 5. 处理离线笔记（检测冲突）
        note_results = []
        for note in pending_notes:
            client_id = note.get("clientId")
            content = note.get("content")
            location = note.get("location")
            chapter = note.get("chapter")
            created_at = note.get("createdAt")
            
            if not client_id or not content:
                note_results.append({
                    "clientId": client_id,
                    "status": "rejected",
                    "message": "missing_required_fields"
                })
                continue
            
            # 检查是否已存在相同 clientId 的笔记（幂等性）
            existing = await conn.execute(
                text("""
                    SELECT id FROM notes 
                    WHERE user_id = current_setting('app.user_id')::uuid 
                    AND book_id = cast(:bid as uuid)
                    AND meta->>'clientId' = :cid
                    AND deleted_at IS NULL
                """),
                {"bid": book_id, "cid": client_id},
            )
            if existing.fetchone():
                note_results.append({
                    "clientId": client_id,
                    "status": "rejected",
                    "message": "duplicate_client_id"
                })
                continue
            
            # 检测内容冲突（同一位置的笔记）
            conflict_note = None
            if location:
                conflict_res = await conn.execute(
                    text("""
                        SELECT id, content, device_id FROM notes
                        WHERE user_id = current_setting('app.user_id')::uuid
                        AND book_id = cast(:bid as uuid)
                        AND location = :loc
                        AND deleted_at IS NULL
                        AND device_id != :dev
                    """),
                    {"bid": book_id, "loc": location, "dev": device_id},
                )
                conflict_note = conflict_res.fetchone()
            
            note_id = str(uuid.uuid4())
            
            if conflict_note:
                # 存在冲突：创建冲突副本
                original_id = conflict_note[0]
                await conn.execute(
                    text("""
                        INSERT INTO notes(id, user_id, book_id, content, chapter, location, device_id, conflict_of, 
                                          meta, tsv)
                        VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, cast(:bid as uuid),
                                :content, :chapter, :loc, :dev, cast(:orig as uuid),
                                jsonb_build_object('clientId', :cid),
                                to_tsvector('simple', coalesce(:content, '')))
                    """),
                    {
                        "id": note_id, "bid": book_id, "content": content,
                        "chapter": chapter, "loc": location, "dev": device_id,
                        "orig": str(original_id), "cid": client_id
                    },
                )
                note_results.append({
                    "clientId": client_id,
                    "serverId": note_id,
                    "status": "conflict_copy",
                    "conflictId": str(original_id),
                    "message": "conflict_detected_copy_created"
                })
            else:
                # 无冲突：正常创建
                await conn.execute(
                    text("""
                        INSERT INTO notes(id, user_id, book_id, content, chapter, location, device_id,
                                          meta, tsv)
                        VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, cast(:bid as uuid),
                                :content, :chapter, :loc, :dev,
                                jsonb_build_object('clientId', :cid),
                                to_tsvector('simple', coalesce(:content, '')))
                    """),
                    {
                        "id": note_id, "bid": book_id, "content": content,
                        "chapter": chapter, "loc": location, "dev": device_id, "cid": client_id
                    },
                )
                note_results.append({
                    "clientId": client_id,
                    "serverId": note_id,
                    "status": "created"
                })
                # 索引到搜索引擎
                index_note(note_id, user_id, book_id, content, [])
        
        if note_results:
            push_results["notes"] = note_results
        
        # 6. 处理离线高亮（检测冲突）
        highlight_results = []
        for hl in pending_highlights:
            client_id = hl.get("clientId")
            text_content = hl.get("text")
            start_loc = hl.get("startLocation")
            end_loc = hl.get("endLocation")
            color = hl.get("color")
            created_at = hl.get("createdAt")
            
            if not client_id or start_loc is None or end_loc is None:
                highlight_results.append({
                    "clientId": client_id,
                    "status": "rejected",
                    "message": "missing_required_fields"
                })
                continue
            
            # 检查幂等性
            existing = await conn.execute(
                text("""
                    SELECT id FROM highlights
                    WHERE user_id = current_setting('app.user_id')::uuid
                    AND book_id = cast(:bid as uuid)
                    AND meta->>'clientId' = :cid
                    AND deleted_at IS NULL
                """),
                {"bid": book_id, "cid": client_id},
            )
            if existing.fetchone():
                highlight_results.append({
                    "clientId": client_id,
                    "status": "rejected",
                    "message": "duplicate_client_id"
                })
                continue
            
            # 检测重叠高亮（简化：相同起止位置视为冲突）
            conflict_hl = await conn.execute(
                text("""
                    SELECT id FROM highlights
                    WHERE user_id = current_setting('app.user_id')::uuid
                    AND book_id = cast(:bid as uuid)
                    AND start_location = :sl AND end_location = :el
                    AND deleted_at IS NULL
                    AND device_id != :dev
                """),
                {"bid": book_id, "sl": start_loc, "el": end_loc, "dev": device_id},
            )
            
            hl_id = str(uuid.uuid4())
            
            if conflict_hl.fetchone():
                # 高亮冲突：合并（保留新的颜色）
                await conn.execute(
                    text("""
                        INSERT INTO highlights(id, user_id, book_id, start_location, end_location, 
                                               color, comment, device_id, meta, tsv)
                        VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, cast(:bid as uuid),
                                :sl, :el, :color, :txt, :dev,
                                jsonb_build_object('clientId', :cid),
                                to_tsvector('simple', coalesce(:txt, '')))
                    """),
                    {
                        "id": hl_id, "bid": book_id, "sl": start_loc, "el": end_loc,
                        "color": color, "txt": text_content, "dev": device_id, "cid": client_id
                    },
                )
                highlight_results.append({
                    "clientId": client_id,
                    "serverId": hl_id,
                    "status": "merged",
                    "message": "overlapping_highlight_merged"
                })
            else:
                # 无冲突：正常创建
                await conn.execute(
                    text("""
                        INSERT INTO highlights(id, user_id, book_id, start_location, end_location,
                                               color, comment, device_id, meta, tsv)
                        VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, cast(:bid as uuid),
                                :sl, :el, :color, :txt, :dev,
                                jsonb_build_object('clientId', :cid),
                                to_tsvector('simple', coalesce(:txt, '')))
                    """),
                    {
                        "id": hl_id, "bid": book_id, "sl": start_loc, "el": end_loc,
                        "color": color, "txt": text_content, "dev": device_id, "cid": client_id
                    },
                )
                highlight_results.append({
                    "clientId": client_id,
                    "serverId": hl_id,
                    "status": "created"
                })
                # 索引到搜索引擎
                index_highlight(hl_id, user_id, book_id, text_content or "", color or "", [])
        
        if highlight_results:
            push_results["highlights"] = highlight_results
        
        # 7. 更新 reading_progress 的版本字段
        await conn.execute(
            text("""
                UPDATE reading_progress SET
                    ocr_version = :ocr_ver,
                    metadata_version = :meta_ver,
                    vector_index_version = :vec_ver,
                    last_sync_at = now()
                WHERE user_id = current_setting('app.user_id')::uuid
                AND book_id = cast(:bid as uuid)
            """),
            {
                "bid": book_id,
                "ocr_ver": server_ocr_version,
                "meta_ver": server_metadata_version,
                "vec_ver": server_vector_version
            },
        )
        
        # 8. 获取待推送的服务端事件
        pending_events = []
        events_res = await conn.execute(
            text("""
                SELECT id, event_type, book_id::text, payload, created_at
                FROM sync_events
                WHERE user_id = current_setting('app.user_id')::uuid
                AND delivered_at IS NULL
                ORDER BY created_at ASC
                LIMIT 20
            """)
        )
        event_rows = events_res.fetchall()
        event_ids = []
        for ev in event_rows:
            event_ids.append(str(ev[0]))
            pending_events.append({
                "type": ev[1],
                "bookId": ev[2],
                "payload": ev[3],
                "createdAt": str(ev[4]) if ev[4] else None
            })
        
        # 标记事件为已投递
        if event_ids:
            await conn.execute(
                text("""
                    UPDATE sync_events SET delivered_at = now()
                    WHERE id = ANY(cast(:ids as uuid[]))
                """),
                {"ids": event_ids},
            )
        
        # 9. 计算下次心跳间隔
        # 如果有待拉取数据或还有更多数据要同步，缩短间隔
        has_more = client_updates.get("hasMore", False)
        more_to_sync = bool(pending_events) or bool(pull_required)
        
        if has_more or more_to_sync:
            next_heartbeat_ms = 5000  # 5 秒后立即再次心跳
        else:
            next_heartbeat_ms = HEARTBEAT_ACTIVE
    
    return {
        "serverVersions": {
            "ocr": server_ocr_version,
            "metadata": server_metadata_version,
            "vectorIndex": server_vector_version
        },
        "pullRequired": pull_required if pull_required else None,
        "pushResults": push_results if push_results else None,
        "nextHeartbeatMs": next_heartbeat_ms,
        "moreToSync": more_to_sync,
        "pendingEvents": pending_events if pending_events else None
    }

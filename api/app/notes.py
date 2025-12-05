"""
笔记、标签与高亮接口

职责：
- Tags：创建/列表/更新/删除（ETag 并发控制，幂等键支持）
- Notes：创建/列表/获取/更新/删除（全文索引同步）
- Highlights：创建/列表/更新/删除（全文索引同步）
- 冲突处理：列出冲突、基于用户选择进行解决并更新索引

说明：
- 仅新增注释，不改动业务逻辑与存储结构
"""
import base64
import os
import uuid
from datetime import timedelta

import redis
from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Response
from sqlalchemy import text

from .auth import require_user
from .celery_app import celery_app
from .db import engine
from .dependencies import require_write_permission
from .search_sync import delete_highlight as delete_highlight_from_index
from .search_sync import delete_note as delete_note_from_index
from .search_sync import index_highlight, index_note

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)


notes_router = APIRouter(prefix="/api/v1/notes", tags=["notes"])
tags_router = APIRouter(prefix="/api/v1/tags", tags=["tags"])
highlights_router = APIRouter(prefix="/api/v1/highlights", tags=["highlights"])


def encode_cursor(ts: str, id_: str) -> str:
    return base64.urlsafe_b64encode(f"{ts}|{id_}".encode()).decode()


def decode_cursor(cur: str) -> tuple[str, str]:
    s = base64.urlsafe_b64decode(cur.encode()).decode()
    a, b = s.split("|", 1)
    return a, b


@tags_router.post("")
async def create_tag(
    body: dict = Body(...),
    idempotency_key: str | None = Header(None),
    auth=Depends(require_user),
):
    user_id, _ = auth
    name = body.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="missing_name")
    if idempotency_key:
        v = r.get(f"idem:{idempotency_key}")
        if v:
            return {"status": "success", "data": {"id": v}}
    tag_id = str(uuid.uuid4())
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "INSERT INTO tags(id, user_id, name) VALUES (cast(:id as uuid), cast(:uid as uuid), :name) ON CONFLICT (user_id, name) WHERE deleted_at IS NULL DO NOTHING"
            ),
            {"id": tag_id, "uid": user_id, "name": name},
        )
    if idempotency_key:
        r.setex(
            f"idem:{idempotency_key}", int(timedelta(hours=24).total_seconds()), tag_id
        )
    return {"status": "success", "data": {"id": tag_id}}


@tags_router.get("")
async def list_tags(auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT id::text, name, updated_at, version FROM tags WHERE user_id = current_setting('app.user_id')::uuid AND deleted_at IS NULL ORDER BY updated_at DESC"
            )
        )
        rows = res.fetchall()
        return {
            "status": "success",
            "data": [
                {
                    "id": r[0],
                    "name": r[1],
                    "updated_at": str(r[2]),
                    "etag": f'W/"{int(r[3])}"',
                }
                for r in rows
            ],
        }


@tags_router.patch("/{tag_id}")
async def update_tag(
    tag_id: str,
    body: dict = Body(...),
    if_match: str | None = Header(None),
    auth=Depends(require_user),
):
    user_id, _ = auth
    if not if_match or not if_match.startswith('W/"'):
        raise HTTPException(status_code=428, detail="missing_if_match")
    try:
        current_version = int(if_match.split('"')[1])
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_if_match")
    name = body.get("name")
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "UPDATE tags SET name = COALESCE(:name, name), version = version + 1, updated_at = now() WHERE id = cast(:id as uuid) AND deleted_at IS NULL AND version = :ver"
            ),
            {"name": name, "id": tag_id, "ver": current_version},
        )
        if res.rowcount == 0:
            raise HTTPException(status_code=409, detail="version_conflict")
    return {"status": "success"}


@tags_router.delete("/{tag_id}")
async def delete_tag(tag_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "UPDATE tags SET deleted_at = now(), updated_at = now(), version = version + 1 WHERE id = cast(:id as uuid) AND deleted_at IS NULL"
            ),
            {"id": tag_id},
        )
    return {"status": "success"}


@notes_router.post("")
async def create_note(
    body: dict = Body(...),
    idempotency_key: str | None = Header(None),
    quota=Depends(require_write_permission),
    auth=Depends(require_user),
):
    user_id, _ = auth
    book_id = body.get("book_id")
    content = body.get("content")
    tags = body.get("tags") or []
    if not book_id or not content:
        raise HTTPException(status_code=400, detail="invalid_payload")
    if idempotency_key:
        v = r.get(f"idem:{idempotency_key}")
        if v:
            return {"status": "success", "data": {"id": v}}
    note_id = str(uuid.uuid4())
    chapter = body.get("chapter")
    location = body.get("location")
    offset = body.get("offset")
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "INSERT INTO notes(id, user_id, book_id, content, chapter, location, pos_offset, tsv) VALUES (cast(:id as uuid), cast(:uid as uuid), cast(:bid as uuid), :content, :chapter, :location, :offset, to_tsvector('simple', coalesce(:content,'') || ' ' || coalesce(:chapter,'')))"
            ),
            {
                "id": note_id,
                "uid": user_id,
                "bid": book_id,
                "content": content,
                "chapter": chapter,
                "location": location,
                "offset": offset,
            },
        )
        if tags:
            for t in tags:
                await conn.execute(
                    text(
                        "INSERT INTO note_tags(note_id, tag_id) VALUES (cast(:nid as uuid), cast(:tid as uuid)) ON CONFLICT DO NOTHING"
                    ),
                    {"nid": note_id, "tid": t},
                )
    if idempotency_key:
        r.setex(
            f"idem:{idempotency_key}", int(timedelta(hours=24).total_seconds()), note_id
        )
    index_note(note_id, user_id, book_id, content, tags)
    return {"status": "success", "data": {"id": note_id}}


@notes_router.get("")
async def list_notes(
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = Query(None),
    auth=Depends(require_user),
):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        if cursor:
            ts, nid = decode_cursor(cursor)
            res = await conn.execute(
                text(
                    "SELECT id::text, content, book_id::text, chapter, location, pos_offset, updated_at, version FROM notes WHERE user_id = current_setting('app.user_id')::uuid AND deleted_at IS NULL AND (updated_at, id) < (cast(:ts as timestamptz), cast(:id as uuid)) ORDER BY updated_at DESC, id DESC LIMIT :limit"
                ),
                {"ts": ts, "id": nid, "limit": limit},
            )
        else:
            res = await conn.execute(
                text(
                    "SELECT id::text, content, book_id::text, chapter, location, pos_offset, updated_at, version FROM notes WHERE user_id = current_setting('app.user_id')::uuid AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT :limit"
                ),
                {"limit": limit},
            )
        rows = res.fetchall()
        data = []
        next_cursor = None
        for r in rows:
            data.append(
                {
                    "id": r[0],
                    "content": r[1],
                    "book_id": r[2],
                    "chapter": r[3],
                    "location": r[4],
                    "offset": r[5],
                    "updated_at": str(r[6]),
                    "etag": f'W/"{int(r[7])}"',
                }
            )
        if rows:
            last = rows[-1]
            next_cursor = encode_cursor(str(last[6]), str(last[0]))
        return {"status": "success", "data": data, "next_cursor": next_cursor}


@notes_router.get("/{note_id}")
async def get_note(note_id: str, auth=Depends(require_user), response: Response = None):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT id::text, content, book_id::text, chapter, location, pos_offset, updated_at, version FROM notes WHERE id = cast(:id as uuid) AND deleted_at IS NULL"
            ),
            {"id": note_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="not_found")
        if response is not None:
            response.headers["ETag"] = f'W/"{int(row[7])}"'
        return {
            "status": "success",
            "data": {
                "id": row[0],
                "content": row[1],
                "book_id": row[2],
                "chapter": row[3],
                "location": row[4],
                "offset": row[5],
                "updated_at": str(row[6]),
                "etag": f'W/"{int(row[7])}"',
            },
        }


@notes_router.patch("/{note_id}")
async def update_note(
    note_id: str,
    body: dict = Body(...),
    if_match: str | None = Header(None),
    quota=Depends(require_write_permission),
    auth=Depends(require_user),
):
    user_id, _ = auth
    if not if_match or not if_match.startswith('W/"'):
        raise HTTPException(status_code=428, detail="missing_if_match")
    try:
        current_version = int(if_match.split('"')[1])
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_if_match")
    content = body.get("content")
    chapter = body.get("chapter")
    location = body.get("location")
    offset = body.get("offset")
    tags = body.get("tags")
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "UPDATE notes SET content = COALESCE(:content, content), chapter = COALESCE(:chapter, chapter), location = COALESCE(:location, location), pos_offset = COALESCE(:offset, pos_offset), tsv = to_tsvector('simple', coalesce(COALESCE(:content, content),'') || ' ' || coalesce(COALESCE(:chapter, chapter),'')), version = version + 1, updated_at = now() WHERE id = cast(:id as uuid) AND deleted_at IS NULL AND version = :ver"
            ),
            {
                "content": content,
                "chapter": chapter,
                "location": location,
                "offset": offset,
                "id": note_id,
                "ver": current_version,
            },
        )
        if res.rowcount == 0:
            raise HTTPException(status_code=409, detail="version_conflict")
        if isinstance(tags, list):
            await conn.execute(
                text("DELETE FROM note_tags WHERE note_id = cast(:nid as uuid)"),
                {"nid": note_id},
            )
            for t in tags:
                await conn.execute(
                    text(
                        "INSERT INTO note_tags(note_id, tag_id) VALUES (cast(:nid as uuid), cast(:tid as uuid)) ON CONFLICT DO NOTHING"
                    ),
                    {"nid": note_id, "tid": t},
                )
    index_note(
        note_id,
        user_id,
        None or "",
        content or "",
        tags if isinstance(tags, list) else None,
    )
    return {"status": "success"}


@notes_router.delete("/{note_id}")
async def delete_note(note_id: str, quota=Depends(require_write_permission), auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "UPDATE notes SET deleted_at = now(), updated_at = now(), version = version + 1 WHERE id = cast(:id as uuid) AND deleted_at IS NULL"
            ),
            {"id": note_id},
        )
    delete_note_from_index(note_id)
    return {"status": "success"}


@highlights_router.post("")
async def create_highlight(
    body: dict = Body(...),
    idempotency_key: str | None = Header(None),
    quota=Depends(require_write_permission),
    auth=Depends(require_user),
):
    user_id, _ = auth
    book_id = body.get("book_id")
    start_location = body.get("start_location")
    end_location = body.get("end_location")
    color = body.get("color")
    comment = body.get("comment")
    tags = body.get("tags") or []
    if not book_id or start_location is None or end_location is None:
        raise HTTPException(status_code=400, detail="invalid_payload")
    if idempotency_key:
        v = r.get(f"idem:{idempotency_key}")
        if v:
            return {"status": "success", "data": {"id": v}}
    hid = str(uuid.uuid4())
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "INSERT INTO highlights(id, user_id, book_id, start_location, end_location, color, comment, tsv) VALUES (cast(:id as uuid), cast(:uid as uuid), cast(:bid as uuid), :s, :e, :c, :m, to_tsvector('simple', coalesce(:c,'') || ' ' || coalesce(:m,'')))"
            ),
            {
                "id": hid,
                "uid": user_id,
                "bid": book_id,
                "s": start_location,
                "e": end_location,
                "c": color,
                "m": comment,
            },
        )
        for t in tags:
            await conn.execute(
                text(
                    "INSERT INTO highlight_tags(highlight_id, tag_id) VALUES (cast(:hid as uuid), cast(:tid as uuid)) ON CONFLICT DO NOTHING"
                ),
                {"hid": hid, "tid": t},
            )
    if idempotency_key:
        r.setex(
            f"idem:{idempotency_key}", int(timedelta(hours=24).total_seconds()), hid
        )
    index_highlight(hid, user_id, book_id, comment or "", color or "", tags)
    try:
        celery_app.send_task("tasks.generate_srs_card", args=[hid])
    except Exception:
        pass
    return {"status": "success", "data": {"id": hid}}


@highlights_router.get("")
async def list_highlights(
    book_id: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = Query(None),
    auth=Depends(require_user),
):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        base = "SELECT id::text, book_id::text, start_location, end_location, color, comment, updated_at, version FROM highlights WHERE user_id = current_setting('app.user_id')::uuid AND deleted_at IS NULL"
        params = {}
        if book_id:
            base += " AND book_id = cast(:bid as uuid)"
            params["bid"] = book_id
        if cursor:
            ts, hid = decode_cursor(cursor)
            base += (
                " AND (updated_at, id) < (cast(:ts as timestamptz), cast(:id as uuid))"
            )
            params["ts"] = ts
            params["id"] = hid
        base += " ORDER BY updated_at DESC, id DESC LIMIT :limit"
        params["limit"] = limit
        res = await conn.execute(text(base), params)
        rows = res.fetchall()
        data = []
        next_cursor = None
        for r in rows:
            data.append(
                {
                    "id": r[0],
                    "book_id": r[1],
                    "start_location": r[2],
                    "end_location": r[3],
                    "color": r[4],
                    "comment": r[5],
                    "updated_at": str(r[6]),
                    "etag": f'W/"{int(r[7])}"',
                }
            )
        if rows:
            last = rows[-1]
            next_cursor = encode_cursor(str(last[6]), str(last[0]))
        return {"status": "success", "data": data, "next_cursor": next_cursor}


@highlights_router.patch("/{highlight_id}")
async def update_highlight(
    highlight_id: str,
    body: dict = Body(...),
    if_match: str | None = Header(None),
    quota=Depends(require_write_permission),
    auth=Depends(require_user),
):
    user_id, _ = auth
    if not if_match or not if_match.startswith('W/"'):
        raise HTTPException(status_code=428, detail="missing_if_match")
    try:
        current_version = int(if_match.split('"')[1])
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_if_match")
    color = body.get("color")
    comment = body.get("comment")
    tags = body.get("tags")
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "UPDATE highlights SET color = COALESCE(:color, color), comment = COALESCE(:comment, comment), tsv = to_tsvector('simple', coalesce(COALESCE(:color, color),'') || ' ' || coalesce(COALESCE(:comment, comment),'')), version = version + 1, updated_at = now() WHERE id = cast(:id as uuid) AND deleted_at IS NULL AND version = :ver"
            ),
            {
                "color": color,
                "comment": comment,
                "id": highlight_id,
                "ver": current_version,
            },
        )
        if res.rowcount == 0:
            raise HTTPException(status_code=409, detail="version_conflict")
        if isinstance(tags, list):
            await conn.execute(
                text(
                    "DELETE FROM highlight_tags WHERE highlight_id = cast(:hid as uuid)"
                ),
                {"hid": highlight_id},
            )
            for t in tags:
                await conn.execute(
                    text(
                        "INSERT INTO highlight_tags(highlight_id, tag_id) VALUES (cast(:hid as uuid), cast(:tid as uuid)) ON CONFLICT DO NOTHING"
                    ),
                    {"hid": highlight_id, "tid": t},
                )
    index_highlight(
        highlight_id,
        user_id,
        None or "",
        comment or "",
        color or "",
        tags if isinstance(tags, list) else None,
    )
    return {"status": "success"}


@highlights_router.delete("/{highlight_id}")
async def delete_highlight(highlight_id: str, quota=Depends(require_write_permission), auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "UPDATE highlights SET deleted_at = now(), updated_at = now(), version = version + 1 WHERE id = cast(:id as uuid) AND deleted_at IS NULL"
            ),
            {"id": highlight_id},
        )
    delete_highlight_from_index(highlight_id)
    return {"status": "success"}


# =============================================
# 笔记冲突处理 API (ADR-006)
# =============================================

@notes_router.get("/conflicts")
async def list_note_conflicts(auth=Depends(require_user)):
    """
    获取当前用户所有存在冲突的笔记。
    
    冲突笔记是指 conflict_of IS NOT NULL 的记录，表示该笔记是某个原始笔记的冲突副本。
    返回原始笔记和冲突副本的配对信息，供用户在 UI 上选择保留哪个版本。
    """
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        
        # 查询所有冲突副本及其原始笔记
        res = await conn.execute(
            text("""
                SELECT 
                    orig.id::text as original_id,
                    orig.content as original_content,
                    orig.updated_at as original_updated_at,
                    orig.device_id as original_device_id,
                    conflict.id::text as conflict_copy_id,
                    conflict.content as conflict_content,
                    conflict.updated_at as conflict_updated_at,
                    conflict.device_id as conflict_device_id,
                    orig.book_id::text as book_id,
                    b.title as book_title
                FROM notes conflict
                JOIN notes orig ON conflict.conflict_of = orig.id
                JOIN books b ON orig.book_id = b.id
                WHERE conflict.user_id = current_setting('app.user_id')::uuid
                  AND conflict.conflict_of IS NOT NULL
                  AND conflict.deleted_at IS NULL
                  AND orig.deleted_at IS NULL
                ORDER BY conflict.updated_at DESC
            """)
        )
        rows = res.fetchall()
        
        conflicts = []
        for r in rows:
            conflicts.append({
                "originalId": r[0],
                "originalContent": r[1],
                "originalUpdatedAt": str(r[2]) if r[2] else None,
                "originalDeviceId": r[3],
                "conflictCopyId": r[4],
                "conflictContent": r[5],
                "conflictUpdatedAt": str(r[6]) if r[6] else None,
                "conflictDeviceId": r[7],
                "bookId": r[8],
                "bookTitle": r[9]
            })
        
        return {"conflicts": conflicts}


@notes_router.post("/{note_id}/resolve-conflict")
async def resolve_note_conflict(
    note_id: str,
    body: dict = Body(...),
    auth=Depends(require_user),
):
    """
    解决笔记冲突。用户选择保留哪个版本或手动合并。
    
    Request Body:
    {
        "resolution": "keep_original" | "keep_conflict" | "merge",
        "mergedContent"?: string  // 仅当 resolution=merge 时需要
    }
    
    处理逻辑:
    - keep_original: 删除冲突副本，保留原始笔记
    - keep_conflict: 用冲突副本内容更新原始笔记，然后删除冲突副本
    - merge: 用 mergedContent 更新原始笔记，然后删除冲突副本
    """
    user_id, _ = auth
    resolution = body.get("resolution")
    merged_content = body.get("mergedContent")
    
    if resolution not in ("keep_original", "keep_conflict", "merge"):
        raise HTTPException(status_code=400, detail="invalid_resolution")
    
    if resolution == "merge" and not merged_content:
        raise HTTPException(status_code=400, detail="merged_content_required")
    
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        
        # 检查 note_id 是否是冲突副本
        res = await conn.execute(
            text("""
                SELECT id, conflict_of, content
                FROM notes
                WHERE id = cast(:id as uuid)
                  AND user_id = current_setting('app.user_id')::uuid
                  AND deleted_at IS NULL
            """),
            {"id": note_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="note_not_found")
        
        note_id_db, conflict_of, conflict_content = row
        
        if not conflict_of:
            raise HTTPException(status_code=400, detail="not_a_conflict_copy")
        
        original_id = str(conflict_of)
        
        if resolution == "keep_original":
            # 删除冲突副本，保留原始笔记
            await conn.execute(
                text("""
                    UPDATE notes SET deleted_at = now(), updated_at = now()
                    WHERE id = cast(:id as uuid)
                """),
                {"id": note_id},
            )
            final_content = None  # 保留原始内容，不需要获取
            
        elif resolution == "keep_conflict":
            # 用冲突副本内容更新原始笔记
            await conn.execute(
                text("""
                    UPDATE notes SET 
                        content = :content,
                        tsv = to_tsvector('simple', coalesce(:content, '')),
                        version = version + 1,
                        updated_at = now()
                    WHERE id = cast(:orig_id as uuid)
                """),
                {"content": conflict_content, "orig_id": original_id},
            )
            # 删除冲突副本
            await conn.execute(
                text("""
                    UPDATE notes SET deleted_at = now(), updated_at = now()
                    WHERE id = cast(:id as uuid)
                """),
                {"id": note_id},
            )
            final_content = conflict_content
            
        else:  # merge
            # 用合并内容更新原始笔记
            await conn.execute(
                text("""
                    UPDATE notes SET 
                        content = :content,
                        tsv = to_tsvector('simple', coalesce(:content, '')),
                        version = version + 1,
                        updated_at = now()
                    WHERE id = cast(:orig_id as uuid)
                """),
                {"content": merged_content, "orig_id": original_id},
            )
            # 删除冲突副本
            await conn.execute(
                text("""
                    UPDATE notes SET deleted_at = now(), updated_at = now()
                    WHERE id = cast(:id as uuid)
                """),
                {"id": note_id},
            )
            final_content = merged_content
        
        # 获取最终的笔记内容
        if final_content is None:
            final_res = await conn.execute(
                text("SELECT content FROM notes WHERE id = cast(:id as uuid)"),
                {"id": original_id},
            )
            final_row = final_res.fetchone()
            final_content = final_row[0] if final_row else ""
    
    # 删除冲突副本的搜索索引
    delete_note_from_index(note_id)
    
    return {
        "noteId": original_id,
        "content": final_content,
        "resolved": True
    }

"""
书架相关路由

包含：
- / [POST] - 创建书架
- / [GET] - 书架列表
- /{shelf_id} [PATCH] - 更新书架
- /{shelf_id} [DELETE] - 删除书架
- /{shelf_id}/items [POST] - 添加书籍到书架
- /{shelf_id}/items [GET] - 获取书架内书籍
- /{shelf_id}/items/{book_id} [DELETE] - 从书架移除书籍
"""
from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query
from sqlalchemy import text

from .common import (
    BOOKS_BUCKET, r, engine, uuid, presigned_get,
    require_user, require_write_permission,
)

router = APIRouter()


@router.post("/")
async def create_shelf(
    body: dict = Body(...),
    idempotency_key: str | None = Header(None),
    quota=Depends(require_write_permission),
    auth=Depends(require_user),
):
    user_id, _ = auth
    name = body.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="missing_name")
    description = body.get("description") or ""
    if idempotency_key:
        idem_key = f"idem:shelves:create:{user_id}:{idempotency_key}"
        cached = r.get(idem_key)
        if cached:
            return {"status": "success", "data": {"id": cached}}
    shelf_id = str(uuid.uuid4())
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "INSERT INTO shelves(id, user_id, name, description) VALUES (cast(:id as uuid), cast(:uid as uuid), :name, :desc)"
            ),
            {"id": shelf_id, "uid": user_id, "name": name, "desc": description},
        )
    if idempotency_key:
        r.setex(idem_key, 24 * 3600, shelf_id)
    return {"status": "success", "data": {"id": shelf_id}}


@router.get("/")
async def list_shelves(
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = Query(None),
    auth=Depends(require_user),
):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        cond = "WHERE user_id = current_setting('app.user_id')::uuid"
        order = "ORDER BY updated_at DESC, id DESC"
        params = {"limit": limit + 1}
        if cursor:
            try:
                ts_str, last_id = cursor.split("|", 1)
                cond += " AND (updated_at < cast(:ts as timestamptz) OR (updated_at = cast(:ts as timestamptz) AND id < cast(:id as uuid)))"
                params.update({"ts": ts_str, "id": last_id})
            except Exception:
                pass
        q = text(
            """
            SELECT id::text, name, description, updated_at, version
            FROM shelves
            """
            + cond
            + "\n"
            + order
            + "\n"
            + "LIMIT :limit"
        )
        res = await conn.execute(q, params)
        rows = res.fetchall()
        take = rows[:limit]
        items = [
            {
                "id": r[0],
                "name": r[1],
                "description": r[2],
                "updated_at": str(r[3]),
                "etag": f'W/"{int(r[4])}"',
            }
            for r in take
        ]
        next_cursor = None
        if len(rows) > limit:
            last = take[-1]
            next_cursor = f"{last[3]}|{last[0]}"
        return {
            "status": "success",
            "data": {
                "items": items,
                "next_cursor": next_cursor,
                "has_more": len(rows) > limit,
            },
        }


@router.patch("/{shelf_id}")
async def update_shelf(
    shelf_id: str,
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
    name = body.get("name")
    description = body.get("description")
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                """
            UPDATE shelves SET
              name = COALESCE(:name, name),
              description = COALESCE(:desc, description),
              version = version + 1,
              updated_at = now()
            WHERE id = cast(:id as uuid) AND version = :ver
            """
            ),
            {"name": name, "desc": description, "id": shelf_id, "ver": current_version},
        )
        if res.rowcount == 0:
            raise HTTPException(status_code=409, detail="version_conflict")
    return {"status": "success"}


@router.delete("/{shelf_id}")
async def delete_shelf(
    shelf_id: str,
    quota=Depends(require_write_permission),
    auth=Depends(require_user),
):
    """删除书架（同时删除书架内的关联关系）"""
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        # 先删除书架内的书籍关联
        await conn.execute(
            text(
                """
            DELETE FROM shelf_items 
            WHERE shelf_id = cast(:sid as uuid)
              AND shelf_id IN (SELECT id FROM shelves WHERE user_id = current_setting('app.user_id')::uuid)
            """
            ),
            {"sid": shelf_id},
        )
        # 再删除书架本身
        res = await conn.execute(
            text(
                """
            DELETE FROM shelves 
            WHERE id = cast(:sid as uuid) 
              AND user_id = current_setting('app.user_id')::uuid
            """
            ),
            {"sid": shelf_id},
        )
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="shelf_not_found")
    return {"status": "success"}


@router.post("/{shelf_id}/items")
async def add_item(
    shelf_id: str,
    body: dict = Body(...),
    idempotency_key: str | None = Header(None),
    quota=Depends(require_write_permission),
    auth=Depends(require_user),
):
    user_id, _ = auth
    book_id = body.get("book_id")
    if not book_id:
        raise HTTPException(status_code=400, detail="missing_book_id")
    if idempotency_key:
        idem_key = (
            f"idem:shelves:add_item:{user_id}:{shelf_id}:{book_id}:{idempotency_key}"
        )
        if r.get(idem_key):
            return {"status": "success"}
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "INSERT INTO shelf_items(shelf_id, book_id) VALUES (cast(:sid as uuid), cast(:bid as uuid)) ON CONFLICT DO NOTHING"
            ),
            {"sid": shelf_id, "bid": book_id},
        )
    if idempotency_key:
        r.setex(idem_key, 24 * 3600, "1")
    return {"status": "success"}


@router.get("/{shelf_id}/items")
async def list_items(shelf_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                """
            SELECT b.id::text, b.title, b.author, b.language, b.minio_key
            FROM shelf_items si
            JOIN books b ON b.id = si.book_id
            WHERE si.shelf_id = cast(:sid as uuid)
            ORDER BY b.updated_at DESC
            """
            ),
            {"sid": shelf_id},
        )
        rows = res.fetchall()
        return {
            "status": "success",
            "data": [
                {
                    "id": r[0],
                    "title": r[1],
                    "author": r[2],
                    "language": r[3],
                    "download_url": presigned_get(BOOKS_BUCKET, r[4]),
                }
                for r in rows
            ],
        }


@router.delete("/{shelf_id}/items/{book_id}")
async def remove_item(
    shelf_id: str,
    book_id: str,
    idempotency_key: str | None = Header(None),
    quota=Depends(require_write_permission),
    auth=Depends(require_user),
):
    user_id, _ = auth
    if idempotency_key:
        idem_key = (
            f"idem:shelves:remove_item:{user_id}:{shelf_id}:{book_id}:{idempotency_key}"
        )
        if r.get(idem_key):
            return {"status": "success"}
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "DELETE FROM shelf_items WHERE shelf_id = cast(:sid as uuid) AND book_id = cast(:bid as uuid)"
            ),
            {"sid": shelf_id, "bid": book_id},
        )
    if idempotency_key:
        r.setex(idem_key, 24 * 3600, "1")
    return {"status": "success"}

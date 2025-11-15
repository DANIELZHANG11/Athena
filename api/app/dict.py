import os
import uuid
from datetime import timedelta
from fastapi import APIRouter, Body, Depends, Header, HTTPException
from sqlalchemy import text
from .db import engine
from .auth import require_user
from .storage import make_object_key, presigned_put, presigned_get
import redis

packages_router = APIRouter(prefix="/api/v1/dict/packages", tags=["dict"])
dict_router = APIRouter(prefix="/api/v1/dict", tags=["dict"])

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)

@packages_router.post("/upload_init")
async def upload_init(body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    name = body.get("name")
    lang = body.get("lang")
    version = int(body.get("version") or 1)
    if not name or not lang:
        raise HTTPException(status_code=400, detail="invalid_payload")
    pid = str(uuid.uuid4())
    key = make_object_key(user_id, f"dict-{pid}.bin")
    put_url = presigned_put(os.getenv("MINIO_BUCKET", "athena"), key)
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        await conn.execute(text("INSERT INTO dictionary_packages(id, owner_id, name, lang, version, minio_key, status) VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, :n, :l, :v, :k, 'uploading')"), {"id": pid, "n": name, "l": lang, "v": version, "k": key})
    return {"status": "success", "data": {"id": pid, "put_url": put_url}}

@packages_router.post("/upload_complete")
async def upload_complete(body: dict = Body(...), idempotency_key: str | None = Header(None), auth=Depends(require_user)):
    user_id, _ = auth
    pid = body.get("id")
    if not pid:
        raise HTTPException(status_code=400, detail="missing_id")
    if idempotency_key:
        v = r.get(f"idem:{idempotency_key}")
        if v:
            return {"status": "success"}
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        res = await conn.execute(text("UPDATE dictionary_packages SET status = 'ready', updated_at = now() WHERE id = cast(:id as uuid) AND owner_id = current_setting('app.user_id')::uuid AND deleted_at IS NULL"), {"id": pid})
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="not_found")
    if idempotency_key:
        r.setex(f"idem:{idempotency_key}", int(timedelta(hours=24).total_seconds()), pid)
    return {"status": "success"}

@packages_router.get("")
async def list_packages(auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        res = await conn.execute(text("SELECT id::text, name, lang, version, minio_key, status, updated_at FROM dictionary_packages WHERE owner_id = current_setting('app.user_id')::uuid AND deleted_at IS NULL ORDER BY updated_at DESC"))
        rows = res.fetchall()
        return {"status": "success", "data": [{"id": r[0], "name": r[1], "lang": r[2], "version": int(r[3]), "minio_key": r[4], "status": r[5], "updated_at": str(r[6])} for r in rows]}

@dict_router.post("/lookup")
async def lookup(body: dict = Body(...), idempotency_key: str | None = Header(None), auth=Depends(require_user)):
    user_id, _ = auth
    word = body.get("word")
    lang = body.get("lang") or "en"
    package_id = body.get("package_id")
    book_id = body.get("book_id")
    if not word:
        raise HTTPException(status_code=400, detail="missing_word")
    if idempotency_key:
        v = r.get(f"idem:{idempotency_key}")
        if v:
            return {"status": "success", "data": {"definition": v}}
    definition = None
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        did = str(uuid.uuid4())
        await conn.execute(text("INSERT INTO dict_history(id, owner_id, word, lang, package_id, book_id, definition) VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, :w, :l, cast(:pid as uuid), cast(:bid as uuid), :d)"), {"id": did, "w": word, "l": lang, "pid": package_id, "bid": book_id, "d": definition})
    if idempotency_key:
        r.setex(f"idem:{idempotency_key}", int(timedelta(hours=24).total_seconds()), definition or "")
    return {"status": "success", "data": {"definition": definition}}

@dict_router.get("/history")
async def history(limit: int = 50, offset: int = 0, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        res = await conn.execute(text("SELECT id::text, word, lang, definition, created_at FROM dict_history WHERE owner_id = current_setting('app.user_id')::uuid ORDER BY created_at DESC LIMIT :l OFFSET :o"), {"l": limit, "o": offset})
        rows = res.fetchall()
        return {"status": "success", "data": [{"id": r[0], "word": r[1], "lang": r[2], "definition": r[3], "created_at": str(r[4])} for r in rows]}
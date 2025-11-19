import asyncio
import os
import time
import redis
import hashlib
from prometheus_client import Counter, Histogram
from fastapi import APIRouter, Depends, Query, Header, HTTPException, Body
from fastapi.responses import StreamingResponse
from .auth import require_user
from .db import engine
from sqlalchemy import text

router = APIRouter(prefix="/api/v1/ai", tags=["ai"]) 

def _sse(data: str) -> bytes:
    return ("data: " + data + "\n\n").encode()

def _auth_from_qs(token: str | None) -> tuple[str | None, str | None]:
    return (None, None) if not token else ("", "")

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)

AI_SSE_LATENCY = Histogram('ai_sse_latency_ms', 'AI SSE latency (ms)')
AI_SSE_CACHE_HIT = Counter('ai_sse_cache_hit_total', 'AI SSE cache hits')
AI_SSE_CACHE_MISS = Counter('ai_sse_cache_miss_total', 'AI SSE cache misses')

@router.get("/stream")
async def stream(prompt: str = Query(""), conversation_id: str | None = Query(None), access_token: str | None = Query(None), authorization: str | None = Header(None)):
    try:
        if access_token:
            authorization = "Bearer " + access_token
        user_id, _ = require_user(authorization)
    except Exception:
        raise HTTPException(status_code=401, detail="unauthorized")
    async def gen():
        yield _sse("BEGIN")
        text = prompt or "Hello"
        qh = hashlib.sha256((text).encode()).hexdigest()
        key = f"ai_cache:{user_id}:{qh}"
        cached = r.get(key)
        start = time.time()
        conv_id = conversation_id
        if not conv_id:
            import uuid as _uuid
            conv_id = str(_uuid.uuid4())
            async with engine.begin() as conn:
                await conn.execute(text("INSERT INTO ai_conversations(id, owner_id, title) VALUES (cast(:id as uuid), cast(:uid as uuid), :t)"), {"id": conv_id, "uid": user_id, "t": text[:32]})
        async with engine.begin() as conn:
            import uuid as _uuid
            await conn.execute(text("INSERT INTO ai_messages(id, conversation_id, owner_id, role, content) VALUES (cast(:id as uuid), cast(:cid as uuid), cast(:uid as uuid), 'user', :c)"), {"id": str(_uuid.uuid4()), "cid": conv_id, "uid": user_id, "c": text})
        cache_hit = bool(cached)
        if cache_hit:
            for i in range(0, len(cached), 16):
                await asyncio.sleep(0.02)
                yield _sse(cached[i:i+16])
        else:
            out = ""
            for i in range(0, len(text), 4):
                await asyncio.sleep(0.1)
                chunk = text[i:i+4]
                out += chunk
                yield _sse(chunk)
            r.setex(key, 600, out)
            cached = out
        async with engine.begin() as conn:
            import uuid as _uuid
            await conn.execute(text("INSERT INTO ai_messages(id, conversation_id, owner_id, role, content) VALUES (cast(:id as uuid), cast(:cid as uuid), cast(:uid as uuid), 'assistant', :c)"), {"id": str(_uuid.uuid4()), "cid": conv_id, "uid": user_id, "c": cached or text})
            # upsert cache record
            await conn.execute(text("INSERT INTO ai_query_cache(owner_id, conversation_id, query_hash, prompt, response) VALUES (cast(:uid as uuid), cast(:cid as uuid), :qh, :p, :r) ON CONFLICT (owner_id, query_hash) DO UPDATE SET response = EXCLUDED.response, conversation_id = EXCLUDED.conversation_id"), {"uid": user_id, "cid": conv_id, "qh": qh, "p": text, "r": cached or text})
        dur = int((time.time() - start) * 1000)
        if cache_hit:
            AI_SSE_CACHE_HIT.inc()
        else:
            AI_SSE_CACHE_MISS.inc()
        AI_SSE_LATENCY.observe(dur)
        yield _sse(f"LATENCY={dur}ms")
        yield _sse("END")
    headers = {"X-Cache-Hit": "true" if r.ttl(key) > 0 and r.get(key) else "false"}
    return StreamingResponse(gen(), media_type="text/event-stream", headers=headers)

@router.get("/conversations")
async def list_conversations(auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        res = await conn.execute(text("SELECT id::text, title, created_at FROM ai_conversations WHERE owner_id = cast(:uid as uuid) ORDER BY created_at DESC"), {"uid": user_id})
        rows = res.fetchall()
        return {"status": "success", "data": [{"id": r[0], "title": r[1], "created_at": str(r[2])} for r in rows]}

@router.post("/conversations")
async def create_conversation(body: dict = Body({}), auth=Depends(require_user)):
    user_id, _ = auth
    import uuid as _uuid
    cid = str(_uuid.uuid4())
    title = (body or {}).get("title") or ""
    mode = (body or {}).get("mode") or "default"
    book_ids = (body or {}).get("book_ids") or []
    async with engine.begin() as conn:
        await conn.execute(text("INSERT INTO ai_conversations(id, owner_id, title) VALUES (cast(:id as uuid), cast(:uid as uuid), :t)"), {"id": cid, "uid": user_id, "t": title})
        await conn.execute(text("INSERT INTO ai_conversation_contexts(conversation_id, owner_id, mode, book_ids) VALUES (cast(:cid as uuid), cast(:uid as uuid), :m, cast(:ids as jsonb)) ON CONFLICT (conversation_id) DO UPDATE SET mode = EXCLUDED.mode, book_ids = EXCLUDED.book_ids, updated_at = now()"), {"cid": cid, "uid": user_id, "m": mode, "ids": book_ids})
    return {"status": "success", "data": {"id": cid}}

@router.get("/messages")
async def list_messages(conversation_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        res = await conn.execute(text("SELECT role, content, created_at FROM ai_messages WHERE owner_id = cast(:uid as uuid) AND conversation_id = cast(:cid as uuid) ORDER BY created_at ASC"), {"uid": user_id, "cid": conversation_id})
        rows = res.fetchall()
        return {"status": "success", "data": [{"role": r[0], "content": r[1], "created_at": str(r[2])} for r in rows]}
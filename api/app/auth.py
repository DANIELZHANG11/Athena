import os
import uuid
import time
import threading
from fastapi import APIRouter, Body, Depends, Header, HTTPException
from jose import jwt
from sqlalchemy import text
from .db import engine
import redis
from .mailer import send_email

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

AUTH_SECRET = os.getenv("AUTH_SECRET", "dev_secret")
DEV_MODE = os.getenv("DEV_MODE", "true").lower() == "true"
ACCESS_EXPIRE = int(os.getenv("ACCESS_EXPIRE", "3600"))
REFRESH_EXPIRE = int(os.getenv("REFRESH_EXPIRE", "2592000"))
_ru = os.getenv("REDIS_URL")
if _ru and "://" in _ru:
    try:
        from urllib.parse import urlparse
        _p = urlparse(_ru)
        REDIS_HOST = _p.hostname or "redis"
        REDIS_PORT = _p.port or 6379
    except Exception:
        REDIS_HOST = os.getenv("REDIS_HOST", "redis")
        REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
else:
    REDIS_HOST = os.getenv("REDIS_HOST", "redis")
    REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
_mem = {}

def issue_tokens(user_id: str, session_id: str):
    now = int(time.time())
    access = jwt.encode({"sub": user_id, "sid": session_id, "iat": now, "exp": now + ACCESS_EXPIRE}, AUTH_SECRET, algorithm="HS256")
    refresh = str(uuid.uuid4())
    r.setex(f"refresh:{refresh}", REFRESH_EXPIRE, f"{user_id}:{session_id}")
    r.setex(f"refresh_session:{session_id}", REFRESH_EXPIRE, refresh)
    return {"access_token": access, "refresh_token": refresh, "expires_in": ACCESS_EXPIRE}

def require_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="unauthorized")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, AUTH_SECRET)
        return payload["sub"], payload.get("sid")
    except Exception:
        raise HTTPException(status_code=401, detail="invalid_token")

@router.post("/email/send_code")
@router.post("/email/send-code")
def send_email_code(email: dict = Body(...), idempotency_key: str | None = Header(None), x_client_request_id: str | None = Header(None)):
    addr = email.get("email")
    if not addr:
        raise HTTPException(status_code=400, detail="invalid_email")
    try:
        if r.get(f"email_rate:{addr}"):
            raise HTTPException(status_code=429, detail="rate_limited")
    except Exception:
        pass
    code = str(uuid.uuid4().int)[-6:]
    print(code)
    try:
        r.setex(f"email_code:{addr}", 600, code)
    except Exception:
        _mem[f"email_code:{addr}"] = code
    threading.Thread(target=send_email, args=(addr, "Your Athena Code", f"Your code is: {code}"), daemon=True).start()
    try:
        r.setex(f"email_rate:{addr}", 60, "1")
    except Exception:
        _mem[f"email_rate:{addr}"] = "1"
    data = {"request_id": str(uuid.uuid4()), "message": "sent"}
    if os.getenv("DEV_MODE", "true").lower() == "true":
        data["dev_code"] = code
    return {"status": "success", "data": data}

@router.get("/email/dev_code")
def get_dev_code(email: str):
    if not (os.getenv("DEV_MODE", "true").lower() == "true"):
        raise HTTPException(status_code=403, detail="forbidden")
    if not email:
        raise HTTPException(status_code=400, detail="invalid_email")
    try:
        code = r.get(f"email_code:{email}")
    except Exception:
        code = _mem.get(f"email_code:{email}")
    if not code:
        raise HTTPException(status_code=404, detail="not_found")
    return {"status": "success", "data": {"email": email, "code": code}}

@router.post("/email/verify_code")
@router.post("/email/verify-code")
async def verify_email_code(payload: dict = Body(...)):
    addr = payload.get("email")
    code = payload.get("code")
    if not addr or not code:
        raise HTTPException(status_code=400, detail="invalid_payload")
    try:
        saved = r.get(f"email_code:{addr}")
    except Exception:
        saved = _mem.get(f"email_code:{addr}")
    if not saved or saved != code:
        raise HTTPException(status_code=401, detail="invalid_code")
    user_id = str(uuid.uuid4())
    session_id = str(uuid.uuid4())
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.role', 'admin', true)"))
        
        await conn.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS users (
              id uuid PRIMARY KEY,
              email text UNIQUE NOT NULL,
              display_name text NOT NULL DEFAULT '',
              is_active boolean NOT NULL DEFAULT TRUE,
              updated_at timestamptz NOT NULL DEFAULT now()
            );
            """
        )
        await conn.exec_driver_sql("ALTER TABLE users ADD COLUMN IF NOT EXISTS membership_tier TEXT NOT NULL DEFAULT 'FREE'")
        await conn.exec_driver_sql("ALTER TABLE users ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1")
        await conn.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS user_sessions (
              id uuid PRIMARY KEY,
              user_id uuid NOT NULL REFERENCES users(id),
              revoked boolean NOT NULL DEFAULT FALSE,
              created_at timestamptz NOT NULL DEFAULT now()
            );
            """
        )
        # 查或建用户（幂等）
        res = await conn.execute(text("SELECT id::text FROM users WHERE email = :email"), {"email": addr})
        row = res.fetchone()
        if not row:
            await conn.execute(text("INSERT INTO users(id, email, display_name, is_active, updated_at) VALUES (cast(:uid as uuid), :email, '', TRUE, now()) ON CONFLICT (email) DO NOTHING"), {"uid": user_id, "email": addr})
            res = await conn.execute(text("SELECT id::text FROM users WHERE email = :email"), {"email": addr})
            row = res.fetchone()
        user_id = row[0]
        await conn.execute(text("INSERT INTO user_sessions(id, user_id) VALUES (cast(:id as uuid), cast(:uid as uuid))"), {"id": session_id, "uid": user_id})
    tokens = issue_tokens(user_id, session_id)
    return {"status": "success", "data": {"user": {"id": user_id, "email": addr, "display_name": "", "is_active": True}, "tokens": tokens, "session": {"id": session_id}}}

@router.post("/refresh")
def refresh_tokens(body: dict = Body(...)):
    rt = body.get("refresh_token")
    if not rt:
        raise HTTPException(status_code=400, detail="missing_refresh_token")
    v = r.get(f"refresh:{rt}")
    if not v:
        raise HTTPException(status_code=401, detail="invalid_refresh")
    user_id, session_id = v.split(":")
    tokens = issue_tokens(user_id, session_id)
    return {"status": "success", "data": tokens}

@router.post("/logout")
async def logout(body: dict = Body(...), auth=Depends(require_user)):
    user_id, sid = auth
    session_id = body.get("session_id") or sid
    if not session_id:
        raise HTTPException(status_code=400, detail="missing_session")
    r.delete(f"refresh_session:{session_id}")
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE user_sessions SET revoked = TRUE WHERE id = cast(:id as uuid) AND user_id = cast(:uid as uuid)"), {"id": session_id, "uid": user_id})
    return {"status": "success"}

@router.get("/sessions")
async def list_sessions(auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        res = await conn.execute(text("SELECT id::text, revoked, created_at FROM user_sessions WHERE user_id = current_setting('app.user_id')::uuid ORDER BY created_at DESC"))
        rows = res.fetchall()
        return {"status": "success", "data": [{"id": r[0], "is_active": not bool(r[1]), "created_at": str(r[2])} for r in rows]}

@router.get("/me")
async def get_me(auth=Depends(require_user)):
    user_id, _ = auth
    return {"status": "success", "data": {"id": user_id, "email": "", "display_name": "", "is_active": True}}
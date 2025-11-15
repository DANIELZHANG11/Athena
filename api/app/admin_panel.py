import os
import uuid
from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import text
from .db import engine
from .auth import require_user

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

def _require_admin(user_id: str):
    if os.getenv("DEV_MODE", "true").lower() == "true":
        return
    aid = os.getenv("ADMIN_USER_ID", "")
    if not aid or aid != user_id:
        raise HTTPException(status_code=403, detail="forbidden")

async def _ensure(conn):
    await conn.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS system_settings (
          id UUID PRIMARY KEY,
          key TEXT UNIQUE NOT NULL,
          value JSONB NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS feature_flags (
          id UUID PRIMARY KEY,
          key TEXT UNIQUE NOT NULL,
          is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS prompt_templates (
          id UUID PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          content TEXT NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS ai_models (
          id UUID PRIMARY KEY,
          provider TEXT NOT NULL,
          model_id TEXT UNIQUE NOT NULL,
          display_name TEXT NOT NULL,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS audit_logs (
          id UUID PRIMARY KEY,
          owner_id UUID NOT NULL,
          action TEXT NOT NULL,
          details JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        );
        """
    )

async def _audit(conn, owner_id: str, action: str, details: dict):
    import json as _json
    await conn.execute(text("INSERT INTO audit_logs(id, owner_id, action, details) VALUES (gen_random_uuid(), cast(:uid as uuid), :act, cast(:det as jsonb))"), {"uid": owner_id, "act": action, "det": _json.dumps(details)})

@router.get("/system/settings")
async def get_settings(auth=Depends(require_user)):
    _require_admin(auth[0])
    async with engine.begin() as conn:
        await _ensure(conn)
        res = await conn.execute(text("SELECT key, value, updated_at FROM system_settings ORDER BY key"))
        rows = res.fetchall()
        return {"status": "success", "data": [{"key": r[0], "value": r[1], "updated_at": str(r[2])} for r in rows]}

@router.put("/system/settings")
async def put_settings(body: dict = Body(...), auth=Depends(require_user)):
    _require_admin(auth[0])
    async with engine.begin() as conn:
        await _ensure(conn)
        for k, v in (body or {}).items():
            await conn.execute(text("INSERT INTO system_settings(id, key, value) VALUES (gen_random_uuid(), :k, cast(:v as jsonb)) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()"), {"k": k, "v": v})
        await _audit(conn, auth[0], "update_system_settings", body or {})
    return {"status": "success"}

@router.get("/feature/flags")
async def get_flags(auth=Depends(require_user)):
    _require_admin(auth[0])
    async with engine.begin() as conn:
        await _ensure(conn)
        res = await conn.execute(text("SELECT key, is_enabled, updated_at FROM feature_flags ORDER BY key"))
        rows = res.fetchall()
        return {"status": "success", "data": [{"key": r[0], "is_enabled": bool(r[1]), "updated_at": str(r[2])} for r in rows]}

@router.put("/feature/flags")
async def put_flags(body: dict = Body(...), auth=Depends(require_user)):
    _require_admin(auth[0])
    async with engine.begin() as conn:
        await _ensure(conn)
        for k, v in (body or {}).items():
            await conn.execute(text("INSERT INTO feature_flags(id, key, is_enabled) VALUES (gen_random_uuid(), :k, :e) ON CONFLICT (key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = now()"), {"k": k, "e": bool(v)})
        await _audit(conn, auth[0], "update_feature_flags", body or {})
    return {"status": "success"}

@router.get("/prompts")
async def list_prompts(auth=Depends(require_user)):
    _require_admin(auth[0])
    async with engine.begin() as conn:
        await _ensure(conn)
        res = await conn.execute(text("SELECT id::text, name, content, updated_at FROM prompt_templates ORDER BY updated_at DESC"))
        rows = res.fetchall()
        return {"status": "success", "data": [{"id": r[0], "name": r[1], "content": r[2], "updated_at": str(r[3])} for r in rows]}

@router.post("/prompts")
async def create_prompt(body: dict = Body(...), auth=Depends(require_user)):
    _require_admin(auth[0])
    async with engine.begin() as conn:
        await _ensure(conn)
        await conn.execute(text("INSERT INTO prompt_templates(id, name, content) VALUES (gen_random_uuid(), :n, :c) ON CONFLICT (name) DO UPDATE SET content = EXCLUDED.content, updated_at = now()"), {"n": body.get("name"), "c": body.get("content")})
        await _audit(conn, auth[0], "upsert_prompt", body or {})
    return {"status": "success"}

@router.get("/models")
async def list_models(auth=Depends(require_user)):
    _require_admin(auth[0])
    async with engine.begin() as conn:
        await _ensure(conn)
        res = await conn.execute(text("SELECT id::text, provider, model_id, display_name, active, updated_at FROM ai_models ORDER BY updated_at DESC"))
        rows = res.fetchall()
        return {"status": "success", "data": [{"id": r[0], "provider": r[1], "model_id": r[2], "display_name": r[3], "active": bool(r[4]), "updated_at": str(r[5])} for r in rows]}

@router.post("/models")
async def upsert_model(body: dict = Body(...), auth=Depends(require_user)):
    _require_admin(auth[0])
    async with engine.begin() as conn:
        await _ensure(conn)
        await conn.execute(text("INSERT INTO ai_models(id, provider, model_id, display_name, active) VALUES (gen_random_uuid(), :p, :m, :d, COALESCE(:a, TRUE)) ON CONFLICT (model_id) DO UPDATE SET provider = EXCLUDED.provider, display_name = EXCLUDED.display_name, active = EXCLUDED.active, updated_at = now()"), {"p": body.get("provider"), "m": body.get("model_id"), "d": body.get("display_name"), "a": body.get("active")})
        await _audit(conn, auth[0], "upsert_model", body or {})
    return {"status": "success"}

@router.get("/audit")
async def list_audit(limit: int = 50, offset: int = 0, auth=Depends(require_user)):
    _require_admin(auth[0])
    async with engine.begin() as conn:
        await _ensure(conn)
        res = await conn.execute(text("SELECT id::text, owner_id::text, action, details, created_at FROM audit_logs ORDER BY created_at DESC LIMIT :l OFFSET :o"), {"l": limit, "o": offset})
        rows = res.fetchall()
        return {"status": "success", "data": [{"id": r[0], "owner_id": r[1], "action": r[2], "details": r[3], "created_at": str(r[4])} for r in rows]}
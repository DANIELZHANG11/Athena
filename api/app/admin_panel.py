import os
import uuid
from fastapi import APIRouter, Body, Depends, HTTPException, Header
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
        CREATE TABLE IF NOT EXISTS service_providers (
          id UUID PRIMARY KEY,
          service_type TEXT NOT NULL,
          name TEXT NOT NULL,
          endpoint TEXT,
          config JSONB NOT NULL DEFAULT '{}'::jsonb,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          priority INTEGER NOT NULL DEFAULT 0,
          version INTEGER NOT NULL DEFAULT 1,
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          UNIQUE(service_type, name)
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

@router.get("/providers")
async def list_providers(service_type: str | None = None, auth=Depends(require_user)):
    _require_admin(auth[0])
    async with engine.begin() as conn:
        await _ensure(conn)
        base = "SELECT id::text, service_type, name, endpoint, config, is_active, priority, version, updated_at FROM service_providers"
        params = {}
        if service_type:
            base += " WHERE service_type = :st"
            params["st"] = service_type
        base += " ORDER BY service_type, priority DESC, updated_at DESC"
        res = await conn.execute(text(base), params)
        rows = res.fetchall()
        return {"status": "success", "data": [{"id": r[0], "service_type": r[1], "name": r[2], "endpoint": r[3], "config": r[4], "is_active": bool(r[5]), "priority": int(r[6]), "etag": f"W/\"{int(r[7])}\"", "updated_at": str(r[8])} for r in rows]}

@router.post("/providers")
async def upsert_provider(body: dict = Body(...), auth=Depends(require_user)):
    _require_admin(auth[0])
    async with engine.begin() as conn:
        await _ensure(conn)
        service_type = body.get("service_type")
        name = body.get("name")
        endpoint = body.get("endpoint")
        config = body.get("config")
        is_active = body.get("is_active")
        priority = body.get("priority")
        await conn.execute(text("INSERT INTO service_providers(id, service_type, name, endpoint, config, is_active, priority) VALUES (gen_random_uuid(), :st, :nm, :ep, cast(:cfg as jsonb), COALESCE(:act, TRUE), COALESCE(:pr, 0)) ON CONFLICT (service_type, name) DO UPDATE SET endpoint = EXCLUDED.endpoint, config = EXCLUDED.config, is_active = EXCLUDED.is_active, priority = EXCLUDED.priority, version = service_providers.version + 1, updated_at = now()"), {"st": service_type, "nm": name, "ep": endpoint, "cfg": config, "act": is_active, "pr": priority})
        await _audit(conn, auth[0], "upsert_provider", body or {})
    return {"status": "success"}

@router.patch("/providers/{provider_id}")
async def update_provider(provider_id: str, body: dict = Body(...), if_match: str | None = Header(None), auth=Depends(require_user)):
    _require_admin(auth[0])
    if not if_match or not if_match.startswith("W/\""):
        raise HTTPException(status_code=428, detail="missing_if_match")
    try:
        ver = int(if_match.split("\"")[1])
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_if_match")
    endpoint = body.get("endpoint")
    config = body.get("config")
    is_active = body.get("is_active")
    priority = body.get("priority")
    async with engine.begin() as conn:
        await _ensure(conn)
        res = await conn.execute(text("UPDATE service_providers SET endpoint = COALESCE(:ep, endpoint), config = COALESCE(cast(:cfg as jsonb), config), is_active = COALESCE(:act, is_active), priority = COALESCE(:pr, priority), version = version + 1, updated_at = now() WHERE id = cast(:id as uuid) AND version = :v"), {"ep": endpoint, "cfg": config, "act": is_active, "pr": priority, "id": provider_id, "v": ver})
        if res.rowcount == 0:
            raise HTTPException(status_code=409, detail="version_conflict")
        await _audit(conn, auth[0], "update_provider", body or {})
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
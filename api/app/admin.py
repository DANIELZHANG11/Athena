import os
import uuid
import json
from datetime import timedelta
from fastapi import APIRouter, Body, Depends, Header, HTTPException
from sqlalchemy import text
from .db import engine
from .auth import require_user

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

def require_admin(auth=Depends(require_user)):
    user_id, _ = auth
    admin_id = os.getenv("ADMIN_USER_ID", "")
    dev = os.getenv("DEV_MODE", "false").lower() == "true"
    if dev or (admin_id and user_id == admin_id):
        return True
    raise HTTPException(status_code=401, detail="admin_unauthorized")

@router.get("/users")
async def list_users(limit: int = 50, offset: int = 0, _=Depends(require_admin)):
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.role', 'admin', true)"))
        res = await conn.execute(text("SELECT id::text, email, display_name, is_active, updated_at, version FROM users ORDER BY updated_at DESC LIMIT :l OFFSET :o"), {"l": limit, "o": offset})
        rows = res.fetchall()
        return {"status": "success", "data": [{"id": r[0], "email": r[1], "display_name": r[2], "is_active": bool(r[3]), "updated_at": str(r[4]), "etag": f"W/\"{int(r[5])}\""} for r in rows]}

@router.patch("/users/{user_id}")
async def update_user(user_id: str, body: dict = Body(...), if_match: str | None = Header(None), _=Depends(require_admin)):
    if not if_match or not if_match.startswith("W/\""):
        raise HTTPException(status_code=428, detail="missing_if_match")
    try:
        ver = int(if_match.split("\"")[1])
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_if_match")
    display_name = body.get("display_name")
    is_active = body.get("is_active")
    membership_tier = body.get("membership_tier")
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.role', 'admin', true)"))
        await conn.exec_driver_sql("ALTER TABLE users ADD COLUMN IF NOT EXISTS membership_tier TEXT NOT NULL DEFAULT 'FREE'")
        before = await conn.execute(text("SELECT to_jsonb(u) FROM (SELECT id, email, display_name, is_active, version FROM users WHERE id = cast(:id as uuid)) u"), {"id": user_id})
        b = before.fetchone()
        res = await conn.execute(text("UPDATE users SET display_name = COALESCE(:dn, display_name), is_active = COALESCE(:ia, is_active), membership_tier = COALESCE(:mt, membership_tier), version = version + 1, updated_at = now() WHERE id = cast(:id as uuid) AND version = :v"), {"dn": display_name, "ia": is_active, "mt": membership_tier, "id": user_id, "v": ver})
        if res.rowcount == 0:
            raise HTTPException(status_code=409, detail="version_conflict")
        after = await conn.execute(text("SELECT to_jsonb(u) FROM (SELECT id, email, display_name, is_active, membership_tier, version FROM users WHERE id = cast(:id as uuid)) u"), {"id": user_id})
        a = after.fetchone()
        await conn.execute(text("INSERT INTO audit_logs(id, actor_id, action, entity, entity_id, before, after) VALUES (cast(:id as uuid), NULL, 'admin.update_user', 'users', cast(:eid as uuid), cast(:b as jsonb), cast(:a as jsonb))"), {"id": str(uuid.uuid4()), "eid": user_id, "b": b[0], "a": a[0]})
    return {"status": "success"}

@router.get("/gateways")
async def list_gateways(limit: int = 50, offset: int = 0, _=Depends(require_admin)):
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.role', 'admin', true)"))
        res = await conn.execute(text("SELECT id::text, name, config, is_active, updated_at, version FROM payment_gateways ORDER BY updated_at DESC LIMIT :l OFFSET :o"), {"l": limit, "o": offset})
        rows = res.fetchall()
        return {"status": "success", "data": [{"id": r[0], "name": r[1], "config": r[2], "is_active": bool(r[3]), "updated_at": str(r[4]), "etag": f"W/\"{int(r[5])}\""} for r in rows]}

@router.post("/gateways")
async def create_gateway(body: dict = Body(...), idempotency_key: str | None = Header(None), _=Depends(require_admin)):
    name = body.get("name")
    config = body.get("config")
    is_active = bool(body.get("is_active", True))
    if not name or config is None:
        raise HTTPException(status_code=400, detail="invalid_payload")
    gid = str(uuid.uuid4())
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.role', 'admin', true)"))
        await conn.execute(text("INSERT INTO payment_gateways(id, name, config, is_active) VALUES (cast(:id as uuid), :n, cast(:c as jsonb), :a) ON CONFLICT (name) DO NOTHING"), {"id": gid, "n": name, "c": json.dumps(config), "a": is_active})
    return {"status": "success", "data": {"id": gid}}

@router.patch("/gateways/{gateway_id}")
async def update_gateway(gateway_id: str, body: dict = Body(...), if_match: str | None = Header(None), _=Depends(require_admin)):
    if not if_match or not if_match.startswith("W/\""):
        raise HTTPException(status_code=428, detail="missing_if_match")
    try:
        ver = int(if_match.split("\"")[1])
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_if_match")
    name = body.get("name")
    config = body.get("config")
    is_active = body.get("is_active")
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.role', 'admin', true)"))
        res = await conn.execute(text("UPDATE payment_gateways SET name = COALESCE(:n, name), config = COALESCE(cast(:c as jsonb), config), is_active = COALESCE(:a, is_active), version = version + 1, updated_at = now() WHERE id = cast(:id as uuid) AND version = :v"), {"n": name, "c": json.dumps(config) if config is not None else None, "a": is_active, "id": gateway_id, "v": ver})
        if res.rowcount == 0:
            raise HTTPException(status_code=409, detail="version_conflict")
    return {"status": "success"}

@router.get("/translations")
async def list_translations(namespace: str | None = None, lang: str | None = None, limit: int = 50, offset: int = 0, _=Depends(require_admin)):
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.role', 'admin', true)"))
        base = "SELECT id::text, namespace, key, lang, value, updated_at, version FROM translations WHERE deleted_at IS NULL"
        params = {"l": limit, "o": offset}
        if namespace:
            base += " AND namespace = :ns"
            params["ns"] = namespace
        if lang:
            base += " AND lang = :lg"
            params["lg"] = lang
        base += " ORDER BY updated_at DESC LIMIT :l OFFSET :o"
        res = await conn.execute(text(base), params)
    rows = res.fetchall()
    return {"status": "success", "data": [{"id": r[0], "namespace": r[1], "key": r[2], "lang": r[3], "value": r[4], "updated_at": str(r[5]), "etag": f"W/\"{int(r[6])}\""} for r in rows]}

@router.post("/translations")
async def upsert_translation(body: dict = Body(...), idempotency_key: str | None = Header(None), _=Depends(require_admin)):
    ns = body.get("namespace")
    key = body.get("key")
    lang = body.get("lang")
    value = body.get("value")
    if not ns or not key or not lang or value is None:
        raise HTTPException(status_code=400, detail="invalid_payload")
    tid = str(uuid.uuid4())
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.role', 'admin', true)"))
        await conn.execute(text("INSERT INTO translations(id, namespace, key, lang, value) VALUES (cast(:id as uuid), :ns, :k, :lg, cast(:v as jsonb)) ON CONFLICT (namespace, key, lang) WHERE deleted_at IS NULL DO UPDATE SET value = EXCLUDED.value, version = translations.version + 1, updated_at = now()"), {"id": tid, "ns": ns, "k": key, "lg": lang, "v": json.dumps(value)})
    return {"status": "success", "data": {"id": tid}}

@router.patch("/translations/{id}")
async def update_translation(id: str, body: dict = Body(...), if_match: str | None = Header(None), _=Depends(require_admin)):
    if not if_match or not if_match.startswith("W/\""):
        raise HTTPException(status_code=428, detail="missing_if_match")
    try:
        ver = int(if_match.split("\"")[1])
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_if_match")
    value = body.get("value")
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.role', 'admin', true)"))
        res = await conn.execute(text("UPDATE translations SET value = COALESCE(cast(:v as jsonb), value), version = version + 1, updated_at = now() WHERE id = cast(:id as uuid) AND deleted_at IS NULL AND version = :ver"), {"v": json.dumps(value) if value is not None else None, "id": id, "ver": ver})
        if res.rowcount == 0:
            raise HTTPException(status_code=409, detail="version_conflict")
    return {"status": "success"}

@router.delete("/translations/{id}")
async def delete_translation(id: str, _=Depends(require_admin)):
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.role', 'admin', true)"))
        await conn.execute(text("UPDATE translations SET deleted_at = now(), updated_at = now(), version = version + 1 WHERE id = cast(:id as uuid) AND deleted_at IS NULL"), {"id": id})
    return {"status": "success"}

@router.get("/credits/accounts")
async def credits_accounts(limit: int = 50, offset: int = 0, _=Depends(require_admin)):
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.role', 'admin', true)"))
        res = await conn.execute(text("SELECT owner_id::text, balance, currency, updated_at FROM credit_accounts ORDER BY updated_at DESC LIMIT :l OFFSET :o"), {"l": limit, "o": offset})
        rows = res.fetchall()
        return {"status": "success", "data": [{"owner_id": r[0], "balance": int(r[1]), "currency": r[2], "updated_at": str(r[3])} for r in rows]}

@router.get("/credits/ledger")
async def credits_ledger(owner_id: str | None = None, limit: int = 50, offset: int = 0, _=Depends(require_admin)):
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.role', 'admin', true)"))
        base = "SELECT id::text, owner_id::text, amount, currency, reason, related_id::text, direction, created_at FROM credit_ledger"
        params = {"l": limit, "o": offset}
        if owner_id:
            base += " WHERE owner_id = cast(:oid as uuid)"
            params["oid"] = owner_id
        base += " ORDER BY created_at DESC LIMIT :l OFFSET :o"
        res = await conn.execute(text(base), params)
        rows = res.fetchall()
    return {"status": "success", "data": [{"id": r[0], "owner_id": r[1], "amount": int(r[2]), "currency": r[3], "reason": r[4], "related_id": r[5], "direction": r[6], "created_at": str(r[7])} for r in rows]}

@router.get("/pricing/regions")
async def list_regional_prices(limit: int = 50, offset: int = 0, _=Depends(require_admin)):
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.role', 'admin', true)"))
        res = await conn.execute(text("SELECT id::text, plan_code, currency, period, amount_minor, updated_at, version FROM regional_prices ORDER BY updated_at DESC LIMIT :l OFFSET :o"), {"l": limit, "o": offset})
        rows = res.fetchall()
        return {"status": "success", "data": [{"id": r[0], "plan_code": r[1], "currency": r[2], "period": r[3], "amount_minor": int(r[4]), "updated_at": str(r[5]), "etag": f"W/\"{int(r[6])}\""} for r in rows]}

@router.post("/pricing/regions")
async def upsert_regional_price(body: dict = Body(...), _=Depends(require_admin)):
    plan_code = body.get("plan_code")
    currency = body.get("currency")
    period = body.get("period")
    amount_minor = body.get("amount_minor")
    if not plan_code or not currency or not period or not isinstance(amount_minor, int):
        raise HTTPException(status_code=400, detail="invalid_payload")
    pid = str(uuid.uuid4())
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.role', 'admin', true)"))
        await conn.execute(text("INSERT INTO regional_prices(id, plan_code, currency, period, amount_minor) VALUES (cast(:id as uuid), :p, :c, :r, :a) ON CONFLICT (plan_code, currency, period) DO UPDATE SET amount_minor = EXCLUDED.amount_minor, version = regional_prices.version + 1, updated_at = now()"), {"id": pid, "p": plan_code, "c": currency, "r": period, "a": amount_minor})
    return {"status": "success", "data": {"id": pid}}
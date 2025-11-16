import uuid
from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy import text
from .db import engine
from .auth import require_user
import os

router = APIRouter(prefix="/api/v1/pricing", tags=["pricing"])
_MEM_RULES = {}

async def _ensure(conn):
    await conn.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS pricing_rules (
          id UUID PRIMARY KEY,
          service_type VARCHAR(32) NOT NULL,
          unit_type VARCHAR(32) NOT NULL,
          unit_size INTEGER NOT NULL,
          price_amount NUMERIC(10,2) NOT NULL,
          currency VARCHAR(10) NOT NULL,
          region VARCHAR(10),
          remark_template TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          version INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        );
        """
    )

@router.get("/rules")
async def list_rules(service_type: str | None = Query(None), region: str | None = Query(None)):
    try:
        async with engine.begin() as conn:
            await _ensure(conn)
            base = "SELECT id::text, service_type, unit_type, unit_size, price_amount, currency, region, remark_template FROM pricing_rules WHERE is_active = TRUE"
            params = {}
            if service_type:
                base += " AND service_type = :st"
                params["st"] = service_type
            if region:
                base += " AND (region IS NULL OR region = :rg)"
                params["rg"] = region
            base += " ORDER BY updated_at DESC"
            res = await conn.execute(text(base), params)
            rows = res.fetchall()
            data = []
            for r in rows:
                approx_tokens = int((r[3] or 0) * 1.5)
                remark = (r[7] or "").replace("{unit_size}", str(r[3])).replace("{price_amount}", str(r[4])).replace("{currency}", r[5]).replace("{approx_tokens}", str(approx_tokens))
                data.append({"id": r[0], "service_type": r[1], "unit_type": r[2], "unit_size": r[3], "price_amount": float(r[4]), "currency": r[5], "region": r[6], "remark": remark})
            return {"status": "success", "data": data}
    except Exception:
        data = []
        for rid, r in _MEM_RULES.items():
            if not r.get("is_active", True):
                continue
            if service_type and r.get("service_type") != service_type:
                continue
            if region and r.get("region") not in (None, region):
                continue
            us = int(r.get("unit_size") or 0)
            approx_tokens = int(us * 1.5)
            tmpl = r.get("remark_template") or ""
            remark = tmpl.replace("{unit_size}", str(us)).replace("{price_amount}", str(r.get("price_amount"))).replace("{currency}", r.get("currency") or "").replace("{approx_tokens}", str(approx_tokens))
            data.append({"id": rid, "service_type": r.get("service_type"), "unit_type": r.get("unit_type"), "unit_size": us, "price_amount": float(r.get("price_amount") or 0), "currency": r.get("currency"), "region": r.get("region"), "remark": remark})
        return {"status": "success", "data": data}

admin = APIRouter(prefix="/api/v1/admin/pricing", tags=["admin-pricing"])

def _require_admin(user_id: str):
    if os.getenv("DEV_MODE", "true").lower() == "true":
        return
    aid = os.getenv("ADMIN_USER_ID", "")
    if not aid or aid != user_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="forbidden")

@admin.get("/rules")
async def admin_list(auth=Depends(require_user)):
    _require_admin(auth[0])
    try:
        async with engine.begin() as conn:
            await _ensure(conn)
            res = await conn.execute(text("SELECT id::text, service_type, unit_type, unit_size, price_amount, currency, region, remark_template, is_active, version, updated_at FROM pricing_rules ORDER BY updated_at DESC"))
            rows = res.fetchall()
            return {"status": "success", "data": [{"id": r[0], "service_type": r[1], "unit_type": r[2], "unit_size": r[3], "price_amount": float(r[4]), "currency": r[5], "region": r[6], "remark_template": r[7], "is_active": bool(r[8]), "version": int(r[9]), "updated_at": str(r[10])} for r in rows]}
    except Exception:
        return {"status": "success", "data": [{"id": rid, "service_type": r.get("service_type"), "unit_type": r.get("unit_type"), "unit_size": r.get("unit_size"), "price_amount": float(r.get("price_amount") or 0), "currency": r.get("currency"), "region": r.get("region"), "remark_template": r.get("remark_template"), "is_active": bool(r.get("is_active", True)), "version": int(r.get("version", 1)), "updated_at": ""} for rid, r in _MEM_RULES.items()]}

@admin.post("/rules")
async def admin_create(body: dict = Body(...), auth=Depends(require_user)):
    _require_admin(auth[0])
    rid = str(uuid.uuid4())
    try:
        async with engine.begin() as conn:
            await _ensure(conn)
            await conn.execute(text("INSERT INTO pricing_rules(id, service_type, unit_type, unit_size, price_amount, currency, region, remark_template, is_active) VALUES (cast(:id as uuid), :st, :ut, :us, :pa, :cur, :rg, :rt, COALESCE(:ia, TRUE))"), {"id": rid, "st": body.get("service_type"), "ut": body.get("unit_type"), "us": int(body.get("unit_size")), "pa": float(body.get("price_amount")), "cur": body.get("currency"), "rg": body.get("region"), "rt": body.get("remark_template"), "ia": body.get("is_active")})
        return {"status": "success", "data": {"id": rid}}
    except Exception:
        _MEM_RULES[rid] = {"service_type": body.get("service_type"), "unit_type": body.get("unit_type"), "unit_size": int(body.get("unit_size")), "price_amount": float(body.get("price_amount")), "currency": body.get("currency"), "region": body.get("region"), "remark_template": body.get("remark_template"), "is_active": bool(body.get("is_active", True)), "version": 1}
        return {"status": "success", "data": {"id": rid}}

@admin.patch("/rules/{rule_id}")
async def admin_update(rule_id: str, body: dict = Body(...), if_match: str | None = Query(None), auth=Depends(require_user)):
    _require_admin(auth[0])
    sets = []
    params = {"id": rule_id}
    ver = None
    if if_match and if_match.startswith('W/"') and if_match.endswith('"'):
        try:
            ver = int(if_match[3:-1])
        except Exception:
            ver = None
    for k in ["service_type","unit_type","unit_size","price_amount","currency","region","remark_template","is_active"]:
        if k in body:
            sets.append(f"{k} = :{k}")
            params[k] = body[k]
    if not sets:
        return {"status": "success"}
    try:
        async with engine.begin() as conn:
            await _ensure(conn)
            if ver is not None:
                res = await conn.execute(text("SELECT version FROM pricing_rules WHERE id = cast(:id as uuid)"), {"id": rule_id})
                row = res.fetchone()
                if not row or int(row[0]) != ver:
                    from fastapi import HTTPException
                    raise HTTPException(status_code=412, detail="etag_mismatch")
            q = "UPDATE pricing_rules SET " + ", ".join(sets) + ", version = version + 1, updated_at = now() WHERE id = cast(:id as uuid)"
            await conn.execute(text(q), params)
        return {"status": "success"}
    except Exception:
        cur = _MEM_RULES.get(rule_id)
        if cur is not None:
            if ver is not None and int(cur.get("version", 1)) != ver:
                from fastapi import HTTPException
                raise HTTPException(status_code=412, detail="etag_mismatch")
            for k in ["service_type","unit_type","unit_size","price_amount","currency","region","remark_template","is_active"]:
                if k in body:
                    cur[k] = body[k]
            cur["version"] = int(cur.get("version", 1)) + 1
        return {"status": "success"}

@admin.delete("/rules/{rule_id}")
async def admin_delete(rule_id: str, auth=Depends(require_user)):
    _require_admin(auth[0])
    async with engine.begin() as conn:
        await _ensure(conn)
        await conn.execute(text("UPDATE pricing_rules SET is_active = FALSE, updated_at = now() WHERE id = cast(:id as uuid)"), {"id": rule_id})
    return {"status": "success"}
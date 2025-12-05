"""
定价规则与管理员接口

职责：
- `/pricing/rules`：按服务类型/区域过滤返回有效定价规则与备注模板渲染结果
- 管理员 `/admin/pricing/*`：列出/创建/更新/禁用定价规则（支持平台与 SKU 字段）

说明：
- 仅新增注释，不改动查询与更新逻辑
"""
import os
import uuid

from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy import text

from .auth import require_user
from .db import engine

router = APIRouter(prefix="/api/v1/pricing", tags=["pricing"])


async def _ensure(conn):
    return


@router.get("/rules")
async def list_rules(
    service_type: str | None = Query(None), region: str | None = Query(None)
):
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
            remark = (
                (r[7] or "")
                .replace("{unit_size}", str(r[3]))
                .replace("{price_amount}", str(r[4]))
                .replace("{currency}", r[5])
                .replace("{approx_tokens}", str(approx_tokens))
            )
            data.append(
                {
                    "id": r[0],
                    "service_type": r[1],
                    "unit_type": r[2],
                    "unit_size": r[3],
                    "price_amount": float(r[4]),
                    "currency": r[5],
                    "region": r[6],
                    "remark": remark,
                }
            )
        return {"status": "success", "data": data}


admin = APIRouter(prefix="/api/v1/admin/pricing", tags=["admin-pricing"])


def _require_admin(user_id: str):
    aid = os.getenv("ADMIN_USER_ID", "")
    if not aid or aid != user_id:
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="forbidden")


@admin.get("/rules")
async def admin_list(auth=Depends(require_user)):
    _require_admin(auth[0])
    async with engine.begin() as conn:
        await _ensure(conn)
        res = await conn.execute(
            text(
                "SELECT id::text, service_type, unit_type, unit_size, price_amount, currency, region, remark_template, platform, sku_id, is_active, version, updated_at FROM pricing_rules ORDER BY updated_at DESC"
            )
        )
        rows = res.fetchall()
        return {
            "status": "success",
            "data": [
                {
                    "id": r[0],
                    "service_type": r[1],
                    "unit_type": r[2],
                    "unit_size": r[3],
                    "price_amount": float(r[4]),
                    "currency": r[5],
                    "region": r[6],
                    "remark_template": r[7],
                    "platform": r[8],
                    "sku_id": r[9],
                    "is_active": bool(r[10]),
                    "version": int(r[11]),
                    "updated_at": str(r[12]),
                }
                for r in rows
            ],
        }


@admin.post("/rules")
async def admin_create(body: dict = Body(...), auth=Depends(require_user)):
    _require_admin(auth[0])
    rid = str(uuid.uuid4())
    async with engine.begin() as conn:
        await _ensure(conn)
        await conn.execute(
            text(
                "INSERT INTO pricing_rules(id, service_type, unit_type, unit_size, price_amount, currency, region, remark_template, platform, sku_id, is_active) VALUES (cast(:id as uuid), :st, :ut, :us, :pa, :cur, :rg, :rt, COALESCE(:pf, 'web'), :sku, COALESCE(:ia, TRUE))"
            ),
            {
                "id": rid,
                "st": body.get("service_type"),
                "ut": body.get("unit_type"),
                "us": int(body.get("unit_size")),
                "pa": float(body.get("price_amount")),
                "cur": body.get("currency"),
                "rg": body.get("region"),
                "rt": body.get("remark_template"),
                "pf": body.get("platform"),
                "sku": body.get("sku_id"),
                "ia": body.get("is_active"),
            },
        )
    return {"status": "success", "data": {"id": rid}}


@admin.patch("/rules/{rule_id}")
async def admin_update(
    rule_id: str,
    body: dict = Body(...),
    if_match: str | None = Query(None),
    auth=Depends(require_user),
):
    _require_admin(auth[0])
    sets = []
    params = {"id": rule_id}
    ver = None
    if if_match and if_match.startswith('W/"') and if_match.endswith('"'):
        try:
            ver = int(if_match[3:-1])
        except Exception:
            ver = None
    for k in [
        "service_type",
        "unit_type",
        "unit_size",
        "price_amount",
        "currency",
        "region",
        "remark_template",
        "platform",
        "sku_id",
        "is_active",
    ]:
        if k in body:
            sets.append(f"{k} = :{k}")
            params[k] = body[k]
    if not sets:
        return {"status": "success"}
    async with engine.begin() as conn:
        await _ensure(conn)
        if ver is not None:
            res = await conn.execute(
                text("SELECT version FROM pricing_rules WHERE id = cast(:id as uuid)"),
                {"id": rule_id},
            )
            row = res.fetchone()
            if not row or int(row[0]) != ver:
                from fastapi import HTTPException

                raise HTTPException(status_code=412, detail="etag_mismatch")
        q = (
            "UPDATE pricing_rules SET "
            + ", ".join(sets)
            + ", version = version + 1, updated_at = now() WHERE id = cast(:id as uuid)"
        )
        await conn.execute(text(q), params)
    return {"status": "success"}


@admin.delete("/rules/{rule_id}")
async def admin_delete(rule_id: str, auth=Depends(require_user)):
    _require_admin(auth[0])
    async with engine.begin() as conn:
        await _ensure(conn)
        await conn.execute(
            text(
                "UPDATE pricing_rules SET is_active = FALSE, updated_at = now() WHERE id = cast(:id as uuid)"
            ),
            {"id": rule_id},
        )
    return {"status": "success"}

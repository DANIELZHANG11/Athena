import os
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import text

from .auth import require_user
from .db import engine
from .storage import make_object_key, presigned_put

router = APIRouter(prefix="/api/v1/ocr", tags=["ocr"])


@router.post("/jobs/init")
async def init_job(body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    filename = body.get("filename") or "document.png"
    jid = str(uuid.uuid4())
    key = make_object_key(user_id, f"ocr-{jid}-{filename}")
    put_url = presigned_put(os.getenv("MINIO_BUCKET", "athena"), key)
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        await conn.execute(
            text(
                "INSERT INTO ocr_jobs(id, owner_id, source_key, status) VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, :k, 'uploading')"
            ),
            {"id": jid, "k": key},
        )
    return {"status": "success", "data": {"id": jid, "put_url": put_url}}


async def _ensure_quota(conn):
    return


@router.post("/jobs/complete")
async def complete_job(body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    jid = body.get("id")
    pages = int(body.get("pages") or 1)
    if not jid:
        raise HTTPException(status_code=400, detail="missing_id")
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})

        await conn.execute(
            text(
                "UPDATE ocr_jobs SET status = 'processing', updated_at = now() WHERE id = cast(:id as uuid) AND owner_id = current_setting('app.user_id')::uuid"
            ),
            {"id": jid},
        )
        res = await conn.execute(
            text(
                "SELECT price_amount, currency FROM pricing_rules WHERE service_type = 'OCR' AND unit_type = 'PAGES' AND is_active = TRUE ORDER BY updated_at DESC LIMIT 1"
            )
        )
        rule = res.fetchone()
        if rule:
            pa = float(rule[0])
            sres = await conn.execute(text("SELECT key, value FROM system_settings WHERE key LIKE 'free_%'"))
            settings = {r[0]: r[1] for r in sres.fetchall()}
            mtres = await conn.execute(
                text("SELECT membership_tier FROM users WHERE id = current_setting('app.user_id')::uuid")
            )
            mtrow = mtres.fetchone()
            tier = (mtrow and mtrow[0]) or "FREE"
            tres = await conn.execute(text("SELECT value FROM system_settings WHERE key = 'membership_tiers'"))
            trow = tres.fetchone()
            mconf = trow and trow[0]
            free_pages = None
            if isinstance(mconf, dict) and tier in mconf:
                try:
                    free_pages = int((mconf[tier] or {}).get("free_ocr_pages") or 0)
                except Exception:
                    free_pages = 0
            if free_pages is None:
                free_pages = int(settings.get("free_ocr_pages", 0))
            ures = await conn.execute(
                text(
                    "SELECT used_units FROM free_quota_usage WHERE owner_id = current_setting('app.user_id')::uuid AND service_type = 'OCR' AND period_start = current_date"
                )
            )
            urow = ures.fetchone()
            used = int(urow[0]) if urow else 0
            remain = max(0, free_pages - used)
            payable_pages = max(0, pages - remain)
            if remain > 0:
                await conn.execute(
                    text(
                        "INSERT INTO free_quota_usage(owner_id, service_type, used_units) VALUES (current_setting('app.user_id')::uuid, 'OCR', :u) ON CONFLICT (owner_id, service_type, period_start) DO UPDATE SET used_units = free_quota_usage.used_units + EXCLUDED.used_units"
                    ),
                    {"u": min(pages, remain)},
                )
                if payable_pages == 0:
                    lid_free = str(uuid.uuid4())
                    await conn.execute(
                        text(
                            "INSERT INTO credit_ledger(id, owner_id, amount, currency, reason, related_id, direction) VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, 0, 'CNY', 'ocr_free', cast(:rid as uuid), 'info')"
                        ),
                        {"id": lid_free, "rid": jid},
                    )
            if payable_pages > 0:
                amt_cents = int(round(pa * 100)) * payable_pages
                await conn.execute(
                    text(
                        "INSERT INTO credit_accounts(owner_id) VALUES (current_setting('app.user_id')::uuid) ON CONFLICT (owner_id) DO NOTHING"
                    )
                )
                # 优先扣钱包
                wres = await conn.execute(
                    text("SELECT wallet_amount FROM credit_accounts WHERE owner_id = current_setting('app.user_id')::uuid")
                )
                wrow = wres.fetchone()
                wallet_amt = float(wrow[0] or 0)
                cost_money = amt_cents / 100.0
                if wallet_amt >= cost_money:
                    await conn.execute(
                        text(
                            "UPDATE credit_accounts SET wallet_amount = wallet_amount - :m, updated_at = now() WHERE owner_id = current_setting('app.user_id')::uuid"
                        ),
                        {"m": cost_money},
                    )
                    lid = str(uuid.uuid4())
                    await conn.execute(
                        text(
                            "INSERT INTO credit_ledger(id, owner_id, amount, currency, reason, related_id, direction) VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, :amt, :cur, 'ocr', cast(:rid as uuid), 'debit')"
                        ),
                        {"id": lid, "amt": amt_cents, "cur": rule[1], "rid": jid},
                    )
                else:
                    # 钱包不足则扣积分
                    bal = await conn.execute(
                        text("SELECT balance FROM credit_accounts WHERE owner_id = current_setting('app.user_id')::uuid")
                    )
                    b = bal.fetchone()
                    if not b or int(b[0]) < amt_cents:
                        await conn.execute(
                            text("UPDATE ocr_jobs SET status = 'failed', updated_at = now() WHERE id = cast(:id as uuid)"),
                            {"id": jid},
                        )
                        raise HTTPException(status_code=400, detail="insufficient_balance")
                    await conn.execute(
                        text(
                            "UPDATE credit_accounts SET balance = balance - :amt, updated_at = now() WHERE owner_id = current_setting('app.user_id')::uuid"
                        ),
                        {"amt": amt_cents},
                    )
                    lid = str(uuid.uuid4())
                    await conn.execute(
                        text(
                            "INSERT INTO credit_ledger(id, owner_id, amount, currency, reason, related_id, direction) VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, :amt, :cur, 'ocr', cast(:rid as uuid), 'debit')"
                        ),
                        {"id": lid, "amt": amt_cents, "cur": rule[1], "rid": jid},
                    )
        await conn.execute(
            text(
                "UPDATE ocr_jobs SET status = 'succeeded', result_text = 'mock_ocr_text', updated_at = now() WHERE id = cast(:id as uuid)"
            ),
            {"id": jid},
        )
    return {"status": "success"}


@router.get("/jobs")
async def list_jobs(limit: int = 50, offset: int = 0, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        res = await conn.execute(
            text(
                "SELECT id::text, source_key, status, updated_at FROM ocr_jobs WHERE owner_id = current_setting('app.user_id')::uuid ORDER BY updated_at DESC LIMIT :l OFFSET :o"
            ),
            {"l": limit, "o": offset},
        )
        rows = res.fetchall()
        return {
            "status": "success",
            "data": [
                {
                    "id": r[0],
                    "source_key": r[1],
                    "status": r[2],
                    "updated_at": str(r[3]),
                }
                for r in rows
            ],
        }

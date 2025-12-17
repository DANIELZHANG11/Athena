"""
格式转换相关路由

包含：
- /{book_id}/convert - 请求转换
- /{book_id}/convert/output - 获取转换输出
- /{book_id}/processing/status - 处理状态
- /{book_id}/set_converted - 设置转换完成
- /jobs/list - 作业列表
- /jobs/{job_id}/complete - 完成作业
- /jobs/{job_id}/fail - 失败作业
- /jobs/{job_id}/simulate - 模拟作业
"""
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import text

from .common import (
    BOOKS_BUCKET, engine, uuid, presigned_get, upload_bytes,
    require_user, ws_broadcast,
)

router = APIRouter()


@router.get("/{book_id}/processing/status")
async def processing_status(book_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT status FROM conversion_jobs WHERE owner_id = current_setting('app.user_id')::uuid AND book_id = cast(:bid as uuid) ORDER BY created_at DESC LIMIT 1"
            ),
            {"bid": book_id},
        )
        row = res.fetchone()
        if not row:
            return {"status": "success", "data": {"status": "ACTIVE"}}
        st = row[0]
        mapped = (
            "ACTIVE"
            if st in ("succeeded", "active")
            else ("FAILED" if st == "failed" else "PENDING")
        )
        return {"status": "success", "data": {"status": mapped}}


@router.get("/{book_id}/convert/output")
async def presign_convert_output(book_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT output_key FROM conversion_jobs WHERE owner_id = current_setting('app.user_id')::uuid AND book_id = cast(:bid as uuid) AND status = 'completed' ORDER BY updated_at DESC LIMIT 1"
            ),
            {"bid": book_id},
        )
        row = res.fetchone()
        if not row or not row[0]:
            raise HTTPException(status_code=404, detail="not_found")
        return {
            "status": "success",
            "data": {"download_url": presigned_get(BOOKS_BUCKET, row[0])},
        }


@router.post("/{book_id}/set_converted")
async def set_converted(
    book_id: str, body: dict = Body(...), auth=Depends(require_user)
):
    import json as _j
    
    user_id, _ = auth
    key = body.get("key")
    if not key:
        raise HTTPException(status_code=400, detail="missing_key")
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "UPDATE books SET converted_epub_key = :k, updated_at = now() WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
            ),
            {"k": key, "id": book_id},
        )
    try:
        await ws_broadcast(
            f"book:{book_id}", _j.dumps({"event": "STANDARDIZED", "epub_key": key})
        )
    except Exception:
        pass
    return {"status": "success"}


@router.post("/{book_id}/convert")
async def request_convert(
    book_id: str, body: dict = Body(...), auth=Depends(require_user)
):
    user_id, _ = auth
    target_format = (body.get("target_format") or "epub").lower()
    job_id = str(uuid.uuid4())
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text("SELECT minio_key FROM books WHERE id = cast(:id as uuid)"),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="not_found")
        source_key = row[0]
        await conn.execute(
            text(
                """
            INSERT INTO conversion_jobs(id, user_id, book_id, source_key, target_format, status)
            VALUES (cast(:id as uuid), cast(:uid as uuid), cast(:bid as uuid), :src, :fmt, 'pending')
            """
            ),
            {
                "id": job_id,
                "uid": user_id,
                "bid": book_id,
                "src": source_key,
                "fmt": target_format,
            },
        )
    return {"status": "success", "data": {"job_id": job_id, "status": "pending"}}


@router.get("/jobs/list")
async def list_jobs(status: str | None = Query(None), auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        if status:
            res = await conn.execute(
                text(
                    "SELECT id::text, book_id::text, target_format, status, created_at FROM conversion_jobs WHERE user_id = current_setting('app.user_id')::uuid AND status = :st ORDER BY created_at DESC"
                ),
                {"st": status},
            )
        else:
            res = await conn.execute(
                text(
                    "SELECT id::text, book_id::text, target_format, status, created_at FROM conversion_jobs WHERE user_id = current_setting('app.user_id')::uuid ORDER BY created_at DESC"
                )
            )
        rows = res.fetchall()
        return {
            "status": "success",
            "data": [
                {
                    "id": r[0],
                    "book_id": r[1],
                    "target_format": r[2],
                    "status": r[3],
                    "created_at": str(r[4]),
                }
                for r in rows
            ],
        }


@router.post("/jobs/{job_id}/complete")
async def complete_job(
    job_id: str, body: dict = Body(None), auth=Depends(require_user)
):
    user_id, _ = auth
    output_key = (body or {}).get("output_key") or ""
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "UPDATE conversion_jobs SET status='completed', output_key = COALESCE(:out, output_key), updated_at = now() WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
            ),
            {"id": job_id, "out": output_key},
        )
    return {"status": "success"}


@router.post("/jobs/{job_id}/fail")
async def fail_job(job_id: str, body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    message = body.get("error") or ""
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "UPDATE conversion_jobs SET status='failed', error = :msg, updated_at = now() WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
            ),
            {"id": job_id, "msg": message},
        )
    return {"status": "success"}


@router.post("/jobs/{job_id}/simulate")
async def simulate_job(job_id: str, auth=Depends(require_user)):
    import math
    
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT book_id::text FROM conversion_jobs WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
            ),
            {"id": job_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="not_found")
        book_id = row[0]
        out_key = f"converted/{book_id}.epub"
        upload_bytes(
            BOOKS_BUCKET, out_key, b"converted content", "application/epub+zip"
        )
        res2 = await conn.execute(
            text(
                "SELECT price_amount, unit_size, currency FROM pricing_rules WHERE service_type = 'VECTORIZE' AND unit_type = 'CHARS' AND is_active = TRUE ORDER BY updated_at DESC LIMIT 1"
            )
        )
        rule = res2.fetchone()
        if rule:
            qty = 100000
            max(1, math.ceil(qty / int(rule[1])))
            sres = await conn.execute(
                text("SELECT key, value FROM system_settings WHERE key LIKE 'free_%'")
            )
            settings = {r[0]: r[1] for r in sres.fetchall()}
            mtres = await conn.execute(
                text(
                    "SELECT membership_tier FROM users WHERE id = current_setting('app.user_id')::uuid"
                )
            )
            mtrow = mtres.fetchone()
            tier = (mtrow and mtrow[0]) or "FREE"
            tres = await conn.execute(
                text("SELECT value FROM system_settings WHERE key = 'membership_tiers'")
            )
            trow = tres.fetchone()
            mconf = trow and trow[0]
            free_chars = None
            if isinstance(mconf, dict) and tier in mconf:
                try:
                    free_chars = int((mconf[tier] or {}).get("free_vector_chars") or 0)
                except Exception:
                    free_chars = 0
            if free_chars is None:
                free_chars = int(settings.get("free_vector_chars", 0))

            ures = await conn.execute(
                text(
                    "SELECT used_units FROM free_quota_usage WHERE owner_id = current_setting('app.user_id')::uuid AND service_type = 'VECTORIZE' AND period_start = current_date"
                )
            )
            urow = ures.fetchone()
            used = int(urow[0]) if urow else 0
            remain = max(0, free_chars - used)
            payable_chars = max(0, qty - remain)
            if remain > 0:
                await conn.execute(
                    text(
                        "INSERT INTO free_quota_usage(owner_id, service_type, used_units) VALUES (current_setting('app.user_id')::uuid, 'VECTORIZE', :u) ON CONFLICT (owner_id, service_type, period_start) DO UPDATE SET used_units = free_quota_usage.used_units + EXCLUDED.used_units"
                    ),
                    {"u": min(qty, remain)},
                )
            if payable_chars > 0:
                units_pay = max(1, math.ceil(payable_chars / int(rule[1])))
                amt = int(round(float(rule[0]) * 100)) * units_pay
                await conn.execute(
                    text(
                        "INSERT INTO credit_accounts(owner_id) VALUES (current_setting('app.user_id')::uuid) ON CONFLICT (owner_id) DO NOTHING"
                    )
                )
                bal = await conn.execute(
                    text(
                        "SELECT balance FROM credit_accounts WHERE owner_id = current_setting('app.user_id')::uuid"
                    )
                )
                b = bal.fetchone()
                if not b or int(b[0]) < amt:
                    await conn.execute(
                        text(
                            "UPDATE conversion_jobs SET status='failed', updated_at = now() WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
                        ),
                        {"id": job_id},
                    )
                    raise HTTPException(status_code=400, detail="insufficient_balance")
                await conn.execute(
                    text(
                        "UPDATE credit_accounts SET balance = balance - :amt, updated_at = now() WHERE owner_id = current_setting('app.user_id')::uuid"
                    ),
                    {"amt": amt},
                )
                lid = str(uuid.uuid4())
                await conn.execute(
                    text(
                        "INSERT INTO credit_ledger(id, owner_id, amount, currency, reason, related_id, direction) VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, :amt, :cur, 'vectorize', cast(:rid as uuid), 'debit')"
                    ),
                    {"id": lid, "amt": amt, "cur": rule[2], "rid": job_id},
                )
        await conn.execute(
            text(
                "UPDATE conversion_jobs SET status='completed', output_key = :out, updated_at = now() WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
            ),
            {"id": job_id, "out": out_key},
        )
    return {"status": "success", "data": {"output_key": out_key}}

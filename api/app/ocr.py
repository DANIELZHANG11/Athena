"""
OCR 任务管理接口

职责：
- 创建 OCR 作业：根据书籍页数、会员与系统阈值计算扣费策略（免费额度或增购额度）
- 并发控制：通过 Redis 记录活跃任务数量，限制并发
- 任务入队：按优先级将作业推送到 Celery 队列
- 作业查询：按用户列出最近的 OCR 作业记录

说明：
- 仅新增注释，不改动接口与业务逻辑
- 真正的识别流程由 `tasks.process_book_ocr` 执行
"""
import json
import os
import uuid
from datetime import datetime

import redis
from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import text

from .auth import require_user
from .celery_app import celery_app
from .db import engine

router = APIRouter(prefix="/api/v1/ocr", tags=["ocr"])

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)


@router.post("/jobs")
async def init_job(body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    book_id = body.get("book_id")
    if not book_id:
        raise HTTPException(status_code=400, detail="missing_book_id")

    async with engine.begin() as conn:
        # 1. Get Book Metadata (Page Count)
        bres = await conn.execute(
            text("SELECT meta, minio_key FROM books WHERE id = cast(:bid as uuid) AND user_id = cast(:uid as uuid)"),
            {"bid": book_id, "uid": user_id}
        )
        book_row = bres.fetchone()
        if not book_row:
            raise HTTPException(status_code=404, detail="book_not_found")
        
        meta = book_row[0] or {}
        source_key = book_row[1]
        page_count = meta.get("page_count", 0)
        if page_count <= 0:
             page_count = 1 

        # 2. Get User Membership & Quota
        ures = await conn.execute(
            text("SELECT membership_tier, free_ocr_usage, membership_expire_at FROM users WHERE id = cast(:uid as uuid)"),
            {"uid": user_id}
        )
        user_row = ures.fetchone()
        tier = user_row[0]
        free_used = user_row[1] or 0
        expire_at = user_row[2]
        
        is_pro = False
        if tier != "FREE" and expire_at and expire_at > datetime.now():
            is_pro = True

        # 3. Get System Settings
        sres = await conn.execute(text("SELECT key, value FROM system_settings WHERE key IN ('ocr_page_thresholds', 'ocr_monthly_quota', 'ocr_concurrency_limit')"))
        settings = {row[0]: row[1] for row in sres.fetchall()}
        
        thresholds = settings.get("ocr_page_thresholds", {"standard": 600, "double": 1000, "triple": 2000})
        monthly_quota = int(settings.get("ocr_monthly_quota", 3))
        concurrency_limit = int(settings.get("ocr_concurrency_limit", 1))

        # 4. Determine Cost & Strategy
        cost = 0
        strategy = "free_quota"
        
        if page_count <= thresholds.get("standard", 600):
            cost = 1
            if is_pro and free_used < monthly_quota:
                strategy = "free_quota"
            else:
                strategy = "addon_quota"
        elif page_count <= thresholds.get("double", 1000):
            cost = 2
            strategy = "addon_quota"
        elif page_count <= thresholds.get("triple", 2000):
            cost = 3
            strategy = "addon_quota"
        else:
            raise HTTPException(status_code=400, detail="book_too_large_for_ocr")

        # 5. Check Balance & Deduct
        if strategy == "free_quota":
             await conn.execute(
                 text("UPDATE users SET free_ocr_usage = free_ocr_usage + :c WHERE id = cast(:uid as uuid)"),
                 {"c": cost, "uid": user_id}
             )
        else:
             # Deduct Credits (Fallback for Addon: 1 Time = 100 Credits)
             required_credits = cost * 100 
             upd = await conn.execute(
                 text("UPDATE credit_accounts SET balance = balance - :c WHERE owner_id = cast(:uid as uuid) AND balance >= :c"),
                 {"c": required_credits, "uid": user_id}
             )
             if upd.rowcount == 0:
                 raise HTTPException(status_code=402, detail="insufficient_credits_for_ocr")
             
             # Add Ledger Entry
             lid = str(uuid.uuid4())
             await conn.execute(
                 text("INSERT INTO credit_ledger(id, owner_id, amount, currency, reason, related_id, direction) VALUES (cast(:id as uuid), cast(:uid as uuid), :amt, 'CREDITS', 'ocr_deduction', cast(:bid as uuid), 'debit')"),
                 {"id": lid, "uid": user_id, "amt": required_credits, "bid": book_id}
             )

        # 6. Concurrency Check
        active_jobs = r.scard("ocr:active_jobs")
        if active_jobs >= concurrency_limit:
             raise HTTPException(status_code=503, detail="server_busy_try_later")

        # 7. Create Job
        job_id = str(uuid.uuid4())
        await conn.execute(
            text("INSERT INTO ocr_jobs (id, book_id, user_id, owner_id, source_key, status, page_count, deduction_strategy, deduction_amount) VALUES (cast(:jid as uuid), cast(:bid as uuid), cast(:uid as uuid), cast(:uid as uuid), :sk, 'pending', :pc, :ds, :da)"),
            {"jid": job_id, "bid": book_id, "uid": user_id, "sk": source_key, "pc": page_count, "ds": strategy, "da": cost}
        )
        
        # 8. Enqueue Task
        priority = 0
        if is_pro:
            priority = 9 if strategy == "addon_quota" else 7
        else:
            priority = 5 if strategy == "addon_quota" else 1
            
        celery_app.send_task("tasks.process_ocr_book", args=[job_id], priority=priority)
        r.sadd("ocr:active_jobs", job_id)

    return {"status": "success", "data": {"job_id": job_id}}

@router.get("/jobs")
async def list_jobs(limit: int = 20, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        res = await conn.execute(
            text("SELECT id, book_id, status, created_at, page_count, deduction_strategy FROM ocr_jobs WHERE user_id = cast(:uid as uuid) ORDER BY created_at DESC LIMIT :limit"),
            {"uid": user_id, "limit": limit}
        )
        rows = res.fetchall()
        return {
            "status": "success",
            "data": [
                {
                    "id": str(r[0]),
                    "book_id": str(r[1]),
                    "status": r[2],
                    "created_at": str(r[3]),
                    "page_count": r[4],
                    "strategy": r[5]
                } for r in rows
            ]
        }

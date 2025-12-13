"""
定时任务（每日）

职责：
- 过期会员降级到 FREE 并清理过期字段
- 基于 `monthly_gift_reset_at` 重置每月赠礼（重置免费 OCR 次数、发放积分并记账）
- 清理已送达的同步事件（保留 7 天）与陈旧未送达事件（30 天）
"""
import asyncio
import os
import logging
from datetime import datetime
from sqlalchemy import text
from .db import engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("scheduler")

async def run_daily_tasks():
    """
    执行每日定时任务并记录日志
    - 会员过期处理
    - 每月赠礼重置与积分入账
    - 同步事件清理
    """
    logger.info("Running daily tasks...")
    async with engine.begin() as conn:
        # 1. Expire Memberships
        # Find users whose membership_expire_at < now and tier != FREE
        res = await conn.execute(
            text("UPDATE users SET membership_tier = 'FREE', membership_expire_at = NULL WHERE membership_tier != 'FREE' AND membership_expire_at < now()")
        )
        if res.rowcount > 0:
            logger.info(f"Expired {res.rowcount} memberships")

        # 2. Reset Monthly Gifts (if today is the reset day)
        # This is complex because each user might have a different reset day.
        # Simplified: Check users where monthly_gift_reset_at < now
        # Grant 500 credits + 3 OCR units (reset free_ocr_usage to 0)
        
        # Reset free OCR usage for everyone on their billing cycle? 
        # Or just reset it monthly?
        # V9.1 says: "Monthly gift: 500 credits + 3 standard OCR units"
        # We'll just reset free_ocr_usage to 0 if it's a new month for them.
        
        # For simplicity in this MVP, we'll just reset free_ocr_usage for everyone on the 1st of the month?
        # No, better to do it based on `monthly_gift_reset_at`.
        
        # Find users due for reset
        users_due = await conn.execute(
            text("SELECT id, membership_tier FROM users WHERE monthly_gift_reset_at < now() AND membership_tier != 'FREE'")
        )
        for row in users_due.fetchall():
            uid = row[0]
            tier = row[1]
            
            # Grant Credits
            # 500 credits for PRO
            credits_to_grant = 500
            
            # Update user: reset ocr usage, update reset date (+30 days)
            await conn.execute(
                text("UPDATE users SET free_ocr_usage = 0, monthly_gift_reset_at = monthly_gift_reset_at + interval '30 days' WHERE id = :uid"),
                {"uid": uid}
            )
            
            # Add credits
            await conn.execute(
                text("INSERT INTO credit_accounts(owner_id) VALUES (:uid) ON CONFLICT (owner_id) DO NOTHING"),
                {"uid": uid}
            )
            await conn.execute(
                text("UPDATE credit_accounts SET balance = balance + :c WHERE owner_id = :uid"),
                {"uid": uid, "c": credits_to_grant}
            )
            
            # Log ledger
            import uuid
            lid = str(uuid.uuid4())
            await conn.execute(
                text("INSERT INTO credit_ledger(id, owner_id, amount, currency, reason, direction) VALUES (:id, :uid, :amt, 'CREDITS', 'monthly_gift', 'credit')"),
                {"id": lid, "uid": uid, "amt": credits_to_grant}
            )
        
        # 3. Clean up delivered sync_events (retain for 7 days)
        res = await conn.execute(
            text("DELETE FROM sync_events WHERE delivered_at IS NOT NULL AND delivered_at < now() - interval '7 days'")
        )
        if res.rowcount > 0:
            logger.info(f"Cleaned up {res.rowcount} delivered sync_events")
        
        # 4. Clean up stale undelivered events (older than 30 days)
        res = await conn.execute(
            text("DELETE FROM sync_events WHERE delivered_at IS NULL AND created_at < now() - interval '30 days'")
        )
        if res.rowcount > 0:
            logger.info(f"Cleaned up {res.rowcount} stale undelivered sync_events")
            
    logger.info("Daily tasks completed")

if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.run_until_complete(run_daily_tasks())

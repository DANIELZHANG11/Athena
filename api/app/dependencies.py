from fastapi import HTTPException, Depends
from sqlalchemy import text
from .db import engine
from .auth import require_user

async def check_quota_status(auth=Depends(require_user)):
    user_id, _ = auth
    
    async with engine.begin() as conn:
        # Set RLS context
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        
        # 1. Get or create User Stats with defensive handling
        # First, ensure the row exists
        await conn.execute(
            text("""
                INSERT INTO user_stats (user_id, storage_used, book_count, extra_storage_quota, extra_book_quota)
                VALUES (cast(:uid as uuid), 0, 0, 0, 0)
                ON CONFLICT (user_id) DO NOTHING
            """),
            {"uid": user_id}
        )
        
        # Then fetch the stats
        res = await conn.execute(
            text("SELECT storage_used, book_count, extra_storage_quota, extra_book_quota FROM user_stats WHERE user_id = cast(:uid as uuid)"),
            {"uid": user_id}
        )
        stats = res.fetchone()
        storage_used = stats[0] if stats else 0
        book_count = stats[1] if stats else 0
        extra_storage = stats[2] if stats else 0
        extra_books = stats[3] if stats else 0
        
        # 2. Get System Settings
        sres = await conn.execute(text("SELECT key, value FROM system_settings WHERE key IN ('free_book_limit', 'free_storage_limit')"))
        settings = {row[0]: row[1] for row in sres.fetchall()}
        base_book_limit = int(settings.get("free_book_limit", 50))
        base_storage_limit = int(settings.get("free_storage_limit", 1073741824))
        
        # 3. Get Membership Status
        mres = await conn.execute(
            text("SELECT membership_tier, membership_expire_at FROM users WHERE id = cast(:uid as uuid)"),
            {"uid": user_id}
        )
        user_row = mres.fetchone()
        tier = user_row[0] if user_row else "FREE"
        expire_at = user_row[1] if user_row else None
        
        # Check if membership is active
        from datetime import datetime, timezone
        is_pro = False
        if tier != "FREE":
            if expire_at and expire_at > datetime.now(timezone.utc):
                is_pro = True
        
        # 4. Calculate Limits
        if is_pro:
            # Pro users have no effective limit (or very high)
            can_upload = True
            is_readonly = False
        else:
            total_book_limit = base_book_limit + extra_books
            total_storage_limit = base_storage_limit + extra_storage
            
            is_book_limit_reached = book_count >= total_book_limit
            is_storage_limit_reached = storage_used >= total_storage_limit
            
            # The Hook: Cannot upload if limit reached
            can_upload = not (is_book_limit_reached or is_storage_limit_reached)
            
            # The Trap: Readonly if limit reached (Soft Lock)
            is_readonly = is_book_limit_reached or is_storage_limit_reached
            
    return {
        "user_id": user_id,
        "is_pro": is_pro,
        "can_upload": can_upload,
        "is_readonly": is_readonly,
        "usage": {
            "books": book_count,
            "storage": storage_used
        },
        "limits": {
            "books": total_book_limit if not is_pro else -1,
            "storage": total_storage_limit if not is_pro else -1
        }
    }

def require_write_permission(quota=Depends(check_quota_status)):
    if quota["is_readonly"]:
        raise HTTPException(status_code=403, detail="readonly_mode_quota_exceeded")
    return quota

def require_upload_permission(quota=Depends(check_quota_status)):
    if not quota["can_upload"]:
        raise HTTPException(status_code=403, detail="upload_forbidden_quota_exceeded")
    return quota

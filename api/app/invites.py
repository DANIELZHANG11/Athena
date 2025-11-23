import uuid
import random
import string
from datetime import datetime
from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import text
from .db import engine
from .auth import require_user

router = APIRouter(prefix="/api/v1/invites", tags=["invites"])

def generate_invite_code():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))

@router.post("/generate")
async def generate_code(auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        # Check if user already has a code
        res = await conn.execute(
            text("SELECT invite_code FROM invites WHERE inviter_id = cast(:uid as uuid) LIMIT 1"),
            {"uid": user_id}
        )
        row = res.fetchone()
        if row:
            return {"status": "success", "data": {"code": row[0]}}
        
        # Generate new code
        code = generate_invite_code()
        # Simple retry logic for collision
        for _ in range(3):
            try:
                await conn.execute(
                    text("INSERT INTO invites (id, inviter_id, invite_code, status) VALUES (gen_random_uuid(), cast(:uid as uuid), :code, 'pending')"),
                    {"uid": user_id, "code": code}
                )
                break
            except Exception:
                code = generate_invite_code()
        else:
            raise HTTPException(status_code=500, detail="failed_to_generate_code")
            
        return {"status": "success", "data": {"code": code}}

@router.post("/redeem")
async def redeem_code(body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    code = body.get("code")
    if not code:
        raise HTTPException(status_code=400, detail="missing_code")
        
    async with engine.begin() as conn:
        # Find invite
        res = await conn.execute(
            text("SELECT id, inviter_id FROM invites WHERE invite_code = :code AND status = 'pending'"),
            {"code": code}
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="invalid_code")
        
        invite_id, inviter_id = row
        
        if str(inviter_id) == str(user_id):
            raise HTTPException(status_code=400, detail="cannot_invite_self")
            
        # Check if user already redeemed
        res = await conn.execute(
            text("SELECT 1 FROM invites WHERE invitee_id = cast(:uid as uuid)"),
            {"uid": user_id}
        )
        if res.fetchone():
            raise HTTPException(status_code=400, detail="already_redeemed")

        # Update invite status
        await conn.execute(
            text("UPDATE invites SET invitee_id = cast(:uid as uuid), status = 'completed', completed_at = now() WHERE id = cast(:iid as uuid)"),
            {"uid": user_id, "iid": invite_id}
        )
        
        # Grant rewards (read from settings first)
        sres = await conn.execute(text("SELECT key, value FROM system_settings WHERE key IN ('invite_bonus_storage', 'invite_bonus_books')"))
        settings = {row[0]: row[1] for row in sres.fetchall()}
        bonus_storage = int(settings.get("invite_bonus_storage", 524288000))
        bonus_books = int(settings.get("invite_bonus_books", 5))
        
        # Update inviter stats
        await conn.execute(
            text("""
                INSERT INTO user_stats (user_id, invite_count, extra_storage_quota, extra_book_quota)
                VALUES (cast(:inviter as uuid), 1, :bs, :bb)
                ON CONFLICT (user_id) DO UPDATE SET
                invite_count = user_stats.invite_count + 1,
                extra_storage_quota = user_stats.extra_storage_quota + :bs,
                extra_book_quota = user_stats.extra_book_quota + :bb,
                updated_at = now()
            """),
            {"inviter": inviter_id, "bs": bonus_storage, "bb": bonus_books}
        )
        
        # Update invitee stats (also gets reward)
        await conn.execute(
            text("""
                INSERT INTO user_stats (user_id, extra_storage_quota, extra_book_quota)
                VALUES (cast(:invitee as uuid), :bs, :bb)
                ON CONFLICT (user_id) DO UPDATE SET
                extra_storage_quota = user_stats.extra_storage_quota + :bs,
                extra_book_quota = user_stats.extra_book_quota + :bb,
                updated_at = now()
            """),
            {"invitee": user_id, "bs": bonus_storage, "bb": bonus_books}
        )
        
    return {"status": "success"}

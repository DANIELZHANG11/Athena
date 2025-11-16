import uuid
from fastapi import APIRouter, Body, Depends, Header, HTTPException
from sqlalchemy import text
from .db import engine
from .auth import require_user

router = APIRouter(prefix="/api/v1/profile", tags=["profile"])

@router.get("/me")
async def get_me(auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        try:
            res = await conn.execute(text("SELECT id::text, email, display_name, is_active, membership_tier, updated_at FROM users WHERE id = current_setting('app.user_id')::uuid"))
            row = res.fetchone()
            if not row:
                return {"status": "success", "data": {"id": user_id, "email": "", "display_name": "", "is_active": True, "membership_tier": "FREE", "etag": "W/\"1\""}}
            return {"status": "success", "data": {"id": row[0], "email": row[1] or "", "display_name": row[2] or "", "is_active": bool(row[3]), "membership_tier": row[4] or "FREE", "updated_at": str(row[5]), "etag": "W/\"1\""}}
        except Exception:
            res = await conn.execute(text("SELECT id::text, email, display_name, is_active, updated_at FROM users WHERE id = current_setting('app.user_id')::uuid"))
            row = res.fetchone()
            if not row:
                return {"status": "success", "data": {"id": user_id, "email": "", "display_name": "", "is_active": True, "etag": "W/\"1\""}}
        return {"status": "success", "data": {"id": row[0], "email": row[1] or "", "display_name": row[2] or "", "is_active": bool(row[3]), "updated_at": str(row[4]), "etag": "W/\"1\""}}

@router.patch("/me")
async def patch_me(body: dict = Body(...), if_match: str | None = Header(None), auth=Depends(require_user)):
    user_id, _ = auth
    if not if_match or not if_match.startswith("W/\""):
        raise HTTPException(status_code=428, detail="missing_if_match")
    display_name = body.get("display_name")
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        await conn.execute(text("UPDATE users SET display_name = COALESCE(:dn, display_name), updated_at = now() WHERE id = current_setting('app.user_id')::uuid"), {"dn": display_name})
    return {"status": "success"}
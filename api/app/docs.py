from fastapi import APIRouter, Depends
from sqlalchemy import text

from .auth import require_user
from .db import engine

router = APIRouter(prefix="/api/v1/docs", tags=["docs"])


@router.get("/{doc_id}/snapshots/latest")
async def latest_snapshot(doc_id: str, auth=Depends(require_user)):
    async with engine.begin() as conn:
        res = await conn.execute(
            text("SELECT snapshot, created_at FROM doc_snapshots WHERE doc_id = :d ORDER BY created_at DESC LIMIT 1"),
            {"d": doc_id},
        )
        row = res.fetchone()
        if not row:
            return {"status": "success", "data": None}
        return {
            "status": "success",
            "data": {"snapshot": row[0], "created_at": str(row[1])},
        }


@router.get("/{doc_id}/conflicts")
async def list_conflicts(doc_id: str, auth=Depends(require_user)):
    async with engine.begin() as conn:
        res = await conn.execute(
            text(
                "SELECT id::text, base_version, actual_version, created_at FROM doc_conflicts WHERE doc_id = :d ORDER BY created_at DESC"
            ),
            {"d": doc_id},
        )
        rows = res.fetchall()
        return {
            "status": "success",
            "data": [
                {
                    "id": r[0],
                    "base_version": int(r[1]),
                    "actual_version": int(r[2]),
                    "created_at": str(r[3]),
                }
                for r in rows
            ],
        }


@router.post("/{doc_id}/draft/recover")
async def recover_draft(doc_id: str, auth=Depends(require_user)):
    async with engine.begin() as conn:
        res = await conn.execute(
            text(
                "SELECT id::text, snapshot FROM doc_drafts WHERE doc_id = :d AND resolved = FALSE ORDER BY created_at DESC LIMIT 1"
            ),
            {"d": doc_id},
        )
        row = res.fetchone()
        if not row:
            return {"status": "success", "data": None}
        await conn.execute(
            text("UPDATE doc_drafts SET resolved = TRUE WHERE id = cast(:id as uuid)"),
            {"id": row[0]},
        )
        return {"status": "success", "data": {"draft_id": row[0], "snapshot": row[1]}}

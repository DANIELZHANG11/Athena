import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import text

from .auth import require_user
from .db import engine

router = APIRouter(prefix="/api/v1/srs", tags=["srs"])


def _schedule(ease: float, reps: int, interval: int, grade: int):
    if grade < 3:
        reps = 0
        interval = 1
    else:
        ease = max(1.3, ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)))
        if reps == 0:
            interval = 1
        elif reps == 1:
            interval = 6
        else:
            interval = int(round(interval * ease))
        reps += 1
    return ease, reps, interval


@router.post("/cards")
async def create_card(body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    front = body.get("front")
    back = body.get("back")
    deck = body.get("deck_name")
    if not front or not back:
        raise HTTPException(status_code=400, detail="invalid_payload")
    rid = str(uuid.uuid4())
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        next_at = datetime.utcnow() + timedelta(days=1)
        await conn.execute(
            text(
                "INSERT INTO srs_reviews(id, owner_id, front, back, deck_name, next_review_at) VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, :f, :b, :d, :n)"
            ),
            {"id": rid, "f": front, "b": back, "d": deck, "n": next_at},
        )
    return {"status": "success", "data": {"id": rid}}


@router.get("/due")
async def list_due(limit: int = 50, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        res = await conn.execute(
            text(
                "SELECT id::text, front, back, deck_name, ease_factor, interval_days, repetitions, next_review_at FROM srs_reviews WHERE owner_id = current_setting('app.user_id')::uuid AND (next_review_at IS NULL OR next_review_at <= now()) ORDER BY next_review_at ASC NULLS FIRST LIMIT :l"
            ),
            {"l": limit},
        )
        rows = res.fetchall()
        return {
            "status": "success",
            "data": [
                {
                    "id": r[0],
                    "front": r[1],
                    "back": r[2],
                    "deck_name": r[3],
                    "ease_factor": float(r[4]),
                    "interval_days": int(r[5]),
                    "repetitions": int(r[6]),
                    "next_review_at": str(r[7]) if r[7] else None,
                }
                for r in rows
            ],
        }


@router.post("/reviews/{id}/answer")
async def answer(id: str, body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    grade = int(body.get("grade") or -1)
    if grade < 0 or grade > 5:
        raise HTTPException(status_code=400, detail="invalid_grade")
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        res = await conn.execute(
            text(
                "SELECT ease_factor, repetitions, interval_days FROM srs_reviews WHERE id = cast(:id as uuid) AND owner_id = current_setting('app.user_id')::uuid"
            ),
            {"id": id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="not_found")
        ease, reps, interval = _schedule(float(row[0]), int(row[1]), int(row[2]), grade)
        next_at = datetime.utcnow() + timedelta(days=interval)
        await conn.execute(
            text(
                "UPDATE srs_reviews SET ease_factor = :e, repetitions = :r, interval_days = :i, last_grade = :g, next_review_at = :n, updated_at = now() WHERE id = cast(:id as uuid)"
            ),
            {"e": ease, "r": reps, "i": interval, "g": grade, "n": next_at, "id": id},
        )
    return {"status": "success"}


@router.get("/history")
async def history(limit: int = 50, offset: int = 0, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        res = await conn.execute(
            text(
                "SELECT id::text, front, back, deck_name, last_grade, repetitions, interval_days, next_review_at, updated_at FROM srs_reviews WHERE owner_id = current_setting('app.user_id')::uuid ORDER BY updated_at DESC LIMIT :l OFFSET :o"
            ),
            {"l": limit, "o": offset},
        )
        rows = res.fetchall()
        return {
            "status": "success",
            "data": [
                {
                    "id": r[0],
                    "front": r[1],
                    "back": r[2],
                    "deck_name": r[3],
                    "last_grade": r[4],
                    "repetitions": int(r[5]),
                    "interval_days": int(r[6]),
                    "next_review_at": str(r[7]) if r[7] else None,
                    "updated_at": str(r[8]),
                }
                for r in rows
            ],
        }

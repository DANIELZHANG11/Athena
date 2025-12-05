"""
阅读会话与进度同步接口

职责：
- `/start`：创建阅读会话，记录设备与初始状态
- `/heartbeat`：累计时长、更新每日阅读统计、保存书籍进度与最后位置、维护 streak
- `/sessions`：列出当前用户的阅读会话
- `/progress`：列出用户各书籍的阅读进度
- `/mark-finished`：标记/取消书籍读完状态
- `/stop`：结束阅读会话
- 兼容契约别名 `/api/v1/reading-sessions/*` 路由
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, Response
from sqlalchemy import text

from .auth import require_user
from .db import engine

router = APIRouter(prefix="/api/v1/reader")
alias = APIRouter(prefix="/api/v1/reading-sessions")


async def _ensure_tables(conn):
    return


@router.post("/start")
async def start(body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    book_id = body.get("book_id")
    device_id = body.get("device_id") or ""
    sid = str(uuid.uuid4())
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )

        await conn.execute(
            text(
                "INSERT INTO reading_sessions(id, user_id, book_id, device_id, is_active, total_ms, last_heartbeat) VALUES (cast(:id as uuid), cast(:uid as uuid), cast(:bid as uuid), :dev, TRUE, 0, now())"
            ),
            {"id": sid, "uid": user_id, "bid": book_id, "dev": device_id},
        )
    return {"status": "success", "data": {"session_id": sid}}


@router.post("/heartbeat")
async def heartbeat(body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    sid = body.get("session_id")
    delta_ms = int(body.get("delta_ms") or 0)
    progress = float(body.get("progress") or 0)
    last_location = body.get("last_location") or None
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )

        res = await conn.execute(
            text(
                "SELECT last_heartbeat FROM reading_sessions WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
            ),
            {"id": sid},
        )
        prev = res.fetchone()
        now_ts = datetime.now(timezone.utc)
        prev_ts = prev[0] if prev and prev[0] else now_ts
        await conn.execute(
            text(
                "UPDATE reading_sessions SET total_ms = total_ms + :d, last_heartbeat = now() WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
            ),
            {"d": delta_ms, "id": sid},
        )
        
        # 更新每日阅读时间 - 使用 UPSERT 模式确保数据正确写入
        if prev_ts.date() == now_ts.date():
            # 同一天：先尝试插入，再更新
            await conn.execute(
                text(
                    """INSERT INTO reading_daily(user_id, day, total_ms)
                       VALUES (current_setting('app.user_id')::uuid, current_date, :d)
                       ON CONFLICT (user_id, day) DO UPDATE SET total_ms = reading_daily.total_ms + :d"""
                ),
                {"d": delta_ms},
            )
        else:
            midnight = datetime.combine(
                now_ts.date(), datetime.min.time(), tzinfo=timezone.utc
            )
            ms_prev = int(max(0, (midnight - prev_ts).total_seconds() * 1000))
            ms_now = max(0, delta_ms - ms_prev)
            if ms_prev > 0:
                await conn.execute(
                    text(
                        """INSERT INTO reading_daily(user_id, day, total_ms)
                           VALUES (current_setting('app.user_id')::uuid, (current_date - INTERVAL '1 day')::date, :d)
                           ON CONFLICT (user_id, day) DO UPDATE SET total_ms = reading_daily.total_ms + :d"""
                    ),
                    {"d": ms_prev},
                )
            if ms_now > 0:
                await conn.execute(
                    text(
                        """INSERT INTO reading_daily(user_id, day, total_ms)
                           VALUES (current_setting('app.user_id')::uuid, current_date, :d)
                           ON CONFLICT (user_id, day) DO UPDATE SET total_ms = reading_daily.total_ms + :d"""
                    ),
                    {"d": ms_now},
                )
        import json as _j

        loc = (
            _j.dumps(last_location)
            if isinstance(last_location, (dict, list))
            else last_location
        )
        await conn.execute(
            text(
                "INSERT INTO reading_progress(user_id, book_id, progress, updated_at, last_location) SELECT current_setting('app.user_id')::uuid, s.book_id, :p, now(), cast(:loc as jsonb) FROM reading_sessions s WHERE s.id = cast(:id as uuid) ON CONFLICT (user_id, book_id) DO UPDATE SET progress = EXCLUDED.progress, updated_at = now(), last_location = COALESCE(EXCLUDED.last_location, reading_progress.last_location)"
            ),
            {"id": sid, "p": progress, "loc": loc},
        )
        
        # 更新连续阅读天数 (Streak)
        # 只要当天有阅读记录就计入 streak，无需达到目标
        await conn.execute(
            text(
                """
                INSERT INTO user_streaks(user_id, current_streak, longest_streak, last_read_date)
                VALUES (current_setting('app.user_id')::uuid, 1, 1, current_date)
                ON CONFLICT (user_id) DO UPDATE SET
                    current_streak = CASE
                        -- 如果昨天已阅读，streak +1
                        WHEN user_streaks.last_read_date = current_date - INTERVAL '1 day' THEN user_streaks.current_streak + 1
                        -- 如果今天已经更新过，保持不变
                        WHEN user_streaks.last_read_date = current_date THEN user_streaks.current_streak
                        -- 否则重置为 1
                        ELSE 1
                    END,
                    longest_streak = GREATEST(
                        user_streaks.longest_streak,
                        CASE
                            WHEN user_streaks.last_read_date = current_date - INTERVAL '1 day' THEN user_streaks.current_streak + 1
                            WHEN user_streaks.last_read_date = current_date THEN user_streaks.current_streak
                            ELSE 1
                        END
                    ),
                    last_read_date = current_date
                """
            ),
        )
    return {"status": "success"}


@router.get("/sessions")
async def list_sessions(auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT id::text, book_id::text, device_id, total_ms, last_heartbeat FROM reading_sessions WHERE user_id = current_setting('app.user_id')::uuid ORDER BY last_heartbeat DESC"
            )
        )
        rows = res.fetchall()
        return {
            "status": "success",
            "data": [
                {
                    "id": r[0],
                    "book_id": r[1],
                    "device_id": r[2],
                    "total_ms": r[3],
                    "last_heartbeat": str(r[4]),
                }
                for r in rows
            ],
        }


@router.get("/progress")
async def get_progress(auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT book_id::text, progress, updated_at, last_location, finished_at FROM reading_progress WHERE user_id = current_setting('app.user_id')::uuid ORDER BY updated_at DESC"
            )
        )
        rows = res.fetchall()
        return {
            "status": "success",
            "data": [
                {
                    "book_id": r[0],
                    "progress": float(r[1]),
                    "updated_at": str(r[2]),
                    "last_location": r[3],
                    "finished_at": str(r[4]) if r[4] else None,
                }
                for r in rows
            ],
        }


@router.post("/mark-finished")
async def mark_finished(body: dict = Body(...), auth=Depends(require_user)):
    """
    标记书籍为已读完或取消已读完。
    body: { book_id: str, finished: bool }
    """
    user_id, _ = auth
    book_id = body.get("book_id")
    finished = body.get("finished", True)
    
    if not book_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="book_id_required")
    
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        
        if finished:
            # 标记为已读完：设置 finished_at 为当前时间
            await conn.execute(
                text(
                    """INSERT INTO reading_progress(user_id, book_id, progress, finished_at, updated_at)
                       VALUES (current_setting('app.user_id')::uuid, cast(:bid as uuid), 1.0, now(), now())
                       ON CONFLICT (user_id, book_id) DO UPDATE SET finished_at = now(), updated_at = now()"""
                ),
                {"bid": book_id},
            )
        else:
            # 取消已读完：清空 finished_at
            await conn.execute(
                text(
                    """UPDATE reading_progress 
                       SET finished_at = NULL, updated_at = now() 
                       WHERE user_id = current_setting('app.user_id')::uuid 
                       AND book_id = cast(:bid as uuid)"""
                ),
                {"bid": book_id},
            )
    
    return {"status": "success", "data": {"finished": finished}}


@router.post("/stop")
async def stop(body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    sid = body.get("session_id")
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "UPDATE reading_sessions SET is_active = FALSE WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
            ),
            {"id": sid},
        )
    return {"status": "success"}


# 契约别名路由：/api/v1/reading-sessions/*
@alias.post("/start")
async def alias_start(body: dict = Body(...), auth=Depends(require_user)):
    return await start(body, auth)


@alias.get("/progress")
async def alias_progress(auth=Depends(require_user)):
    return await get_progress(auth)


@alias.post("/{session_id}/heartbeat")
async def alias_heartbeat(
    session_id: str, body: dict = Body(...), auth=Depends(require_user)
):
    b = dict(body or {})
    b["session_id"] = session_id
    await heartbeat(b, auth)
    return Response(status_code=204)


@alias.post("/{session_id}/end")
async def alias_stop(session_id: str, auth=Depends(require_user)):
    await stop({"session_id": session_id}, auth)
    return Response(status_code=204)

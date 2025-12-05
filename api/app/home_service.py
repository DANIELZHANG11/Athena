"""
首页仪表盘服务模型与计算

职责：
- 定义 Dashboard/Goals/Streak/Today/Weekly/YearlyFinished 模型
- 计算今日、周、年阅读统计与 streak，生成仪表盘数据
- 提供更新用户目标的服务方法

说明：
- 仅新增注释，不改动统计与查询逻辑
"""
import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import text

from .db import engine


class Goals(BaseModel):
    daily_minutes: int
    yearly_books: int


class Streak(BaseModel):
    current_streak: int
    longest_streak: int
    last_read_date: date | None
    active: bool


class Today(BaseModel):
    seconds: int
    minutes: int
    target_minutes: int
    percent: int


class WeeklyDay(BaseModel):
    date: date
    minutes: int
    status: Literal["FUTURE", "MISSED", "REACHED", "PARTIAL"]


class YearlyFinished(BaseModel):
    count: int
    recent_covers: list[str]


class Dashboard(BaseModel):
    goals: Goals
    streak: Streak
    today: Today
    weekly: list[WeeklyDay]
    yearly_finished: YearlyFinished


async def _ensure_defaults(conn, user_id: str):
    await conn.execute(
        text(
            "INSERT INTO user_reading_goals(user_id, daily_minutes, yearly_books)\n             SELECT cast(:uid as uuid), 30, 10\n             WHERE NOT EXISTS (SELECT 1 FROM user_reading_goals WHERE user_id = cast(:uid as uuid))"
        ),
        {"uid": user_id},
    )
    await conn.execute(
        text(
            "INSERT INTO user_streaks(user_id, current_streak, longest_streak)\n             SELECT cast(:uid as uuid), 0, 0\n             WHERE NOT EXISTS (SELECT 1 FROM user_streaks WHERE user_id = cast(:uid as uuid))"
        ),
        {"uid": user_id},
    )


def _tz_now(tz_name: str | None) -> datetime:
    try:
        from zoneinfo import ZoneInfo

        return datetime.now(ZoneInfo(tz_name or "UTC"))
    except Exception:
        return datetime.utcnow()


def _week_range(d: date) -> tuple[date, date]:
    start = d
    while start.weekday() != 0:
        start = date.fromordinal(start.toordinal() - 1)
    end = date.fromordinal(start.toordinal() + 6)
    return start, end


async def get_dashboard(user_id: str) -> Dashboard:
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        await _ensure_defaults(conn, user_id)

        tz_res = await conn.execute(text("SELECT timezone FROM users WHERE id = current_setting('app.user_id')::uuid"))
        tz_row = tz_res.fetchone()
        tz_name = (tz_row[0] if tz_row else None) or "UTC"
        now_local = _tz_now(tz_name)
        today_local = now_local.date()
        try:
            from zoneinfo import ZoneInfo

            year_start_dt = datetime(today_local.year, 1, 1, tzinfo=ZoneInfo(tz_name))
        except Exception:
            year_start_dt = datetime(today_local.year, 1, 1)
        week_start, week_end = _week_range(today_local)

        g_res = await conn.execute(text("SELECT daily_minutes, yearly_books FROM user_reading_goals WHERE user_id = current_setting('app.user_id')::uuid"))
        g = g_res.fetchone()
        goals = Goals(daily_minutes=int(g[0]), yearly_books=int(g[1])) if g else Goals(daily_minutes=30, yearly_books=10)

        s_res = await conn.execute(text("SELECT current_streak, longest_streak, last_read_date FROM user_streaks WHERE user_id = current_setting('app.user_id')::uuid"))
        s = s_res.fetchone()
        last = s[2] if s else None
        active = False
        try:
            if last and isinstance(last, date):
                active = (date.fromordinal(today_local.toordinal() - 1) == last)
        except Exception:
            active = False
        streak = Streak(current_streak=int(s[0]) if s else 0, longest_streak=int(s[1]) if s else 0, last_read_date=last, active=active)

        td_res = await conn.execute(text("SELECT total_ms FROM reading_daily WHERE user_id = current_setting('app.user_id')::uuid AND day = :d"), {"d": today_local})
        td = td_res.fetchone()
        seconds = int((int(td[0]) if td else 0) / 1000)
        minutes = int(round(seconds / 60))
        percent = max(0, min(100, int(round(100.0 * minutes / max(1, goals.daily_minutes)))))
        today_obj = Today(seconds=seconds, minutes=minutes, target_minutes=goals.daily_minutes, percent=percent)

        wk_res = await conn.execute(text("SELECT day, total_ms FROM reading_daily WHERE user_id = current_setting('app.user_id')::uuid AND day BETWEEN :s AND :e"), {"s": week_start, "e": week_end})
        wk_rows = {str(r[0]): int(r[1]) for r in wk_res.fetchall()}
        weekly: list[WeeklyDay] = []
        for i in range(7):
            d = date.fromordinal(week_start.toordinal() + i)
            ms = wk_rows.get(str(d), 0)
            m = int(round(int(ms) / 1000 / 60))
            status: Literal["FUTURE", "MISSED", "REACHED", "PARTIAL"]
            if d > today_local:
                status = "FUTURE"
            elif m == 0:
                status = "MISSED"
            elif m >= goals.daily_minutes:
                status = "REACHED"
            else:
                status = "PARTIAL"
            weekly.append(WeeklyDay(date=d, minutes=m, status=status))

        y_cnt_res = await conn.execute(text("SELECT COUNT(1) FROM reading_progress WHERE user_id = current_setting('app.user_id')::uuid AND finished_at IS NOT NULL AND finished_at >= :y"), {"y": year_start_dt})
        y_count_row = y_cnt_res.fetchone()
        y_count = int(y_count_row[0]) if y_count_row else 0
        # 返回 book_id 而不是 cover_image_key，前端将使用 API 代理获取封面
        covers_res = await conn.execute(text("SELECT b.id::text FROM reading_progress rp JOIN books b ON b.id = rp.book_id WHERE rp.user_id = current_setting('app.user_id')::uuid AND rp.finished_at IS NOT NULL AND rp.finished_at >= :y ORDER BY rp.finished_at DESC LIMIT 5"), {"y": year_start_dt})
        book_ids = [r[0] for r in covers_res.fetchall() if r and r[0]]
        yearly = YearlyFinished(count=y_count, recent_covers=book_ids)

        return Dashboard(goals=goals, streak=streak, today=today_obj, weekly=weekly, yearly_finished=yearly)


async def update_goals(user_id: str, daily_minutes: int | None = None, yearly_books: int | None = None):
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        await _ensure_defaults(conn, user_id)
        if daily_minutes is not None:
            await conn.execute(
                text("UPDATE user_reading_goals SET daily_minutes = :m, updated_at = now() WHERE user_id = current_setting('app.user_id')::uuid"),
                {"m": daily_minutes},
            )
        if yearly_books is not None:
            await conn.execute(
                text("UPDATE user_reading_goals SET yearly_books = :b, updated_at = now() WHERE user_id = current_setting('app.user_id')::uuid"),
                {"b": yearly_books},
            )

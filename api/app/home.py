"""
首页仪表盘与目标设置接口

职责：
- `/dashboard`：聚合用户的今日/周/年阅读统计与目标达成情况
- `/goals`：更新每日阅读分钟与年度书籍目标

说明：
- 仅新增注释，不改动聚合服务调用
"""
from fastapi import APIRouter, Body, Depends

from .auth import require_user
from .home_service import get_dashboard

router = APIRouter(prefix="/api/v1/home", tags=["home"])


@router.get("/dashboard")
async def dashboard(auth=Depends(require_user)):
    user_id, _ = auth
    data = await get_dashboard(user_id)
    return {"status": "success", "data": data.model_dump()}


@router.patch("/goals")
async def update_goals_endpoint(body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    from .home_service import update_goals

    await update_goals(user_id, body.get("daily_minutes"), body.get("yearly_books"))
    return {"status": "success"}

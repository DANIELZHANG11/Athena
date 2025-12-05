"""
数据库引擎与会话变量

职责：
- 初始化全局异步数据库引擎与会话工厂
- 提供 `set_session_vars` 设置本地会话变量：`app.user_id` 与 `app.role`

说明：
- 仅新增注释，不改动连接与配置
"""
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+asyncpg://athena:athena_dev@postgres:5432/athena"
)
engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def set_session_vars(session, user_id: str | None, role: str | None):
    if user_id:
        await session.execute(text("SET LOCAL app.user_id = :v"), {"v": user_id})
    if role:
        await session.execute(text("SET LOCAL app.role = :v"), {"v": role})

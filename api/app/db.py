import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import text

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://athena:athena_dev@postgres:5432/athena")
engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def set_session_vars(session, user_id: str | None, role: str | None):
    if user_id:
        await session.execute(text("SET LOCAL app.user_id = :v"), {"v": user_id})
    if role:
        await session.execute(text("SET LOCAL app.role = :v"), {"v": role})


import os
from alembic import context
from sqlalchemy import pool, create_engine

config = context.config
url = os.getenv("DATABASE_URL")
if url and "+asyncpg" in url:
    url = url.replace("+asyncpg", "")
if url:
    config.set_main_option("sqlalchemy.url", url)

def run_migrations_offline():
    context.configure(url=config.get_main_option("sqlalchemy.url"), literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online():
    connectable = create_engine(
        config.get_main_option("sqlalchemy.url"),
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()


"""add last_location column to reading_progress

Revision ID: 0128_add_last_location_column
Revises: 0127_add_shelf_books_user_id
Create Date: 2025-12-17

说明：
添加 last_location 列到 reading_progress 表。
此字段在 sync_rules.yaml 中定义但迁移 0126 中漏掉。

last_location 存储 JSON 格式的位置信息：
{
  "currentPage": number,
  "totalPages": number
}

@see docker/powersync/sync_rules.yaml
@see web/src/lib/powersync/schema.ts
"""
from alembic import op

revision = '0128'
down_revision = '0127'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        -- 添加 last_location 列（JSON 字符串）
        ALTER TABLE IF EXISTS reading_progress
          ADD COLUMN IF NOT EXISTS last_location TEXT;
        
        -- 可选：从 last_position 尝试迁移数据（如果包含 JSON 格式）
        -- 这里不做自动迁移，因为 last_position 存的是 CFI 字符串
    """)


def downgrade():
    op.execute("""
        ALTER TABLE IF EXISTS reading_progress
          DROP COLUMN IF EXISTS last_location;
    """)

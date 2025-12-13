"""add meta column to notes and highlights tables

Revision ID: 0125_add_notes_meta
Revises: 0124_add_conversion_status
Create Date: 2025-12-09 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '0125'
down_revision = '0124'
branch_labels = None
depends_on = None


def upgrade():
    # 为 notes 表添加 meta 列，用于存储 clientId 等元数据
    op.execute("""
        ALTER TABLE IF EXISTS notes
          ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;
        
        -- 创建索引以支持快速查询 clientId
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notes_meta_client_id'
          ) THEN
            CREATE INDEX idx_notes_meta_client_id ON notes ((meta->>'clientId'));
          END IF;
        END$$;
    """)
    
    # 为 highlights 表添加 meta 列
    op.execute("""
        ALTER TABLE IF EXISTS highlights
          ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;
        
        -- 创建索引以支持快速查询 clientId
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_highlights_meta_client_id'
          ) THEN
            CREATE INDEX idx_highlights_meta_client_id ON highlights ((meta->>'clientId'));
          END IF;
        END$$;
    """)
    
    # 为 notes 表添加 device_id 列（用于冲突检测）
    op.execute("""
        ALTER TABLE IF EXISTS notes
          ADD COLUMN IF NOT EXISTS device_id TEXT;
        
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notes_device_id'
          ) THEN
            CREATE INDEX idx_notes_device_id ON notes (device_id);
          END IF;
        END$$;
    """)
    
    # 为 highlights 表添加 device_id 列
    op.execute("""
        ALTER TABLE IF EXISTS highlights
          ADD COLUMN IF NOT EXISTS device_id TEXT;
        
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_highlights_device_id'
          ) THEN
            CREATE INDEX idx_highlights_device_id ON highlights (device_id);
          END IF;
        END$$;
    """)


def downgrade():
    op.execute("ALTER TABLE IF EXISTS notes DROP COLUMN IF EXISTS meta CASCADE;")
    op.execute("ALTER TABLE IF EXISTS notes DROP COLUMN IF EXISTS device_id CASCADE;")
    op.execute("ALTER TABLE IF EXISTS highlights DROP COLUMN IF EXISTS meta CASCADE;")
    op.execute("ALTER TABLE IF EXISTS highlights DROP COLUMN IF EXISTS device_id CASCADE;")

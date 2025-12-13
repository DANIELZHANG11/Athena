"""add powersync compatible columns

Revision ID: 0126_add_powersync_columns
Revises: 0125
Create Date: 2025-12-13

说明：
为 PowerSync 同步兼容性添加必要的列和约束
- reading_progress: 添加 id 列
- notes/highlights: 添加 is_deleted, page_number, position_cfi 等列
- shelves: 添加 is_deleted, sort_order, cover_url 等列
- user_settings: 创建表（如果不存在）
- bookmarks: 创建表（如果不存在）

@see 09 - APP-FIRST架构改造计划.md - Phase 2
"""
from alembic import op

revision = '0126'
down_revision = '0125'
branch_labels = None
depends_on = None


def upgrade():
    # 1. reading_progress 表：添加 id 和 device_id 列
    op.execute("""
        -- 添加 id 列（用于 PowerSync 同步）
        ALTER TABLE IF EXISTS reading_progress
          ADD COLUMN IF NOT EXISTS id UUID;
        
        -- 为现有记录生成 UUID
        UPDATE reading_progress SET id = gen_random_uuid() WHERE id IS NULL;
        
        -- 添加 device_id 列
        ALTER TABLE IF EXISTS reading_progress
          ADD COLUMN IF NOT EXISTS device_id TEXT;
        
        -- 添加 last_position 列（CFI 字符串）
        ALTER TABLE IF EXISTS reading_progress
          ADD COLUMN IF NOT EXISTS last_position TEXT;
        
        -- 添加 finished_at 列（如果不存在）
        ALTER TABLE IF EXISTS reading_progress
          ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
        
        -- 创建 id 索引
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_reading_progress_id'
          ) THEN
            CREATE UNIQUE INDEX idx_reading_progress_id ON reading_progress (id);
          END IF;
        END$$;
    """)

    # 2. notes 表：添加 PowerSync 兼容列
    op.execute("""
        ALTER TABLE IF EXISTS notes
          ADD COLUMN IF NOT EXISTS page_number INTEGER,
          ADD COLUMN IF NOT EXISTS position_cfi TEXT,
          ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#FFEB3B',
          ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
        
        -- 将现有 deleted_at 转换为 is_deleted
        UPDATE notes SET is_deleted = TRUE WHERE deleted_at IS NOT NULL AND is_deleted IS NULL;
        UPDATE notes SET is_deleted = FALSE WHERE is_deleted IS NULL;
    """)

    # 3. highlights 表：添加 PowerSync 兼容列
    op.execute("""
        ALTER TABLE IF EXISTS highlights
          ADD COLUMN IF NOT EXISTS text TEXT,
          ADD COLUMN IF NOT EXISTS page_number INTEGER,
          ADD COLUMN IF NOT EXISTS position_start_cfi TEXT,
          ADD COLUMN IF NOT EXISTS position_end_cfi TEXT,
          ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
        
        -- 迁移现有数据
        UPDATE highlights SET 
          position_start_cfi = start_location,
          position_end_cfi = end_location
        WHERE position_start_cfi IS NULL AND start_location IS NOT NULL;
        
        UPDATE highlights SET is_deleted = TRUE WHERE deleted_at IS NOT NULL AND is_deleted IS NULL;
        UPDATE highlights SET is_deleted = FALSE WHERE is_deleted IS NULL;
    """)

    # 4. shelves 表：添加 PowerSync 兼容列
    op.execute("""
        ALTER TABLE IF EXISTS shelves
          ADD COLUMN IF NOT EXISTS cover_url TEXT,
          ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
        
        UPDATE shelves SET is_deleted = FALSE WHERE is_deleted IS NULL;
    """)

    # 5. 创建 bookmarks 表（如果不存在）
    op.execute("""
        CREATE TABLE IF NOT EXISTS bookmarks (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL,
          book_id UUID NOT NULL,
          device_id TEXT,
          title TEXT,
          page_number INTEGER,
          position_cfi TEXT,
          is_deleted BOOLEAN DEFAULT FALSE,
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bookmarks_user_book'
          ) THEN
            CREATE INDEX idx_bookmarks_user_book ON bookmarks (user_id, book_id);
          END IF;
        END$$;
        
        -- 启用 RLS
        ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;
        
        -- 创建 RLS 策略（如果不存在）
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_policies WHERE tablename = 'bookmarks' AND policyname = 'bookmarks_user_isolation'
          ) THEN
            CREATE POLICY bookmarks_user_isolation ON bookmarks
              USING (user_id = current_setting('app.user_id')::uuid);
          END IF;
        END$$;
    """)

    # 6. 创建 user_settings 表（如果不存在）
    op.execute("""
        CREATE TABLE IF NOT EXISTS user_settings (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL,
          device_id TEXT,
          settings_json JSONB DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_user_settings_user'
          ) THEN
            CREATE UNIQUE INDEX idx_user_settings_user ON user_settings (user_id);
          END IF;
        END$$;
        
        -- 启用 RLS
        ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
        
        -- 创建 RLS 策略
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_policies WHERE tablename = 'user_settings' AND policyname = 'user_settings_user_isolation'
          ) THEN
            CREATE POLICY user_settings_user_isolation ON user_settings
              USING (user_id = current_setting('app.user_id')::uuid);
          END IF;
        END$$;
    """)

    # 7. 创建 shelf_books 表（如果不存在）- 与 shelf_items 共存
    op.execute("""
        CREATE TABLE IF NOT EXISTS shelf_books (
          id UUID PRIMARY KEY,
          shelf_id UUID NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
          book_id UUID NOT NULL,
          sort_order INTEGER DEFAULT 0,
          added_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_shelf_books_shelf'
          ) THEN
            CREATE INDEX idx_shelf_books_shelf ON shelf_books (shelf_id);
          END IF;
          
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_shelf_books_book'
          ) THEN
            CREATE INDEX idx_shelf_books_book ON shelf_books (book_id);
          END IF;
        END$$;
        
        -- 从 shelf_items 迁移数据（如果有的话）
        INSERT INTO shelf_books (id, shelf_id, book_id, sort_order, added_at)
        SELECT gen_random_uuid(), shelf_id, book_id, COALESCE(position, 0), COALESCE(created_at, now())
        FROM shelf_items
        ON CONFLICT DO NOTHING;
    """)

    # 8. 为 reading_sessions 表添加缺失列
    op.execute("""
        ALTER TABLE IF EXISTS reading_sessions
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
        
        -- 更新现有记录
        UPDATE reading_sessions SET created_at = last_heartbeat WHERE created_at IS NULL;
        UPDATE reading_sessions SET updated_at = last_heartbeat WHERE updated_at IS NULL;
    """)


def downgrade():
    # 回滚时只删除新添加的列，不删除表（保持数据安全）
    op.execute("""
        ALTER TABLE IF EXISTS reading_progress
          DROP COLUMN IF EXISTS id,
          DROP COLUMN IF EXISTS device_id,
          DROP COLUMN IF EXISTS last_position;
        
        ALTER TABLE IF EXISTS notes
          DROP COLUMN IF EXISTS page_number,
          DROP COLUMN IF EXISTS position_cfi,
          DROP COLUMN IF EXISTS color,
          DROP COLUMN IF EXISTS is_deleted;
        
        ALTER TABLE IF EXISTS highlights
          DROP COLUMN IF EXISTS text,
          DROP COLUMN IF EXISTS page_number,
          DROP COLUMN IF EXISTS position_start_cfi,
          DROP COLUMN IF EXISTS position_end_cfi,
          DROP COLUMN IF EXISTS is_deleted;
        
        ALTER TABLE IF EXISTS shelves
          DROP COLUMN IF EXISTS cover_url,
          DROP COLUMN IF EXISTS sort_order,
          DROP COLUMN IF EXISTS is_deleted,
          DROP COLUMN IF EXISTS deleted_at;
        
        DROP TABLE IF EXISTS shelf_books CASCADE;
        DROP TABLE IF EXISTS bookmarks CASCADE;
        DROP TABLE IF EXISTS user_settings CASCADE;
    """)

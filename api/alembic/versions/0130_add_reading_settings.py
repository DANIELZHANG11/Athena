"""add reading_settings table

Revision ID: 0130_add_reading_settings
Revises: 0129
Create Date: 2025-12-30

说明：
为阅读模式设置添加专用表，支持：
- 每本书独立的外观设置（字体、大小、主题等）
- 全局默认设置（book_id = NULL）
- PowerSync 双向同步

@see 04 - 数据库全景与迁移 3.5节
@see 02 - 功能规格与垂直切片 2.11节
"""
from alembic import op

revision = '0130'
down_revision = '0129'
branch_labels = None
depends_on = None


def upgrade():
    # 创建 reading_settings 表
    op.execute("""
        CREATE TABLE IF NOT EXISTS reading_settings (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          book_id UUID REFERENCES books(id) ON DELETE CASCADE,  -- NULL 表示全局默认设置
          device_id TEXT,
          
          -- 主题设置
          theme_id TEXT NOT NULL DEFAULT 'white',  -- white|sepia|toffee|gray|dark|black|custom
          background_color TEXT,  -- 自定义背景色 #RRGGBB
          text_color TEXT,  -- 自定义文字色 #RRGGBB
          
          -- 文字设置
          font_family TEXT NOT NULL DEFAULT 'system',
          font_size INTEGER NOT NULL DEFAULT 18,  -- 12-32
          font_weight INTEGER NOT NULL DEFAULT 400,  -- 400/500/600/700
          
          -- 间距设置
          line_height REAL NOT NULL DEFAULT 1.6,  -- 1.0-2.5
          paragraph_spacing REAL NOT NULL DEFAULT 1.0,
          margin_horizontal INTEGER NOT NULL DEFAULT 24,  -- px
          
          -- 显示设置
          text_align TEXT NOT NULL DEFAULT 'justify',  -- left|justify
          hyphenation BOOLEAN NOT NULL DEFAULT TRUE,
          
          -- 元数据
          is_deleted BOOLEAN DEFAULT FALSE,
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          
          -- 每个用户每本书只有一条设置记录
          CONSTRAINT reading_settings_user_book_unique UNIQUE (user_id, book_id)
        );
        
        -- 创建索引
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_reading_settings_user'
          ) THEN
            CREATE INDEX idx_reading_settings_user ON reading_settings (user_id);
          END IF;
          
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_reading_settings_user_book'
          ) THEN
            CREATE INDEX idx_reading_settings_user_book ON reading_settings (user_id, book_id);
          END IF;
        END$$;
        
        -- 启用 RLS (Row Level Security)
        ALTER TABLE reading_settings ENABLE ROW LEVEL SECURITY;
        
        -- 创建 RLS 策略
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_policies WHERE tablename = 'reading_settings' AND policyname = 'reading_settings_user_isolation'
          ) THEN
            CREATE POLICY reading_settings_user_isolation ON reading_settings
              USING (user_id = current_setting('app.user_id')::uuid);
          END IF;
        END$$;
        
        -- 添加注释
        COMMENT ON TABLE reading_settings IS '阅读模式设置表 - 支持每本书独立的外观设置';
        COMMENT ON COLUMN reading_settings.book_id IS 'NULL 表示全局默认设置';
        COMMENT ON COLUMN reading_settings.theme_id IS '预设主题: white|sepia|toffee|gray|dark|black|custom';
        COMMENT ON COLUMN reading_settings.font_family IS '字体: system|noto-serif-sc|noto-sans-sc|lxgw-wenkai|georgia|helvetica';
    """)


def downgrade():
    op.execute("""
        DROP TABLE IF EXISTS reading_settings CASCADE;
    """)

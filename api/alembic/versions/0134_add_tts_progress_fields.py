"""Add TTS listening progress fields to reading_progress

Revision ID: 0134
Revises: 0133
Create Date: 2026-01-20

说明：
为 reading_progress 表添加 TTS 听书进度字段，支持跨设备恢复播放位置。

新增字段：
- tts_chapter_index: 当前播放章节索引
- tts_position_ms: 章节内音频时间戳（毫秒）
- tts_last_played_at: 最后播放时间

@see 对话记录.md - 2.11 TTS 听书功能实施计划
@see docker/powersync/sync_rules.yaml
@see web/src/lib/powersync/schema.ts
"""
from alembic import op

revision = '0134'
down_revision = '0133'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        -- TTS 听书进度字段
        -- tts_chapter_index: 当前播放的章节索引（0-based）
        ALTER TABLE IF EXISTS reading_progress
          ADD COLUMN IF NOT EXISTS tts_chapter_index INTEGER;
        
        -- tts_position_ms: 章节内的音频位置（毫秒）
        ALTER TABLE IF EXISTS reading_progress
          ADD COLUMN IF NOT EXISTS tts_position_ms INTEGER;
        
        -- tts_last_played_at: 最后 TTS 播放时间（用于跨设备恢复）
        ALTER TABLE IF EXISTS reading_progress
          ADD COLUMN IF NOT EXISTS tts_last_played_at TIMESTAMPTZ;
        
        -- 添加索引优化 TTS 进度查询
        CREATE INDEX IF NOT EXISTS idx_reading_progress_tts 
          ON reading_progress(user_id, tts_last_played_at DESC)
          WHERE tts_last_played_at IS NOT NULL;
    """)


def downgrade():
    op.execute("""
        DROP INDEX IF EXISTS idx_reading_progress_tts;
        
        ALTER TABLE IF EXISTS reading_progress
          DROP COLUMN IF EXISTS tts_last_played_at;
        
        ALTER TABLE IF EXISTS reading_progress
          DROP COLUMN IF EXISTS tts_position_ms;
        
        ALTER TABLE IF EXISTS reading_progress
          DROP COLUMN IF EXISTS tts_chapter_index;
    """)

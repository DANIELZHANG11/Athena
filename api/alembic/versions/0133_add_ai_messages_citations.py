"""
Add citations JSONB column to ai_messages table

Revision ID: 0133
Revises: 0132
Create Date: 2026-01-12
"""

from alembic import op

revision = "0133"
down_revision = "0132"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        -- 添加 citations 列存储 AI 回答的引用信息
        ALTER TABLE ai_messages
        ADD COLUMN IF NOT EXISTS citations JSONB;
        
        -- 添加注释
        COMMENT ON COLUMN ai_messages.citations IS 'AI回答的书籍引用信息，仅assistant角色消息有值';
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE ai_messages
        DROP COLUMN IF EXISTS citations;
        """
    )

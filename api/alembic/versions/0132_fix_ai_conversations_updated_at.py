"""
Add updated_at column to ai_conversations table

Revision ID: 0132_fix_ai_conversations_updated_at
Revises: 0131_add_ai_models_extended
Create Date: 2026-01-11

The ai_conversations table was created in 0105 without updated_at column,
but the API code expects this column. This migration adds it.
"""

from alembic import op

revision = "0132"
down_revision = "0131"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        -- Add updated_at column to ai_conversations if not exists
        ALTER TABLE ai_conversations
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
        
        -- Ensure ai_messages also has updated_at for consistency
        ALTER TABLE ai_messages
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
        """
    )


def downgrade():
    op.execute(
        """
        ALTER TABLE ai_messages
            DROP COLUMN IF EXISTS updated_at;
        ALTER TABLE ai_conversations
            DROP COLUMN IF EXISTS updated_at;
        """
    )

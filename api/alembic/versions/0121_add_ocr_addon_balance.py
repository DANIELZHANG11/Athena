"""
Add ocr_addon_balance column to users table for tracking purchased OCR addon packs

Revision ID: 0121
Revises: 0120
Create Date: 2025-12-03
"""

from alembic import op

revision = "0121"
down_revision = "0120"  # After 0120_add_ocr_system_settings
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        DO $$
        BEGIN
          -- Add ocr_addon_balance column (purchased addon pack remaining count)
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='users' AND column_name='ocr_addon_balance'
          ) THEN
            ALTER TABLE users ADD COLUMN ocr_addon_balance INTEGER DEFAULT 0;
          END IF;
        END$$;
        """
    )


def downgrade():
    op.execute(
        """
        ALTER TABLE IF EXISTS users DROP COLUMN IF EXISTS ocr_addon_balance;
        """
    )

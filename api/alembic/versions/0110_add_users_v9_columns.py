"""
Add V9.1 columns to users table

Revision ID: e2b7c3d4e5f6
Revises: d0a6b2c4e5f7
Create Date: 2025-11-23
"""

from alembic import op

revision = "e2b7c3d4e5f6"
down_revision = "d0a6b2c4e5f7"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        DO $$
        BEGIN
          -- Add membership_expire_at column
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='users' AND column_name='membership_expire_at'
          ) THEN
            ALTER TABLE users ADD COLUMN membership_expire_at TIMESTAMPTZ;
          END IF;
          
          -- Add monthly_gift_reset_at column
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='users' AND column_name='monthly_gift_reset_at'
          ) THEN
            ALTER TABLE users ADD COLUMN monthly_gift_reset_at TIMESTAMPTZ;
          END IF;
          
          -- Add free_ocr_usage column
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='users' AND column_name='free_ocr_usage'
          ) THEN
            ALTER TABLE users ADD COLUMN free_ocr_usage INTEGER DEFAULT 0;
          END IF;
        END$$;
        """
    )


def downgrade():
    op.execute(
        """
        ALTER TABLE IF EXISTS users DROP COLUMN IF EXISTS free_ocr_usage;
        ALTER TABLE IF EXISTS users DROP COLUMN IF EXISTS monthly_gift_reset_at;
        ALTER TABLE IF EXISTS users DROP COLUMN IF EXISTS membership_expire_at;
        """
    )


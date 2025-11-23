"""
Add platform and sku_id to pricing_rules

Revision ID: c9f5a1b4d3e6
Revises: b8e4f0c3d2a5
Create Date: 2025-11-23
"""

from alembic import op

revision = "c9f5a1b4d3e6"
down_revision = "b8e4f0c3d2a5"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='pricing_rules' AND column_name='platform'
          ) THEN
            ALTER TABLE pricing_rules ADD COLUMN platform VARCHAR(20) DEFAULT 'web';
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='pricing_rules' AND column_name='sku_id'
          ) THEN
            ALTER TABLE pricing_rules ADD COLUMN sku_id VARCHAR(100);
          END IF;
        END$$;
        """
    )


def downgrade():
    op.execute(
        """
        ALTER TABLE IF EXISTS pricing_rules DROP COLUMN IF EXISTS sku_id;
        ALTER TABLE IF EXISTS pricing_rules DROP COLUMN IF EXISTS platform;
        """
    )


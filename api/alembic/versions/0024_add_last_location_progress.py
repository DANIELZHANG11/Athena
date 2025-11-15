"""
Add last_location column to reading_progress

Revision ID: 0024_progress_last_location
Revises: 0023_reading_daily
Create Date: 2025-11-15
"""

from alembic import op

revision = '0024_progress_last_location'
down_revision = '0023_reading_daily'
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        ALTER TABLE IF EXISTS reading_progress
          ADD COLUMN IF NOT EXISTS last_location JSONB;
        """
    )

def downgrade():
    op.execute(
        """
        ALTER TABLE IF EXISTS reading_progress
          DROP COLUMN IF EXISTS last_location;
        """
    )
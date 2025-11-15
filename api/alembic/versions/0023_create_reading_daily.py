"""
Create reading_daily table

Revision ID: 0023_reading_daily
Revises: 0022_books_etag
Create Date: 2025-11-15
"""

from alembic import op

revision = '0023_reading_daily'
down_revision = '0022_books_etag'
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS reading_daily (
          user_id UUID NOT NULL,
          day DATE NOT NULL,
          total_ms BIGINT NOT NULL DEFAULT 0,
          PRIMARY KEY(user_id, day)
        );
        """
    )

def downgrade():
    op.execute(
        """
        DROP TABLE IF EXISTS reading_daily;
        """
    )
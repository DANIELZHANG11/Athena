"""
Add books source_etag column

Revision ID: 0022_books_etag
Revises: 0021_books_cols
Create Date: 2025-11-15
"""

from alembic import op

revision = '0022_books_etag'
down_revision = '0003_books'
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        ALTER TABLE IF EXISTS books
          ADD COLUMN IF NOT EXISTS source_etag TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_books_user_etag ON books(user_id, source_etag) WHERE source_etag IS NOT NULL;
        """
    )

def downgrade():
    op.execute(
        """
        DROP INDEX IF EXISTS uniq_books_user_etag;
        ALTER TABLE IF EXISTS books
          DROP COLUMN IF EXISTS source_etag;
        """
    )
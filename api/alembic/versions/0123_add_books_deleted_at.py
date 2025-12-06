"""
Add deleted_at column to books table for soft delete support.

This column is required by the application code for:
1. Soft deletion of books (marking as deleted without removing data)
2. Filtering active vs deleted books in queries
3. Deduplication logic that needs to check deleted status

Revision ID: 0123
Revises: 0122
Create Date: 2025-12-06
"""

from alembic import op

revision = "0123"
down_revision = "0122"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        DO $$
        BEGIN
          -- Add deleted_at column for soft delete support
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='books' AND column_name='deleted_at'
          ) THEN
            ALTER TABLE books ADD COLUMN deleted_at TIMESTAMPTZ;
            COMMENT ON COLUMN books.deleted_at IS 'Soft delete timestamp, NULL means active';
          END IF;
        END$$;
        """
    )


def downgrade():
    op.execute(
        """
        ALTER TABLE books DROP COLUMN IF EXISTS deleted_at;
        """
    )

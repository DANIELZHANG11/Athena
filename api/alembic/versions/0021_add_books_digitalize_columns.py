"""
Add books digitalize columns

Revision ID: 0021_add_books_digitalize_columns
Revises: 0020_ai_conversations
Create Date: 2025-11-15
"""

from alembic import op

revision = '0021_books_cols'
down_revision = '0020_ai_conversations'
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        ALTER TABLE IF EXISTS books
          ADD COLUMN IF NOT EXISTS is_digitalized BOOLEAN,
          ADD COLUMN IF NOT EXISTS initial_digitalization_confidence NUMERIC,
          ADD COLUMN IF NOT EXISTS converted_epub_key TEXT,
          ADD COLUMN IF NOT EXISTS digitalize_report_key TEXT;
        """
    )

def downgrade():
    op.execute(
        """
        ALTER TABLE IF EXISTS books
          DROP COLUMN IF EXISTS is_digitalized,
          DROP COLUMN IF EXISTS initial_digitalization_confidence,
          DROP COLUMN IF EXISTS converted_epub_key,
          DROP COLUMN IF EXISTS digitalize_report_key;
        """
    )
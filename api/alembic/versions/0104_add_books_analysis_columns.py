"""
Add analysis columns to books

Revision ID: 0104_add_books_analysis_columns
Revises: 0103_add_runtime_tables
Create Date: 2025-11-19
"""

from alembic import op

revision = '0104_add_books_analysis_columns'
down_revision = '0103_add_runtime_tables'
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
          DROP COLUMN IF EXISTS digitalize_report_key,
          DROP COLUMN IF EXISTS converted_epub_key,
          DROP COLUMN IF EXISTS initial_digitalization_confidence,
          DROP COLUMN IF EXISTS is_digitalized;
        """
    )
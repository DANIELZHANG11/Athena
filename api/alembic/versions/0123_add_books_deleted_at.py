"""
Add missing columns to books table for soft delete and OCR result support.

This migration adds columns required by the application code for:
1. deleted_at - Soft deletion of books (marking as deleted without removing data)
2. ocr_result_key - Storage key for OCR processing results

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
          
          -- Add ocr_result_key column for OCR result storage
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='books' AND column_name='ocr_result_key'
          ) THEN
            ALTER TABLE books ADD COLUMN ocr_result_key TEXT;
            COMMENT ON COLUMN books.ocr_result_key IS 'MinIO key for OCR result JSON file';
          END IF;
        END$$;
        """
    )


def downgrade():
    op.execute(
        """
        ALTER TABLE books DROP COLUMN IF EXISTS deleted_at;
        ALTER TABLE books DROP COLUMN IF EXISTS ocr_result_key;
        """
    )

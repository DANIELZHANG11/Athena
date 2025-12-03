"""
Add content_sha256 column to books table for global file deduplication.

This allows the system to:
1. Detect if the exact same file content has been uploaded by ANY user
2. Share storage for identical files (reference counting)
3. Save significant S3 storage costs

Revision ID: 0122
Revises: 0121
Create Date: 2025-12-03
"""

from alembic import op

revision = "0122"
down_revision = "0121"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        DO $$
        BEGIN
          -- Add content_sha256 column for global deduplication
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='books' AND column_name='content_sha256'
          ) THEN
            ALTER TABLE books ADD COLUMN content_sha256 VARCHAR(64);
            COMMENT ON COLUMN books.content_sha256 IS 'SHA-256 hash of file content for global deduplication';
          END IF;
          
          -- Add reference_count for shared storage management
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='books' AND column_name='storage_ref_count'
          ) THEN
            ALTER TABLE books ADD COLUMN storage_ref_count INTEGER DEFAULT 1;
            COMMENT ON COLUMN books.storage_ref_count IS 'Reference count for shared minio_key, decremented on delete';
          END IF;
          
          -- Add canonical_book_id to link duplicates to original
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='books' AND column_name='canonical_book_id'
          ) THEN
            ALTER TABLE books ADD COLUMN canonical_book_id UUID;
            COMMENT ON COLUMN books.canonical_book_id IS 'Points to the original book record if this is a deduplicated reference';
          END IF;
        END$$;
        
        -- Create index for fast SHA256 lookup (partial index for non-null only)
        CREATE INDEX IF NOT EXISTS idx_books_content_sha256 
        ON books(content_sha256) 
        WHERE content_sha256 IS NOT NULL;
        """
    )


def downgrade():
    op.execute(
        """
        DROP INDEX IF EXISTS idx_books_content_sha256;
        ALTER TABLE IF EXISTS books DROP COLUMN IF EXISTS content_sha256;
        ALTER TABLE IF EXISTS books DROP COLUMN IF EXISTS storage_ref_count;
        ALTER TABLE IF EXISTS books DROP COLUMN IF EXISTS canonical_book_id;
        """
    )

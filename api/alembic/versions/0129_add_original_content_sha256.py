"""
Add original_content_sha256 column to books table for dual SHA256 deduplication.

This enables cross-format deduplication:
- original_content_sha256: SHA256 of the ORIGINAL uploaded file (e.g., MOBI)
- content_sha256: SHA256 of the CURRENT file in storage (e.g., converted EPUB)

When a user uploads a MOBI file, we can now:
1. Check original_content_sha256 to find existing records
2. If found and conversion_status='completed', return the converted EPUB (instant upload)
"""
from alembic import op

revision = "0129"
down_revision = "0128"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        DO $$
        BEGIN
          -- Add original_content_sha256 column for original file hash
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='books' AND column_name='original_content_sha256'
          ) THEN
            ALTER TABLE books ADD COLUMN original_content_sha256 VARCHAR(64);
            COMMENT ON COLUMN books.original_content_sha256 IS 'SHA-256 hash of the ORIGINAL uploaded file (before conversion)';
          END IF;
        END;
        $$
        """
    )
    
    # Create index for original_content_sha256
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_books_original_sha256 
        ON books(original_content_sha256) 
        WHERE original_content_sha256 IS NOT NULL;
        """
    )
    
    # Migrate existing data: copy content_sha256 to original_content_sha256
    # This handles books that were uploaded before this migration
    op.execute(
        """
        UPDATE books 
        SET original_content_sha256 = content_sha256 
        WHERE content_sha256 IS NOT NULL 
          AND original_content_sha256 IS NULL;
        """
    )


def downgrade():
    op.execute(
        """
        DROP INDEX IF EXISTS idx_books_original_sha256;
        ALTER TABLE IF EXISTS books DROP COLUMN IF EXISTS original_content_sha256;
        """
    )

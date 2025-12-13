"""
Add V9.1 columns to ocr_jobs table

Revision ID: d0a6b2c4e5f7
Revises: c9f5a1b4d3e6
Create Date: 2025-11-23
"""

from alembic import op

revision = "d0a6b2c4e5f7"
down_revision = "c9f5a1b4d3e6"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        DO $$
        BEGIN
          -- Add book_id column
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='ocr_jobs' AND column_name='book_id'
          ) THEN
            ALTER TABLE ocr_jobs ADD COLUMN book_id UUID;
          END IF;
          
          -- Add user_id column  
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='ocr_jobs' AND column_name='user_id'
          ) THEN
            ALTER TABLE ocr_jobs ADD COLUMN user_id UUID;
          END IF;
          
          -- Add page_count column
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='ocr_jobs' AND column_name='page_count'
          ) THEN
            ALTER TABLE ocr_jobs ADD COLUMN page_count INTEGER DEFAULT 0;
          END IF;
          
          -- Add deduction_strategy column
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='ocr_jobs' AND column_name='deduction_strategy'
          ) THEN
            ALTER TABLE ocr_jobs ADD COLUMN deduction_strategy VARCHAR(50);
          END IF;
          
          -- Add deduction_amount column
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='ocr_jobs' AND column_name='deduction_amount'
          ) THEN
            ALTER TABLE ocr_jobs ADD COLUMN deduction_amount INTEGER DEFAULT 0;
          END IF;
        END$$;
        """
    )


def downgrade():
    op.execute(
        """
        ALTER TABLE IF EXISTS ocr_jobs DROP COLUMN IF EXISTS deduction_amount;
        ALTER TABLE IF EXISTS ocr_jobs DROP COLUMN IF EXISTS deduction_strategy;
        ALTER TABLE IF EXISTS ocr_jobs DROP COLUMN IF EXISTS page_count;
        ALTER TABLE IF EXISTS ocr_jobs DROP COLUMN IF EXISTS user_id;
        ALTER TABLE IF EXISTS ocr_jobs DROP COLUMN IF EXISTS book_id;
        """
    )


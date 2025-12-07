"""add conversion_status column to books table

Revision ID: 0124
Revises: 0123
Create Date: 2025-12-06

用于追踪非 EPUB/PDF 格式书籍的 Calibre 转换状态：
- null: 不需要转换（原生 EPUB/PDF）
- 'pending': 等待转换
- 'processing': 正在转换
- 'completed': 转换完成
- 'failed': 转换失败
"""

from alembic import op

revision = "0124"
down_revision = "0123"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE books 
        ADD COLUMN IF NOT EXISTS conversion_status VARCHAR(20) DEFAULT NULL;
        
        COMMENT ON COLUMN books.conversion_status IS 'Calibre 转换状态: null/pending/processing/completed/failed';
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE books DROP COLUMN IF EXISTS conversion_status;
    """)

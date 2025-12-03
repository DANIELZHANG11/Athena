"""Add OCR status fields to books table (User-triggered OCR)

Revision ID: 0118
Revises: 0117
Create Date: 2025-12-03

This migration adds OCR processing status fields to support user-triggered
OCR service (not automatic).

Design Principles:
- OCR is a paid/quota service, triggered by user action
- Vector indexing is free, auto-triggered for text-based books
- Image-based PDFs require OCR before vector indexing

OCR Status Flow:
NULL (text-based, no need) -> 
'pending' (user requested, queued) -> 
'processing' (worker picked up) -> 
'completed' or 'failed'

Fields:
- ocr_status: Current OCR processing status
- ocr_requested_at: When user requested OCR
- vector_indexed_at: When vector index was generated (for all book types)
"""
from alembic import op
import sqlalchemy as sa


revision = '0118'
down_revision = '0117'
branch_labels = None
depends_on = None


def upgrade():
    # Add OCR status field
    op.add_column(
        'books',
        sa.Column('ocr_status', sa.String(20), nullable=True,
                  comment='OCR 处理状态: NULL(文字型/无需), pending, processing, completed, failed')
    )
    
    # Add OCR request timestamp
    op.add_column(
        'books',
        sa.Column('ocr_requested_at', sa.TIMESTAMP(timezone=True), nullable=True,
                  comment='用户请求 OCR 的时间')
    )
    
    # Add vector index completion timestamp
    op.add_column(
        'books',
        sa.Column('vector_indexed_at', sa.TIMESTAMP(timezone=True), nullable=True,
                  comment='向量索引生成完成时间')
    )
    
    # Partial index for querying pending/processing OCR jobs
    # Query pattern: "get all books with pending OCR for user X"
    op.create_index(
        'idx_books_ocr_pending',
        'books',
        ['user_id', 'ocr_status'],
        postgresql_where=sa.text("ocr_status IN ('pending', 'processing')")
    )
    
    # Add check constraint for ocr_status values
    op.execute("""
        ALTER TABLE books ADD CONSTRAINT chk_books_ocr_status 
        CHECK (ocr_status IS NULL OR ocr_status IN ('pending', 'processing', 'completed', 'failed'))
    """)


def downgrade():
    # Drop check constraint
    op.execute("ALTER TABLE books DROP CONSTRAINT IF EXISTS chk_books_ocr_status")
    
    # Drop index
    op.drop_index('idx_books_ocr_pending', table_name='books')
    
    # Drop columns
    op.drop_column('books', 'vector_indexed_at')
    op.drop_column('books', 'ocr_requested_at')
    op.drop_column('books', 'ocr_status')

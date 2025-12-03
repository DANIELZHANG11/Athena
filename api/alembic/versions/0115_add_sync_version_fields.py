"""Add sync version fields to reading_progress for ADR-006 Smart Heartbeat Sync

Revision ID: 0115
Revises: 0114
Create Date: 2025-12-03

This migration adds version tracking fields to reading_progress table
to support the Smart Heartbeat Sync protocol (ADR-006).

Fields:
- ocr_version: Server-authoritative OCR data version (sha256:xxx format)
- metadata_version: Server-authoritative book metadata version
- vector_index_version: Server-authoritative vector index version
- last_sync_at: Last time client performed a full sync
"""
from alembic import op
import sqlalchemy as sa


revision = '0115'
down_revision = '0114'
branch_labels = None
depends_on = None


def upgrade():
    # Add version tracking columns to reading_progress
    op.add_column(
        'reading_progress',
        sa.Column('ocr_version', sa.String(64), nullable=True,
                  comment='OCR 数据版本（服务端权威），格式: sha256:xxx')
    )
    op.add_column(
        'reading_progress',
        sa.Column('metadata_version', sa.String(64), nullable=True,
                  comment='书籍元数据版本（服务端权威），格式: sha256:xxx')
    )
    op.add_column(
        'reading_progress',
        sa.Column('vector_index_version', sa.String(64), nullable=True,
                  comment='向量索引版本（服务端权威），格式: sha256:xxx')
    )
    op.add_column(
        'reading_progress',
        sa.Column('last_sync_at', sa.TIMESTAMP(timezone=True), nullable=True,
                  comment='客户端最后完整同步时间，用于判断是否需要全量对账')
    )


def downgrade():
    op.drop_column('reading_progress', 'last_sync_at')
    op.drop_column('reading_progress', 'vector_index_version')
    op.drop_column('reading_progress', 'metadata_version')
    op.drop_column('reading_progress', 'ocr_version')

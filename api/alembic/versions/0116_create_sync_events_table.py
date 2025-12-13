"""Create sync_events table for server push queue (ADR-006)

Revision ID: 0116
Revises: 0115
Create Date: 2025-12-03

This migration creates the sync_events table for storing pending server events
that need to be pushed to clients via WebSocket or heartbeat response.

Event types:
- ocr_ready: OCR processing completed
- metadata_updated: Book metadata changed
- vector_ready: Vector index generation completed
- cover_updated: Book cover updated
- ocr_analysis_done: Initial book analysis completed

TTL Strategy (implemented in Celery Beat task):
- Delivered events: Delete after 7 days
- Undelivered events: Delete after 30 days, mark user for full sync
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = '0116'
down_revision = '0115'
branch_labels = None
depends_on = None


def upgrade():
    # Create sync_events table
    op.create_table(
        'sync_events',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('user_id', UUID(as_uuid=True), nullable=False),
        sa.Column('book_id', UUID(as_uuid=True), nullable=False),
        sa.Column('event_type', sa.String(32), nullable=False, 
                  comment='事件类型: ocr_ready, metadata_updated, vector_ready, cover_updated, ocr_analysis_done'),
        sa.Column('payload', JSONB, nullable=True,
                  comment='事件详情，如版本号、文件大小等'),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('delivered_at', sa.TIMESTAMP(timezone=True), nullable=True,
                  comment='事件投递时间，用于 TTL 清理'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='CASCADE'),
    )
    
    # Index for querying user's pending (undelivered) events
    # This is the primary query pattern: "get all undelivered events for user X"
    op.create_index(
        'idx_sync_events_user_pending',
        'sync_events',
        ['user_id', 'created_at'],
        postgresql_where=sa.text('delivered_at IS NULL')
    )
    
    # Index for TTL cleanup of delivered events
    # Query pattern: "delete all delivered events older than 7 days"
    op.create_index(
        'idx_sync_events_delivered',
        'sync_events',
        ['delivered_at'],
        postgresql_where=sa.text('delivered_at IS NOT NULL')
    )
    
    # Index for TTL cleanup of undelivered events
    # Query pattern: "find users with undelivered events older than 30 days"
    op.create_index(
        'idx_sync_events_created',
        'sync_events',
        ['created_at'],
        postgresql_where=sa.text('delivered_at IS NULL')
    )

    # Add comment to table
    op.execute("COMMENT ON TABLE sync_events IS '服务端待推送事件队列，用于 WebSocket/心跳同步 (ADR-006)'")


def downgrade():
    op.drop_index('idx_sync_events_created', table_name='sync_events')
    op.drop_index('idx_sync_events_delivered', table_name='sync_events')
    op.drop_index('idx_sync_events_user_pending', table_name='sync_events')
    op.drop_table('sync_events')

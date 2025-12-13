"""Add conflict copy fields to notes and highlights (ADR-006 CRDT)

Revision ID: 0117
Revises: 0116
Create Date: 2025-12-03

This migration adds fields to support the Conflict Copy strategy for
multi-device note/highlight synchronization:

- device_id: The device that created/modified the note/highlight
- conflict_of: If this is a conflict copy, points to the original note/highlight

Conflict Resolution Strategy:
1. When multiple devices modify the same note, server detects version mismatch
2. Instead of LWW (Last-Write-Wins), server creates a "conflict copy"
3. Frontend displays conflict marker, user can view both versions
4. User manually chooses to keep one or merge, then deletes conflict copy
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = '0117'
down_revision = '0116'
branch_labels = None
depends_on = None


def upgrade():
    # ----- NOTES table changes -----
    op.add_column(
        'notes',
        sa.Column('device_id', sa.String(64), nullable=True,
                  comment='创建/修改该笔记的设备 ID，用于冲突检测')
    )
    op.add_column(
        'notes',
        sa.Column('conflict_of', UUID(as_uuid=True), nullable=True,
                  comment='如果是冲突副本，指向原始笔记 ID')
    )
    
    # Foreign key for conflict_of (self-referencing)
    op.create_foreign_key(
        'fk_notes_conflict_of',
        'notes',
        'notes',
        ['conflict_of'],
        ['id'],
        ondelete='CASCADE'
    )
    
    # Partial index for querying conflict copies efficiently
    # Query pattern: "get all conflict copies for a given original note"
    op.create_index(
        'idx_notes_conflict',
        'notes',
        ['conflict_of'],
        postgresql_where=sa.text('conflict_of IS NOT NULL')
    )
    
    # ----- HIGHLIGHTS table changes -----
    op.add_column(
        'highlights',
        sa.Column('device_id', sa.String(64), nullable=True,
                  comment='创建/修改该高亮的设备 ID，用于冲突检测')
    )
    op.add_column(
        'highlights',
        sa.Column('conflict_of', UUID(as_uuid=True), nullable=True,
                  comment='如果是冲突副本，指向原始高亮 ID')
    )
    
    # Foreign key for conflict_of (self-referencing)
    op.create_foreign_key(
        'fk_highlights_conflict_of',
        'highlights',
        'highlights',
        ['conflict_of'],
        ['id'],
        ondelete='CASCADE'
    )
    
    # Partial index for querying conflict copies efficiently
    op.create_index(
        'idx_highlights_conflict',
        'highlights',
        ['conflict_of'],
        postgresql_where=sa.text('conflict_of IS NOT NULL')
    )


def downgrade():
    # Drop highlights changes
    op.drop_index('idx_highlights_conflict', table_name='highlights')
    op.drop_constraint('fk_highlights_conflict_of', 'highlights', type_='foreignkey')
    op.drop_column('highlights', 'conflict_of')
    op.drop_column('highlights', 'device_id')
    
    # Drop notes changes
    op.drop_index('idx_notes_conflict', table_name='notes')
    op.drop_constraint('fk_notes_conflict_of', 'notes', type_='foreignkey')
    op.drop_column('notes', 'conflict_of')
    op.drop_column('notes', 'device_id')

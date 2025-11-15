"""
Create doc_events and doc_snapshots tables

Revision ID: 0028_doc_events_snapshots
Revises: 0027_docs_conflicts_drafts
Create Date: 2025-11-15
"""

from alembic import op

revision = '0028_doc_events_snapshots'
down_revision = '0027_docs_conflicts_drafts'
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS doc_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          doc_id TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS doc_snapshots (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          doc_id TEXT NOT NULL,
          snapshot TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )

def downgrade():
    op.execute(
        """
        DROP TABLE IF EXISTS doc_snapshots;
        DROP TABLE IF EXISTS doc_events;
        """
    )
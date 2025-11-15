"""
Create doc_conflicts and doc_drafts

Revision ID: 0027_docs_conflicts_drafts
Revises: 0026_wallet_columns
Create Date: 2025-11-15
"""

from alembic import op

revision = '0027_docs_conflicts_drafts'
down_revision = '0026_wallet_columns'
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS doc_conflicts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          doc_id TEXT NOT NULL,
          event_id UUID NULL,
          base_version BIGINT NOT NULL,
          actual_version BIGINT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS doc_drafts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          doc_id TEXT NOT NULL,
          snapshot TEXT NOT NULL,
          resolved BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )

def downgrade():
    op.execute(
        """
        DROP TABLE IF EXISTS doc_drafts;
        DROP TABLE IF EXISTS doc_conflicts;
        """
    )
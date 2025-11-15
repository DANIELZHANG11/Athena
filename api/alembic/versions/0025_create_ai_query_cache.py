"""
Create ai_query_cache table

Revision ID: 0025_ai_query_cache
Revises: 0024_progress_last_location
Create Date: 2025-11-15
"""

from alembic import op

revision = '0025_ai_query_cache'
down_revision = '0024_progress_last_location'
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_query_cache (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          owner_id UUID NOT NULL,
          conversation_id UUID NULL,
          query_hash TEXT NOT NULL,
          prompt TEXT NOT NULL,
          response TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_ai_cache_owner_hash ON ai_query_cache(owner_id, query_hash);
        """
    )

def downgrade():
    op.execute(
        """
        DROP INDEX IF EXISTS uniq_ai_cache_owner_hash;
        DROP TABLE IF EXISTS ai_query_cache;
        """
    )
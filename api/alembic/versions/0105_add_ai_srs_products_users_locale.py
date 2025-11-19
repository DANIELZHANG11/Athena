"""
Add AI/SRS/credit_products tables and users locale columns

Revision ID: 0105_add_ai_srs_products_users_locale
Revises: 0104_add_books_analysis_columns
Create Date: 2025-11-19
"""

from alembic import op

revision = '0105_add_ai_srs_products_users_locale'
down_revision = '0104_add_books_analysis_columns'
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_conversations (
          id UUID PRIMARY KEY,
          owner_id UUID NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS ai_messages (
          id UUID PRIMARY KEY,
          conversation_id UUID NOT NULL REFERENCES ai_conversations(id),
          owner_id UUID NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS ai_query_cache (
          owner_id UUID NOT NULL,
          conversation_id UUID,
          query_hash TEXT NOT NULL,
          prompt TEXT,
          response TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY(owner_id, query_hash)
        );

        CREATE TABLE IF NOT EXISTS ai_conversation_contexts (
          conversation_id UUID PRIMARY KEY REFERENCES ai_conversations(id),
          owner_id UUID NOT NULL,
          mode TEXT,
          book_ids JSONB,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        ALTER TABLE IF EXISTS users
          ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'zh-CN',
          ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai';

        CREATE TABLE IF NOT EXISTS srs_cards (
          id UUID PRIMARY KEY,
          owner_id UUID NOT NULL,
          highlight_id UUID NOT NULL,
          question TEXT NOT NULL,
          answer TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE(highlight_id)
        );

        CREATE TABLE IF NOT EXISTS srs_reviews (
          id UUID PRIMARY KEY,
          owner_id UUID NOT NULL,
          card_id UUID NOT NULL REFERENCES srs_cards(id),
          ease_factor NUMERIC NOT NULL DEFAULT 2.5,
          repetitions INTEGER NOT NULL DEFAULT 0,
          interval_days INTEGER NOT NULL DEFAULT 1,
          last_grade INTEGER,
          next_review_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_srs_reviews_next ON srs_reviews(owner_id, next_review_at);

        CREATE TABLE IF NOT EXISTS credit_products (
          id UUID PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          credits INTEGER NOT NULL,
          amount_minor INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'CNY',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )

def downgrade():
    op.execute(
        """
        DROP TABLE IF EXISTS credit_products;
        DROP INDEX IF EXISTS idx_srs_reviews_next;
        DROP TABLE IF EXISTS srs_reviews;
        DROP TABLE IF EXISTS srs_cards;
        DROP TABLE IF EXISTS ai_conversation_contexts;
        DROP TABLE IF EXISTS ai_query_cache;
        DROP TABLE IF EXISTS ai_messages;
        DROP TABLE IF EXISTS ai_conversations;
        ALTER TABLE IF EXISTS users
          DROP COLUMN IF EXISTS timezone,
          DROP COLUMN IF EXISTS language;
        """
    )
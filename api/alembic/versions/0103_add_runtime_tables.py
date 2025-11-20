"""
Add runtime tables moved from app code

Revision ID: 0103_add_runtime_tables
Revises: 0102_ext_id_payment_sessions
Create Date: 2025-11-19
"""

from alembic import op

revision = "0103_add_runtime_tables"
down_revision = "0102_ext_id_payment_sessions"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          display_name TEXT NOT NULL DEFAULT '',
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          membership_tier TEXT NOT NULL DEFAULT 'FREE',
          version INTEGER NOT NULL DEFAULT 1,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS user_sessions (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id),
          revoked BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS translations (
          id UUID PRIMARY KEY,
          namespace TEXT NOT NULL,
          key TEXT NOT NULL,
          lang TEXT NOT NULL,
          value JSONB NOT NULL,
          deleted_at TIMESTAMPTZ,
          version INTEGER NOT NULL DEFAULT 1,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE(namespace, key, lang)
        );

        CREATE TABLE IF NOT EXISTS feature_flags (
          id UUID PRIMARY KEY,
          key TEXT UNIQUE NOT NULL,
          is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS prompt_templates (
          id UUID PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          content TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS reading_sessions (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL,
          book_id UUID NOT NULL,
          device_id TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          total_ms BIGINT NOT NULL DEFAULT 0,
          last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS reading_daily (
          user_id UUID NOT NULL,
          day DATE NOT NULL,
          total_ms BIGINT NOT NULL DEFAULT 0,
          PRIMARY KEY(user_id, day)
        );

        CREATE TABLE IF NOT EXISTS reading_progress (
          user_id UUID NOT NULL,
          book_id UUID NOT NULL,
          progress NUMERIC NOT NULL DEFAULT 0,
          last_location JSONB,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY(user_id, book_id)
        );

        CREATE TABLE IF NOT EXISTS doc_events (
          id UUID PRIMARY KEY,
          doc_id TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS doc_snapshots (
          id UUID PRIMARY KEY,
          doc_id TEXT NOT NULL,
          snapshot TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS doc_conflicts (
          id UUID PRIMARY KEY,
          doc_id TEXT NOT NULL,
          base_version INTEGER NOT NULL,
          actual_version INTEGER NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS doc_drafts (
          id UUID PRIMARY KEY,
          doc_id TEXT NOT NULL,
          snapshot TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS free_quota_usage (
          owner_id UUID NOT NULL,
          service_type TEXT NOT NULL,
          used_units BIGINT NOT NULL DEFAULT 0,
          period_start DATE NOT NULL DEFAULT current_date,
          PRIMARY KEY(owner_id, service_type, period_start)
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
          id UUID PRIMARY KEY,
          owner_id UUID,
          actor_id UUID,
          action TEXT NOT NULL,
          entity TEXT,
          entity_id UUID,
          details JSONB,
          before JSONB,
          after JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_reading_sessions_user ON reading_sessions(user_id, last_heartbeat DESC);
        CREATE INDEX IF NOT EXISTS idx_reading_progress_user ON reading_progress(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_doc_events_doc ON doc_events(doc_id);
        """
    )


def downgrade():
    op.execute(
        """
        DROP INDEX IF EXISTS idx_doc_events_doc;
        DROP INDEX IF EXISTS idx_reading_progress_user;
        DROP INDEX IF EXISTS idx_reading_sessions_user;

        DROP TABLE IF EXISTS free_quota_usage;
        DROP TABLE IF EXISTS audit_logs;
        DROP TABLE IF EXISTS doc_drafts;
        DROP TABLE IF EXISTS doc_conflicts;
        DROP TABLE IF EXISTS doc_snapshots;
        DROP TABLE IF EXISTS doc_events;
        DROP TABLE IF EXISTS reading_progress;
        DROP TABLE IF EXISTS reading_daily;
        DROP TABLE IF EXISTS reading_sessions;
        DROP TABLE IF EXISTS prompt_templates;
        DROP TABLE IF EXISTS feature_flags;
        DROP TABLE IF EXISTS translations;
        DROP TABLE IF EXISTS user_sessions;
        DROP TABLE IF EXISTS users;
        """
    )

"""
Squash initial migrations into a single baseline

Revision ID: 0100_squash_baseline
Revises: None
Create Date: 2025-11-16
"""

from alembic import op

revision = '0100_squash_baseline'
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        -- Core tables for Athena baseline

        CREATE TABLE IF NOT EXISTS shelves (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            version INT NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS books (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            language TEXT,
            original_format TEXT,
            minio_key TEXT NOT NULL,
            size BIGINT,
            cover_image_key TEXT,
            version INT NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS shelf_items (
            shelf_id UUID NOT NULL,
            book_id UUID NOT NULL,
            position INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (shelf_id, book_id)
        );

        CREATE TABLE IF NOT EXISTS conversion_jobs (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            book_id UUID NOT NULL,
            source_key TEXT NOT NULL,
            target_format TEXT NOT NULL,
            output_key TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            error TEXT
        );

        CREATE TABLE IF NOT EXISTS payment_sessions (
            id UUID PRIMARY KEY,
            owner_id UUID NOT NULL,
            gateway TEXT NOT NULL,
            amount INT NOT NULL,
            currency TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            return_url TEXT,
            cancel_url TEXT,
            metadata JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS payment_webhook_events (
            id TEXT PRIMARY KEY,
            gateway TEXT NOT NULL,
            session_id UUID,
            payload JSONB,
            processed BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS credit_accounts (
            owner_id UUID PRIMARY KEY,
            balance BIGINT NOT NULL DEFAULT 0,
            currency TEXT,
            wallet_amount NUMERIC NOT NULL DEFAULT 0,
            wallet_currency TEXT NOT NULL DEFAULT 'CNY',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS credit_ledger (
            id UUID PRIMARY KEY,
            owner_id UUID NOT NULL,
            amount BIGINT NOT NULL,
            currency TEXT NOT NULL,
            reason TEXT,
            related_id UUID,
            direction TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS ocr_jobs (
            id UUID PRIMARY KEY,
            owner_id UUID NOT NULL,
            source_key TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'uploading',
            result_text TEXT,
            error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS system_settings (
            id UUID PRIMARY KEY,
            key TEXT UNIQUE NOT NULL,
            value JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS ai_models (
            id UUID PRIMARY KEY,
            provider TEXT NOT NULL,
            model_id TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        -- Useful indexes
        CREATE INDEX IF NOT EXISTS idx_shelves_user_updated ON shelves(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_books_user_updated ON books(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_shelf_items_shelf ON shelf_items(shelf_id);
        CREATE INDEX IF NOT EXISTS idx_conversion_jobs_user_status ON conversion_jobs(user_id, status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_credit_ledger_owner_created ON credit_ledger(owner_id, created_at DESC);
        """
    )

def downgrade():
    op.execute(
        """
        DROP INDEX IF EXISTS idx_credit_ledger_owner_created;
        DROP INDEX IF EXISTS idx_conversion_jobs_user_status;
        DROP INDEX IF EXISTS idx_shelf_items_shelf;
        DROP INDEX IF EXISTS idx_books_user_updated;
        DROP INDEX IF EXISTS idx_shelves_user_updated;

        DROP TABLE IF EXISTS ai_models;
        DROP TABLE IF EXISTS system_settings;
        DROP TABLE IF EXISTS ocr_jobs;
        DROP TABLE IF EXISTS credit_ledger;
        DROP TABLE IF EXISTS credit_accounts;
        DROP TABLE IF EXISTS payment_webhook_events;
        DROP TABLE IF EXISTS payment_sessions;
        DROP TABLE IF EXISTS conversion_jobs;
        DROP TABLE IF EXISTS shelf_items;
        DROP TABLE IF EXISTS books;
        DROP TABLE IF EXISTS shelves;
        """
    )
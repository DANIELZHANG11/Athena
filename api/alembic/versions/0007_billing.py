from alembic import op

revision = "0007_billing"
down_revision = "0006_search_tsv"
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS credit_accounts (
            owner_id UUID PRIMARY KEY,
            balance BIGINT NOT NULL DEFAULT 0,
            currency TEXT NOT NULL DEFAULT 'CNY',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS credit_ledger (
            id UUID PRIMARY KEY,
            owner_id UUID NOT NULL,
            amount BIGINT NOT NULL,
            currency TEXT NOT NULL DEFAULT 'CNY',
            reason TEXT,
            related_id UUID,
            direction TEXT NOT NULL CHECK (direction IN ('credit','debit')),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS payment_sessions (
            id UUID PRIMARY KEY,
            owner_id UUID NOT NULL,
            gateway TEXT NOT NULL,
            amount BIGINT NOT NULL,
            currency TEXT NOT NULL DEFAULT 'CNY',
            status TEXT NOT NULL DEFAULT 'pending',
            external_id TEXT,
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
            owner_id UUID,
            payload JSONB,
            processed BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_ledger_owner_created ON credit_ledger(owner_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sessions_owner_status ON payment_sessions(owner_id, status, created_at DESC);

        ALTER TABLE credit_accounts ENABLE ROW LEVEL SECURITY;
        ALTER TABLE credit_accounts FORCE ROW LEVEL SECURITY;
        ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
        ALTER TABLE credit_ledger FORCE ROW LEVEL SECURITY;
        ALTER TABLE payment_sessions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE payment_sessions FORCE ROW LEVEL SECURITY;
        ALTER TABLE payment_webhook_events ENABLE ROW LEVEL SECURITY;
        ALTER TABLE payment_webhook_events FORCE ROW LEVEL SECURITY;

        CREATE POLICY credit_accounts_owner ON credit_accounts FOR ALL
            USING (owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')
            WITH CHECK (owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin');

        CREATE POLICY credit_ledger_owner ON credit_ledger FOR ALL
            USING (owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')
            WITH CHECK (owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin');

        CREATE POLICY payment_sessions_owner ON payment_sessions FOR ALL
            USING (owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')
            WITH CHECK (owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin');

        CREATE POLICY payment_events_admin ON payment_webhook_events FOR ALL
            USING (current_setting('app.role', true) = 'admin')
            WITH CHECK (current_setting('app.role', true) = 'admin');
        """
    )

def downgrade():
    op.execute(
        """
        DROP POLICY IF EXISTS payment_events_admin ON payment_webhook_events;
        DROP POLICY IF EXISTS payment_sessions_owner ON payment_sessions;
        DROP POLICY IF EXISTS credit_ledger_owner ON credit_ledger;
        DROP POLICY IF EXISTS credit_accounts_owner ON credit_accounts;

        ALTER TABLE payment_webhook_events DISABLE ROW LEVEL SECURITY;
        ALTER TABLE payment_sessions DISABLE ROW LEVEL SECURITY;
        ALTER TABLE credit_ledger DISABLE ROW LEVEL SECURITY;
        ALTER TABLE credit_accounts DISABLE ROW LEVEL SECURITY;

        DROP INDEX IF EXISTS idx_sessions_owner_status;
        DROP INDEX IF EXISTS idx_ledger_owner_created;

        DROP TABLE IF EXISTS payment_webhook_events;
        DROP TABLE IF EXISTS payment_sessions;
        DROP TABLE IF EXISTS credit_ledger;
        DROP TABLE IF EXISTS credit_accounts;
        """
    )
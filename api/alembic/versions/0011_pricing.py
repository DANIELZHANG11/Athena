from alembic import op

revision = "0011_pricing"
down_revision = "0010_yjs_snapshots"
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS regional_prices (
            id UUID PRIMARY KEY,
            plan_code TEXT NOT NULL,
            currency TEXT NOT NULL,
            period TEXT NOT NULL CHECK (period IN ('monthly','yearly','once')),
            amount_minor BIGINT NOT NULL,
            version INT NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE UNIQUE INDEX IF NOT EXISTS uq_regional_price ON regional_prices(plan_code, currency, period);
        CREATE INDEX IF NOT EXISTS idx_regional_price_updated ON regional_prices(updated_at DESC);

        ALTER TABLE regional_prices ENABLE ROW LEVEL SECURITY;
        ALTER TABLE regional_prices FORCE ROW LEVEL SECURITY;

        CREATE POLICY regional_prices_admin ON regional_prices FOR ALL
            USING (current_setting('app.role', true) = 'admin')
            WITH CHECK (current_setting('app.role', true) = 'admin');
        """
    )

def downgrade():
    op.execute(
        """
        DROP POLICY IF EXISTS regional_prices_admin ON regional_prices;
        ALTER TABLE regional_prices DISABLE ROW LEVEL SECURITY;
        DROP INDEX IF EXISTS idx_regional_price_updated;
        DROP INDEX IF EXISTS uq_regional_price;
        DROP TABLE IF EXISTS regional_prices;
        """
    )
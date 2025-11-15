from alembic import op

revision = "0012_ocr_srs"
down_revision = "0011_pricing"
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ocr_jobs (
            id UUID PRIMARY KEY,
            owner_id UUID NOT NULL,
            source_key TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            result_text TEXT,
            error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS srs_reviews (
            id UUID PRIMARY KEY,
            owner_id UUID NOT NULL,
            front TEXT NOT NULL,
            back TEXT NOT NULL,
            deck_name TEXT,
            ease_factor REAL NOT NULL DEFAULT 2.5,
            interval_days INT NOT NULL DEFAULT 1,
            repetitions INT NOT NULL DEFAULT 0,
            last_grade INT,
            next_review_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_ocr_owner_updated ON ocr_jobs(owner_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_srs_owner_next ON srs_reviews(owner_id, next_review_at);

        ALTER TABLE ocr_jobs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ocr_jobs FORCE ROW LEVEL SECURITY;
        ALTER TABLE srs_reviews ENABLE ROW LEVEL SECURITY;
        ALTER TABLE srs_reviews FORCE ROW LEVEL SECURITY;

        CREATE POLICY ocr_owner ON ocr_jobs FOR ALL
            USING (owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')
            WITH CHECK (owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin');

        CREATE POLICY srs_owner ON srs_reviews FOR ALL
            USING (owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')
            WITH CHECK (owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin');
        """
    )

def downgrade():
    op.execute(
        """
        DROP POLICY IF EXISTS srs_owner ON srs_reviews;
        DROP POLICY IF EXISTS ocr_owner ON ocr_jobs;
        ALTER TABLE srs_reviews DISABLE ROW LEVEL SECURITY;
        ALTER TABLE ocr_jobs DISABLE ROW LEVEL SECURITY;
        DROP INDEX IF EXISTS idx_srs_owner_next;
        DROP INDEX IF EXISTS idx_ocr_owner_updated;
        DROP TABLE IF EXISTS srs_reviews;
        DROP TABLE IF EXISTS ocr_jobs;
        """
    )
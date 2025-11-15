from alembic import op


revision = "0004_reader"
down_revision = "0003_books"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS reading_sessions (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            book_id UUID NOT NULL,
            device_id TEXT,
            started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
            total_ms BIGINT NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE
        );

        CREATE INDEX IF NOT EXISTS idx_reading_sessions_user_active ON reading_sessions(user_id, is_active);
        CREATE INDEX IF NOT EXISTS idx_reading_sessions_user_book ON reading_sessions(user_id, book_id);
        CREATE INDEX IF NOT EXISTS idx_reading_sessions_heartbeat ON reading_sessions(last_heartbeat DESC);

        ALTER TABLE reading_sessions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE reading_sessions FORCE ROW LEVEL SECURITY;

        CREATE POLICY reading_sessions_owner ON reading_sessions
            FOR ALL
            USING (
                user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin'
            )
            WITH CHECK (
                user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin'
            );
        """
    )


def downgrade():
    op.execute(
        """
        DROP POLICY IF EXISTS reading_sessions_owner ON reading_sessions;
        ALTER TABLE reading_sessions DISABLE ROW LEVEL SECURITY;
        DROP INDEX IF EXISTS idx_reading_sessions_heartbeat;
        DROP INDEX IF EXISTS idx_reading_sessions_user_book;
        DROP INDEX IF EXISTS idx_reading_sessions_user_active;
        DROP TABLE IF EXISTS reading_sessions;
        """
    )
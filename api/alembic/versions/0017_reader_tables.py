from alembic import op

revision = "0017_reader_tables"
down_revision = "0013_fix_columns"
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS reading_sessions (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL,
          book_id uuid NOT NULL,
          device_id text,
          total_ms int NOT NULL DEFAULT 0,
          is_active boolean NOT NULL DEFAULT TRUE,
          last_heartbeat timestamptz
        );
        CREATE INDEX IF NOT EXISTS idx_reading_sessions_user_last ON reading_sessions(user_id, last_heartbeat DESC);
        ALTER TABLE reading_sessions ENABLE ROW LEVEL SECURITY; ALTER TABLE reading_sessions FORCE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS reading_sessions_owner ON reading_sessions;
        CREATE POLICY reading_sessions_owner ON reading_sessions FOR ALL USING (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin') WITH CHECK (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin');

        CREATE TABLE IF NOT EXISTS reading_progress (
          user_id uuid NOT NULL,
          book_id uuid NOT NULL,
          progress numeric NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, book_id)
        );
        CREATE INDEX IF NOT EXISTS idx_reading_progress_user_updated ON reading_progress(user_id, updated_at DESC);
        ALTER TABLE reading_progress ENABLE ROW LEVEL SECURITY; ALTER TABLE reading_progress FORCE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS reading_progress_owner ON reading_progress;
        CREATE POLICY reading_progress_owner ON reading_progress FOR ALL USING (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin') WITH CHECK (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin');
        """
    )

def downgrade():
    op.execute(
        """
        DROP POLICY IF EXISTS reading_progress_owner ON reading_progress;
        DROP POLICY IF EXISTS reading_sessions_owner ON reading_sessions;
        ALTER TABLE reading_progress DISABLE ROW LEVEL SECURITY;
        ALTER TABLE reading_sessions DISABLE ROW LEVEL SECURITY;
        DROP INDEX IF EXISTS idx_reading_progress_user_updated;
        DROP INDEX IF EXISTS idx_reading_sessions_user_last;
        DROP TABLE IF EXISTS reading_progress;
        DROP TABLE IF EXISTS reading_sessions;
        """
    )
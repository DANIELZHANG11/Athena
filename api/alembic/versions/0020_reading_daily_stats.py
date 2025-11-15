from alembic import op

revision = "0020_reading_daily_stats"
down_revision = "0019_reader_location_column"
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS reading_daily (
          user_id uuid NOT NULL,
          day date NOT NULL,
          total_ms int NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, day)
        );
        ALTER TABLE reading_daily ENABLE ROW LEVEL SECURITY; ALTER TABLE reading_daily FORCE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS reading_daily_owner ON reading_daily;
        CREATE POLICY reading_daily_owner ON reading_daily FOR ALL USING (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin') WITH CHECK (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin');
        """
    )

def downgrade():
    op.execute(
        """
        DROP POLICY IF EXISTS reading_daily_owner ON reading_daily;
        ALTER TABLE reading_daily DISABLE ROW LEVEL SECURITY;
        DROP TABLE IF EXISTS reading_daily;
        """
    )
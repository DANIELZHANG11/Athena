from alembic import op

revision = "0002_auth"
down_revision = "0001_init"
branch_labels = None
depends_on = None

def upgrade():
    op.execute("CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY, email TEXT UNIQUE, display_name TEXT, is_active BOOLEAN DEFAULT TRUE, last_login_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), deleted_at TIMESTAMPTZ)")
    op.execute("ALTER TABLE users ENABLE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY users_owner ON users FOR ALL USING (id = current_setting('app.user_id')::uuid) WITH CHECK (id = current_setting('app.user_id')::uuid)")

def downgrade():
    op.execute("DROP POLICY IF EXISTS users_owner ON users")
    op.execute("DROP TABLE IF EXISTS users")
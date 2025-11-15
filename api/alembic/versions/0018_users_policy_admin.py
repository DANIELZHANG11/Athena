from alembic import op

revision = "0018_users_policy_admin"
down_revision = "0017_reader_tables"
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        DROP POLICY IF EXISTS users_owner ON users;
        CREATE POLICY users_owner ON users FOR ALL
        USING (id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')
        WITH CHECK (id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin');
        """
    )

def downgrade():
    op.execute(
        """
        DROP POLICY IF EXISTS users_owner ON users;
        CREATE POLICY users_owner ON users FOR ALL
        USING (id = current_setting('app.user_id')::uuid)
        WITH CHECK (id = current_setting('app.user_id')::uuid);
        """
    )
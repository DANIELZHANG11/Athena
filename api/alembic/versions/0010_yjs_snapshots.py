from alembic import op

revision = "0010_yjs_snapshots"
down_revision = "0009_admin_core"
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS note_versions (
            id UUID PRIMARY KEY,
            owner_id UUID NOT NULL,
            note_id UUID NOT NULL,
            version_number INT NOT NULL,
            update_data BYTEA,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE UNIQUE INDEX IF NOT EXISTS uq_note_versions_unique ON note_versions(owner_id, note_id, version_number);
        CREATE INDEX IF NOT EXISTS idx_note_versions_owner_note ON note_versions(owner_id, note_id, created_at DESC);

        ALTER TABLE note_versions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE note_versions FORCE ROW LEVEL SECURITY;

        CREATE POLICY note_versions_owner ON note_versions FOR ALL
            USING (owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')
            WITH CHECK (owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin');
        """
    )

def downgrade():
    op.execute(
        """
        DROP POLICY IF EXISTS note_versions_owner ON note_versions;
        ALTER TABLE note_versions DISABLE ROW LEVEL SECURITY;
        DROP INDEX IF EXISTS idx_note_versions_owner_note;
        DROP INDEX IF EXISTS uq_note_versions_unique;
        DROP TABLE IF EXISTS note_versions;
        """
    )
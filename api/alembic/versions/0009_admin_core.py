from alembic import op

revision = "0009_admin_core"
down_revision = "0008_tts_dict"
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        ALTER TABLE IF EXISTS translations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
        ALTER TABLE IF EXISTS translations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
        ALTER TABLE IF EXISTS translations ADD COLUMN IF NOT EXISTS namespace TEXT;
        ALTER TABLE IF EXISTS translations ADD COLUMN IF NOT EXISTS key TEXT;
        ALTER TABLE IF EXISTS translations ADD COLUMN IF NOT EXISTS lang TEXT;
        ALTER TABLE IF EXISTS translations ADD COLUMN IF NOT EXISTS value TEXT;
        ALTER TABLE IF EXISTS translations ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

        DROP POLICY IF EXISTS users_owner ON users;
        CREATE POLICY users_owner ON users FOR ALL
          USING (id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')
          WITH CHECK (id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin');

        CREATE TABLE IF NOT EXISTS payment_gateways (
            id UUID PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            config JSONB NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            version INT NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS prompt_templates (
            id UUID PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            content TEXT NOT NULL,
            tags TEXT[],
            version INT NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id UUID PRIMARY KEY,
            actor_id UUID,
            action TEXT NOT NULL,
            entity TEXT,
            entity_id UUID,
            before JSONB,
            after JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS translations (
            id UUID PRIMARY KEY,
            namespace TEXT NOT NULL,
            key TEXT NOT NULL,
            lang TEXT NOT NULL,
            value TEXT NOT NULL,
            version INT NOT NULL DEFAULT 1,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            deleted_at TIMESTAMPTZ
        );

        CREATE UNIQUE INDEX IF NOT EXISTS uq_trans_namespace_key_lang ON translations(namespace, key, lang) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_trans_lang_updated ON translations(lang, updated_at DESC) WHERE deleted_at IS NULL;

        ALTER TABLE payment_gateways ENABLE ROW LEVEL SECURITY;
        ALTER TABLE payment_gateways FORCE ROW LEVEL SECURITY;
        ALTER TABLE prompt_templates ENABLE ROW LEVEL SECURITY;
        ALTER TABLE prompt_templates FORCE ROW LEVEL SECURITY;
        ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
        ALTER TABLE translations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE translations FORCE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS translations_admin ON translations;
        CREATE POLICY gateways_admin ON payment_gateways FOR ALL
            USING (current_setting('app.role', true) = 'admin')
            WITH CHECK (current_setting('app.role', true) = 'admin');

        CREATE POLICY prompts_admin ON prompt_templates FOR ALL
            USING (current_setting('app.role', true) = 'admin')
            WITH CHECK (current_setting('app.role', true) = 'admin');

        CREATE POLICY audits_admin ON audit_logs FOR ALL
            USING (current_setting('app.role', true) = 'admin')
            WITH CHECK (current_setting('app.role', true) = 'admin');

        CREATE POLICY translations_admin ON translations FOR ALL
            USING (current_setting('app.role', true) = 'admin')
            WITH CHECK (current_setting('app.role', true) = 'admin');
        """
    )

def downgrade():
    op.execute(
        """
        DROP POLICY IF EXISTS translations_admin ON translations;
        DROP POLICY IF EXISTS audits_admin ON audit_logs;
        DROP POLICY IF EXISTS prompts_admin ON prompt_templates;
        DROP POLICY IF EXISTS gateways_admin ON payment_gateways;

        ALTER TABLE translations DISABLE ROW LEVEL SECURITY;
        ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;
        ALTER TABLE prompt_templates DISABLE ROW LEVEL SECURITY;
        ALTER TABLE payment_gateways DISABLE ROW LEVEL SECURITY;

        DROP INDEX IF EXISTS idx_trans_lang_updated;
        DROP INDEX IF EXISTS uq_trans_namespace_key_lang;

        DROP TABLE IF EXISTS translations;
        DROP TABLE IF EXISTS audit_logs;
        DROP TABLE IF EXISTS prompt_templates;
        DROP TABLE IF EXISTS payment_gateways;

        DROP POLICY IF EXISTS users_owner ON users;
        CREATE POLICY users_owner ON users FOR ALL
          USING (id = current_setting('app.user_id')::uuid)
          WITH CHECK (id = current_setting('app.user_id')::uuid);
        """
    )
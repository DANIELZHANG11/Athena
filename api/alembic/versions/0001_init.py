from alembic import op

revision = "0001_init"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE TABLE IF NOT EXISTS languages (code TEXT PRIMARY KEY, name TEXT NOT NULL, is_active BOOLEAN DEFAULT TRUE)")
    op.execute("ALTER TABLE languages ENABLE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY languages_admin ON languages FOR ALL USING (current_setting('app.role', true) = 'admin') WITH CHECK (current_setting('app.role', true) = 'admin')")
    op.execute("CREATE TABLE IF NOT EXISTS translations (lang_code TEXT NOT NULL REFERENCES languages(code) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (lang_code, key))")
    op.execute("CREATE INDEX IF NOT EXISTS idx_translations_lang ON translations(lang_code)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_translations_key ON translations(key)")
    op.execute("ALTER TABLE translations ENABLE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY translations_admin ON translations FOR ALL USING (current_setting('app.role', true) = 'admin') WITH CHECK (current_setting('app.role', true) = 'admin')")
    op.execute("CREATE TABLE IF NOT EXISTS user_sessions (id UUID PRIMARY KEY, user_id UUID NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), revoked BOOLEAN DEFAULT FALSE)")
    op.execute("ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY user_sessions_owner ON user_sessions FOR ALL USING (user_id = current_setting('app.user_id')::uuid) WITH CHECK (user_id = current_setting('app.user_id')::uuid)")
    op.execute("CREATE TABLE IF NOT EXISTS reading_progress (user_id UUID NOT NULL, book_id UUID NOT NULL, updated_at TIMESTAMPTZ DEFAULT now(), progress NUMERIC, PRIMARY KEY (user_id, book_id))")
    op.execute("ALTER TABLE reading_progress ENABLE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY reading_progress_owner ON reading_progress FOR ALL USING (user_id = current_setting('app.user_id')::uuid) WITH CHECK (user_id = current_setting('app.user_id')::uuid)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_reading_progress_user_book_updated ON reading_progress (user_id, book_id, updated_at DESC)")
    op.execute("CREATE TABLE IF NOT EXISTS dict_history (id UUID PRIMARY KEY, user_id UUID NOT NULL, word TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now())")
    op.execute("ALTER TABLE dict_history ENABLE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY dict_history_owner ON dict_history FOR ALL USING (user_id = current_setting('app.user_id')::uuid) WITH CHECK (user_id = current_setting('app.user_id')::uuid)")
    op.execute("CREATE TABLE IF NOT EXISTS payment_gateways (id UUID PRIMARY KEY, name TEXT NOT NULL, is_active BOOLEAN DEFAULT TRUE)")
    op.execute("ALTER TABLE payment_gateways ENABLE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY payment_gateways_admin ON payment_gateways FOR ALL USING (current_setting('app.role', true) = 'admin') WITH CHECK (current_setting('app.role', true) = 'admin')")
    op.execute("CREATE TABLE IF NOT EXISTS dictionary_packages (id UUID PRIMARY KEY, name TEXT NOT NULL, is_active BOOLEAN DEFAULT FALSE)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_dictionary_packages_active ON dictionary_packages (is_active)")
    op.execute("ALTER TABLE dictionary_packages ENABLE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY dictionary_packages_admin ON dictionary_packages FOR ALL USING (current_setting('app.role', true) = 'admin') WITH CHECK (current_setting('app.role', true) = 'admin')")

def downgrade():
    op.execute("DROP POLICY IF EXISTS dictionary_packages_admin ON dictionary_packages")
    op.execute("DROP TABLE IF EXISTS dictionary_packages")
    op.execute("DROP POLICY IF EXISTS payment_gateways_admin ON payment_gateways")
    op.execute("DROP TABLE IF EXISTS payment_gateways")
    op.execute("DROP POLICY IF EXISTS dict_history_owner ON dict_history")
    op.execute("DROP TABLE IF EXISTS dict_history")
    op.execute("DROP INDEX IF EXISTS idx_reading_progress_user_book_updated")
    op.execute("DROP POLICY IF EXISTS reading_progress_owner ON reading_progress")
    op.execute("DROP TABLE IF EXISTS reading_progress")
    op.execute("DROP POLICY IF EXISTS user_sessions_owner ON user_sessions")
    op.execute("DROP TABLE IF EXISTS user_sessions")
    op.execute("DROP POLICY IF EXISTS translations_admin ON translations")
    op.execute("DROP INDEX IF EXISTS idx_translations_key")
    op.execute("DROP INDEX IF EXISTS idx_translations_lang")
    op.execute("DROP TABLE IF EXISTS translations")
    op.execute("DROP POLICY IF EXISTS languages_admin ON languages")
    op.execute("DROP TABLE IF EXISTS languages")


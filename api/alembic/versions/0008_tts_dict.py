from alembic import op

revision = "0008_tts_dict"
down_revision = "0007_billing"
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tts_requests' AND column_name='owner_id') THEN
            ALTER TABLE tts_requests RENAME COLUMN owner_id TO user_id;
          END IF;
        END $$;
        ALTER TABLE IF EXISTS tts_requests ADD COLUMN IF NOT EXISTS user_id UUID;
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='translation_history' AND column_name='owner_id') THEN
            ALTER TABLE translation_history RENAME COLUMN owner_id TO user_id;
          END IF;
        END $$;
        ALTER TABLE IF EXISTS translation_history ADD COLUMN IF NOT EXISTS user_id UUID;
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dictionary_packages' AND column_name='owner_id') THEN
            ALTER TABLE dictionary_packages RENAME COLUMN owner_id TO user_id;
          END IF;
        END $$;
        ALTER TABLE IF EXISTS dictionary_packages ADD COLUMN IF NOT EXISTS user_id UUID;
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dict_history' AND column_name='owner_id') THEN
            ALTER TABLE dict_history RENAME COLUMN owner_id TO user_id;
          END IF;
        END $$;
        ALTER TABLE IF EXISTS dict_history ADD COLUMN IF NOT EXISTS user_id UUID;

        ALTER TABLE dictionary_packages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
        ALTER TABLE dictionary_packages ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
        ALTER TABLE dictionary_packages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
        ALTER TABLE dictionary_packages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
        ALTER TABLE IF EXISTS tts_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
        ALTER TABLE IF EXISTS tts_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
        ALTER TABLE IF EXISTS translation_history ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
        CREATE TABLE IF NOT EXISTS tts_requests (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            text TEXT NOT NULL,
            voice TEXT,
            speed REAL,
            format TEXT NOT NULL DEFAULT 'wav',
            status TEXT NOT NULL DEFAULT 'pending',
            audio_key TEXT,
            duration_ms INT,
            error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS translation_history (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            text TEXT NOT NULL,
            source_lang TEXT,
            target_lang TEXT,
            engine TEXT,
            result TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS dictionary_packages (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            name TEXT NOT NULL,
            lang TEXT NOT NULL,
            version INT NOT NULL DEFAULT 1,
            minio_key TEXT,
            status TEXT NOT NULL DEFAULT 'created',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            deleted_at TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS dict_history (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            word TEXT NOT NULL,
            lang TEXT,
            package_id UUID,
            book_id UUID,
            definition TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_tts_user_created ON tts_requests(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_trans_user_created ON translation_history(user_id, created_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_dict_pkg_user_name_ver ON dictionary_packages(user_id, name, version) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_dict_pkg_user_updated ON dictionary_packages(user_id, updated_at DESC) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_dict_hist_user_created ON dict_history(user_id, created_at DESC);

        ALTER TABLE tts_requests ENABLE ROW LEVEL SECURITY;
        ALTER TABLE tts_requests FORCE ROW LEVEL SECURITY;
        ALTER TABLE translation_history ENABLE ROW LEVEL SECURITY;
        ALTER TABLE translation_history FORCE ROW LEVEL SECURITY;
        ALTER TABLE dictionary_packages ENABLE ROW LEVEL SECURITY;
        ALTER TABLE dictionary_packages FORCE ROW LEVEL SECURITY;
        ALTER TABLE dict_history ENABLE ROW LEVEL SECURITY;
        ALTER TABLE dict_history FORCE ROW LEVEL SECURITY;

        CREATE POLICY tts_owner ON tts_requests FOR ALL
            USING (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')
            WITH CHECK (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin');

        CREATE POLICY trans_owner ON translation_history FOR ALL
            USING (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')
            WITH CHECK (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin');

        CREATE POLICY dict_pkg_owner ON dictionary_packages FOR ALL
            USING (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')
            WITH CHECK (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin');

        CREATE POLICY dict_hist_owner ON dict_history FOR ALL
            USING (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')
            WITH CHECK (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin');
        """
    )

def downgrade():
    op.execute(
        """
        DROP POLICY IF EXISTS dict_hist_owner ON dict_history;
        DROP POLICY IF EXISTS dict_pkg_owner ON dictionary_packages;
        DROP POLICY IF EXISTS trans_owner ON translation_history;
        DROP POLICY IF EXISTS tts_owner ON tts_requests;

        ALTER TABLE dict_history DISABLE ROW LEVEL SECURITY;
        ALTER TABLE dictionary_packages DISABLE ROW LEVEL SECURITY;
        ALTER TABLE translation_history DISABLE ROW LEVEL SECURITY;
        ALTER TABLE tts_requests DISABLE ROW LEVEL SECURITY;

        DROP INDEX IF EXISTS idx_dict_hist_owner_created;
        DROP INDEX IF EXISTS idx_dict_pkg_owner_updated;
        DROP INDEX IF EXISTS uq_dict_pkg_owner_name_ver;
        DROP INDEX IF EXISTS idx_trans_owner_created;
        DROP INDEX IF EXISTS idx_tts_owner_created;

        DROP TABLE IF EXISTS dict_history;
        DROP TABLE IF EXISTS dictionary_packages;
        DROP TABLE IF EXISTS translation_history;
        DROP TABLE IF EXISTS tts_requests;
        """
    )
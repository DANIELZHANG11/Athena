from alembic import op


# revision identifiers, used by Alembic.
revision = "0003_books"
down_revision = "0002_auth"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS shelves (
            id UUID PRIMARY KEY,
            owner_id UUID NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            version INT NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS books (
            id UUID PRIMARY KEY,
            owner_id UUID NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            language TEXT,
            original_format TEXT,
            minio_key TEXT NOT NULL,
            size BIGINT,
            cover_image_key TEXT,
            version INT NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS shelf_items (
            shelf_id UUID NOT NULL,
            book_id UUID NOT NULL,
            position INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (shelf_id, book_id)
        );

        CREATE TABLE IF NOT EXISTS conversion_jobs (
            id UUID PRIMARY KEY,
            owner_id UUID NOT NULL,
            book_id UUID NOT NULL,
            source_key TEXT NOT NULL,
            target_format TEXT NOT NULL,
            output_key TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            error TEXT
        );

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_shelves_owner_updated ON shelves(owner_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_books_owner_updated ON books(owner_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_shelf_items_shelf ON shelf_items(shelf_id);
        CREATE INDEX IF NOT EXISTS idx_conversion_jobs_owner_status ON conversion_jobs(owner_id, status, created_at DESC);

        -- Enable RLS and FORCE RLS
        ALTER TABLE shelves ENABLE ROW LEVEL SECURITY;
        ALTER TABLE shelves FORCE ROW LEVEL SECURITY;
        ALTER TABLE books ENABLE ROW LEVEL SECURITY;
        ALTER TABLE books FORCE ROW LEVEL SECURITY;
        ALTER TABLE shelf_items ENABLE ROW LEVEL SECURITY;
        ALTER TABLE shelf_items FORCE ROW LEVEL SECURITY;
        ALTER TABLE conversion_jobs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE conversion_jobs FORCE ROW LEVEL SECURITY;

        -- RLS policies: owner or admin
        CREATE POLICY shelves_owner ON shelves
            FOR ALL
            USING (
                owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin'
            )
            WITH CHECK (
                owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin'
            );

        CREATE POLICY books_owner ON books
            FOR ALL
            USING (
                owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin'
            )
            WITH CHECK (
                owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin'
            );

        CREATE POLICY shelf_items_owner ON shelf_items
            FOR ALL
            USING (
                (
                    EXISTS (
                        SELECT 1 FROM shelves s
                        WHERE s.id = shelf_items.shelf_id
                          AND (s.owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')
                    )
                )
            )
            WITH CHECK (
                (
                    EXISTS (
                        SELECT 1 FROM shelves s
                        WHERE s.id = shelf_items.shelf_id
                          AND (s.owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')
                    )
                )
            );

        CREATE POLICY conversion_jobs_owner ON conversion_jobs
            FOR ALL
            USING (
                owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin'
            )
            WITH CHECK (
                owner_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin'
            );
        """
    )


def downgrade():
    op.execute(
        """
        DROP POLICY IF EXISTS conversion_jobs_owner ON conversion_jobs;
        DROP POLICY IF EXISTS shelf_items_owner ON shelf_items;
        DROP POLICY IF EXISTS books_owner ON books;
        DROP POLICY IF EXISTS shelves_owner ON shelves;

        ALTER TABLE conversion_jobs DISABLE ROW LEVEL SECURITY;
        ALTER TABLE shelf_items DISABLE ROW LEVEL SECURITY;
        ALTER TABLE books DISABLE ROW LEVEL SECURITY;
        ALTER TABLE shelves DISABLE ROW LEVEL SECURITY;

        DROP INDEX IF EXISTS idx_conversion_jobs_owner_status;
        DROP INDEX IF EXISTS idx_shelf_items_shelf;
        DROP INDEX IF EXISTS idx_books_owner_updated;
        DROP INDEX IF EXISTS idx_shelves_owner_updated;

        DROP TABLE IF EXISTS conversion_jobs;
        DROP TABLE IF EXISTS shelf_items;
        DROP TABLE IF EXISTS books;
        DROP TABLE IF EXISTS shelves;
        """
    )
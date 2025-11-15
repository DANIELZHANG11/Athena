from alembic import op


revision = "0005_notes_tags"
down_revision = "0004_reader"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS tags (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            name TEXT NOT NULL,
            version INT NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            deleted_at TIMESTAMPTZ
        );

        CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_user_name ON tags(user_id, name) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_tags_user_updated ON tags(user_id, updated_at DESC) WHERE deleted_at IS NULL;

        CREATE TABLE IF NOT EXISTS notes (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            book_id UUID NOT NULL,
            content TEXT NOT NULL,
            chapter TEXT,
            location INTEGER,
            pos_offset INTEGER,
            version INT NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            deleted_at TIMESTAMPTZ
        );

        CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, updated_at DESC) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_notes_user_book ON notes(user_id, book_id) WHERE deleted_at IS NULL;

        CREATE TABLE IF NOT EXISTS highlights (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            book_id UUID NOT NULL,
            start_location INTEGER,
            end_location INTEGER,
            color TEXT,
            comment TEXT,
            version INT NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            deleted_at TIMESTAMPTZ
        );

        CREATE INDEX IF NOT EXISTS idx_highlights_user_updated ON highlights(user_id, updated_at DESC) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_highlights_user_book ON highlights(user_id, book_id) WHERE deleted_at IS NULL;

        CREATE TABLE IF NOT EXISTS note_tags (
            note_id UUID NOT NULL,
            tag_id UUID NOT NULL,
            PRIMARY KEY (note_id, tag_id)
        );

        CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id);

        CREATE TABLE IF NOT EXISTS highlight_tags (
            highlight_id UUID NOT NULL,
            tag_id UUID NOT NULL,
            PRIMARY KEY (highlight_id, tag_id)
        );

        CREATE INDEX IF NOT EXISTS idx_highlight_tags_tag ON highlight_tags(tag_id);

        ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
        ALTER TABLE tags FORCE ROW LEVEL SECURITY;
        ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
        ALTER TABLE notes FORCE ROW LEVEL SECURITY;
        ALTER TABLE highlights ENABLE ROW LEVEL SECURITY;
        ALTER TABLE highlights FORCE ROW LEVEL SECURITY;
        ALTER TABLE note_tags ENABLE ROW LEVEL SECURITY;
        ALTER TABLE note_tags FORCE ROW LEVEL SECURITY;
        ALTER TABLE highlight_tags ENABLE ROW LEVEL SECURITY;
        ALTER TABLE highlight_tags FORCE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS tags_owner ON tags;
        CREATE POLICY tags_owner ON tags FOR ALL
            USING (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')
            WITH CHECK (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin');

        DROP POLICY IF EXISTS notes_owner ON notes;
        CREATE POLICY notes_owner ON notes FOR ALL
            USING (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')
            WITH CHECK (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin');

        DROP POLICY IF EXISTS highlights_owner ON highlights;
        CREATE POLICY highlights_owner ON highlights FOR ALL
            USING (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')
            WITH CHECK (user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin');

        DROP POLICY IF EXISTS note_tags_owner ON note_tags;
        CREATE POLICY note_tags_owner ON note_tags FOR ALL
            USING (EXISTS (SELECT 1 FROM notes n WHERE n.id = note_tags.note_id AND (n.user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')))
            WITH CHECK (EXISTS (SELECT 1 FROM notes n WHERE n.id = note_tags.note_id AND (n.user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')));

        DROP POLICY IF EXISTS highlight_tags_owner ON highlight_tags;
        CREATE POLICY highlight_tags_owner ON highlight_tags FOR ALL
            USING (EXISTS (SELECT 1 FROM highlights h WHERE h.id = highlight_tags.highlight_id AND (h.user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')))
            WITH CHECK (EXISTS (SELECT 1 FROM highlights h WHERE h.id = highlight_tags.highlight_id AND (h.user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin')));
        """
    )


def downgrade():
    op.execute(
        """
        DROP POLICY IF EXISTS highlight_tags_owner ON highlight_tags;
        DROP POLICY IF EXISTS note_tags_owner ON note_tags;
        DROP POLICY IF EXISTS highlights_owner ON highlights;
        DROP POLICY IF EXISTS notes_owner ON notes;
        DROP POLICY IF EXISTS tags_owner ON tags;

        ALTER TABLE highlight_tags DISABLE ROW LEVEL SECURITY;
        ALTER TABLE note_tags DISABLE ROW LEVEL SECURITY;
        ALTER TABLE highlights DISABLE ROW LEVEL SECURITY;
        ALTER TABLE notes DISABLE ROW LEVEL SECURITY;
        ALTER TABLE tags DISABLE ROW LEVEL SECURITY;

        DROP INDEX IF EXISTS idx_highlight_tags_tag;
        DROP INDEX IF EXISTS idx_note_tags_tag;
        DROP INDEX IF EXISTS idx_highlights_user_book;
        DROP INDEX IF EXISTS idx_highlights_user_updated;
        DROP INDEX IF EXISTS idx_notes_user_book;
        DROP INDEX IF EXISTS idx_notes_user_updated;
        DROP INDEX IF EXISTS uq_tags_user_name;
        DROP INDEX IF EXISTS idx_tags_user_updated;

        DROP TABLE IF EXISTS highlight_tags;
        DROP TABLE IF EXISTS note_tags;
        DROP TABLE IF EXISTS highlights;
        DROP TABLE IF EXISTS notes;
        DROP TABLE IF EXISTS tags;
        """
    )
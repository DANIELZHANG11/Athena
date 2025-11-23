"""
Add books.meta jsonb and create notes/tags/highlights tables with RLS

Revision ID: a7f3e9b2c1d4
Revises: 0105_ai_srs_users_locale
Create Date: 2025-11-23
"""

from alembic import op

revision = "a7f3e9b2c1d4"
down_revision = "0105_ai_srs_users_locale"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        -- books.meta jsonb
        ALTER TABLE IF EXISTS books
          ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_books_meta_page'
          ) THEN
            CREATE INDEX idx_books_meta_page ON books ((meta->>'page_count'));
          END IF;
        END$$;

        -- notes
        CREATE TABLE IF NOT EXISTS notes (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL,
          book_id UUID NOT NULL,
          content TEXT NOT NULL,
          chapter TEXT,
          location TEXT,
          pos_offset INTEGER,
          tsv tsvector,
          version INTEGER NOT NULL DEFAULT 1,
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        -- tags
        CREATE TABLE IF NOT EXISTS tags (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL,
          name TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE(user_id, name)
        );

        -- highlights
        CREATE TABLE IF NOT EXISTS highlights (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL,
          book_id UUID NOT NULL,
          start_location TEXT NOT NULL,
          end_location TEXT NOT NULL,
          color TEXT,
          comment TEXT,
          tsv tsvector,
          version INTEGER NOT NULL DEFAULT 1,
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        -- relations
        CREATE TABLE IF NOT EXISTS note_tags (
          note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
          tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY(note_id, tag_id)
        );
        CREATE TABLE IF NOT EXISTS highlight_tags (
          highlight_id UUID NOT NULL REFERENCES highlights(id) ON DELETE CASCADE,
          tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY(highlight_id, tag_id)
        );

        -- indexes
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notes_user_updated'
          ) THEN
            CREATE INDEX idx_notes_user_updated ON notes(user_id, updated_at DESC);
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_highlights_user_updated'
          ) THEN
            CREATE INDEX idx_highlights_user_updated ON highlights(user_id, updated_at DESC);
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notes_tsv'
          ) THEN
            CREATE INDEX idx_notes_tsv ON notes USING GIN(tsv);
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_highlights_tsv'
          ) THEN
            CREATE INDEX idx_highlights_tsv ON highlights USING GIN(tsv);
          END IF;
        END$$;

        -- RLS policies
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_tables WHERE tablename = 'notes'
          ) THEN NULL; END IF;
          ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
          DROP POLICY IF EXISTS notes_owner_policy ON notes;
          CREATE POLICY notes_owner_policy ON notes
            USING (
              user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin'
            ) WITH CHECK (
              user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin'
            );

          ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
          DROP POLICY IF EXISTS tags_owner_policy ON tags;
          CREATE POLICY tags_owner_policy ON tags
            USING (
              user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin'
            ) WITH CHECK (
              user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin'
            );

          ALTER TABLE highlights ENABLE ROW LEVEL SECURITY;
          DROP POLICY IF EXISTS highlights_owner_policy ON highlights;
          CREATE POLICY highlights_owner_policy ON highlights
            USING (
              user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin'
            ) WITH CHECK (
              user_id = current_setting('app.user_id')::uuid OR current_setting('app.role', true) = 'admin'
            );
        END$$;
        """
    )


def downgrade():
    op.execute(
        """
        DROP POLICY IF EXISTS highlights_owner_policy ON highlights;
        DROP POLICY IF EXISTS tags_owner_policy ON tags;
        DROP POLICY IF EXISTS notes_owner_policy ON notes;
        ALTER TABLE IF EXISTS highlights DISABLE ROW LEVEL SECURITY;
        ALTER TABLE IF EXISTS tags DISABLE ROW LEVEL SECURITY;
        ALTER TABLE IF EXISTS notes DISABLE ROW LEVEL SECURITY;

        DROP INDEX IF EXISTS idx_highlights_tsv;
        DROP INDEX IF EXISTS idx_notes_tsv;
        DROP INDEX IF EXISTS idx_highlights_user_updated;
        DROP INDEX IF EXISTS idx_notes_user_updated;

        DROP TABLE IF EXISTS highlight_tags;
        DROP TABLE IF EXISTS note_tags;
        DROP TABLE IF EXISTS highlights;
        DROP TABLE IF EXISTS tags;
        DROP TABLE IF EXISTS notes;

        DROP INDEX IF EXISTS idx_books_meta_page;
        ALTER TABLE IF EXISTS books DROP COLUMN IF EXISTS meta;
        """
    )


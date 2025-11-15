from alembic import op


revision = "0006_search_tsv"
down_revision = "0005_notes_tags"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        ALTER TABLE notes ADD COLUMN IF NOT EXISTS tsv tsvector;
        UPDATE notes SET tsv = to_tsvector('simple', coalesce(content,'') || ' ' || coalesce(chapter,''));
        CREATE INDEX IF NOT EXISTS idx_notes_tsv ON notes USING GIN(tsv);

        ALTER TABLE highlights ADD COLUMN IF NOT EXISTS tsv tsvector;
        UPDATE highlights SET tsv = to_tsvector('simple', coalesce(color,'') || ' ' || coalesce(comment,''));
        CREATE INDEX IF NOT EXISTS idx_highlights_tsv ON highlights USING GIN(tsv);
        """
    )


def downgrade():
    op.execute(
        """
        DROP INDEX IF EXISTS idx_highlights_tsv;
        DROP INDEX IF EXISTS idx_notes_tsv;
        ALTER TABLE highlights DROP COLUMN IF EXISTS tsv;
        ALTER TABLE notes DROP COLUMN IF EXISTS tsv;
        """
    )
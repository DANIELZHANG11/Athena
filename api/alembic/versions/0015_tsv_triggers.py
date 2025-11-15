from alembic import op

revision = "0015_tsv_triggers"
down_revision = "0014_unify_user_id"
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        CREATE OR REPLACE FUNCTION notes_tsv_refresh() RETURNS trigger AS $$
        BEGIN
          NEW.tsv := to_tsvector('simple', coalesce(NEW.content,'') || ' ' || coalesce(NEW.chapter,''));
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_notes_tsv_refresh ON notes;
        CREATE TRIGGER trg_notes_tsv_refresh
        BEFORE INSERT OR UPDATE OF content, chapter ON notes
        FOR EACH ROW EXECUTE FUNCTION notes_tsv_refresh();

        CREATE OR REPLACE FUNCTION highlights_tsv_refresh() RETURNS trigger AS $$
        BEGIN
          NEW.tsv := to_tsvector('simple', coalesce(NEW.color,'') || ' ' || coalesce(NEW.comment,''));
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_highlights_tsv_refresh ON highlights;
        CREATE TRIGGER trg_highlights_tsv_refresh
        BEFORE INSERT OR UPDATE OF color, comment ON highlights
        FOR EACH ROW EXECUTE FUNCTION highlights_tsv_refresh();
        """
    )

def downgrade():
    op.execute(
        """
        DROP TRIGGER IF EXISTS trg_notes_tsv_refresh ON notes;
        DROP FUNCTION IF EXISTS notes_tsv_refresh;
        DROP TRIGGER IF EXISTS trg_highlights_tsv_refresh ON highlights;
        DROP FUNCTION IF EXISTS highlights_tsv_refresh;
        """
    )
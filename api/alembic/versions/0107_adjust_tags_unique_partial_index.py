"""
Adjust tags unique to exclude soft-deleted via partial unique index

Revision ID: 0107_adjust_tags_unique_partial_index
Revises: 0106_add_books_meta_and_content_tables
Create Date: 2025-11-23
"""

from alembic import op

revision = "0107_adjust_tags_unique_partial_index"
down_revision = "0106_add_books_meta_and_content_tables"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'tags_user_id_name_key'
          ) THEN
            ALTER TABLE tags DROP CONSTRAINT tags_user_id_name_key;
          END IF;
        END$$;
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = 'uniq_tags_user_name_active'
          ) THEN
            CREATE UNIQUE INDEX uniq_tags_user_name_active ON tags(user_id, name) WHERE deleted_at IS NULL;
          END IF;
        END$$;
        """
    )


def downgrade():
    op.execute(
        """
        DROP INDEX IF EXISTS uniq_tags_user_name_active;
        ALTER TABLE tags ADD CONSTRAINT tags_user_id_name_key UNIQUE(user_id, name);
        """
    )


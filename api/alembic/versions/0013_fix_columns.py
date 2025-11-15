from alembic import op

revision = "0013_fix_columns"
down_revision = "0012_ocr_srs"
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        ALTER TABLE users ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
        ALTER TABLE dictionary_packages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
        """
    )

def downgrade():
    pass
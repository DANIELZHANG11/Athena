from alembic import op

revision = "0019_reader_location_column"
down_revision = "0018_users_policy_admin"
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        ALTER TABLE IF EXISTS reading_progress ADD COLUMN IF NOT EXISTS last_location text;
        """
    )

def downgrade():
    op.execute(
        """
        ALTER TABLE IF EXISTS reading_progress DROP COLUMN IF EXISTS last_location;
        """
    )
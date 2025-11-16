from alembic import op

revision = "0014_unify_user_id"
down_revision = "0013_fix_columns"
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        ALTER TABLE IF EXISTS books RENAME COLUMN owner_id TO user_id;
        ALTER TABLE IF EXISTS shelves RENAME COLUMN owner_id TO user_id;
        """
    )

def downgrade():
    op.execute(
        """
        ALTER TABLE IF EXISTS books RENAME COLUMN user_id TO owner_id;
        ALTER TABLE IF EXISTS shelves RENAME COLUMN user_id TO owner_id;
        """
    )
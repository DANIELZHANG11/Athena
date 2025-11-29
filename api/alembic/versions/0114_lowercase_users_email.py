"""lowercase users email

Revision ID: 0114
Revises: 0113
Create Date: 2025-11-27 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0114'
down_revision = 'g2b3c4d5e6f7'
branch_labels = None
depends_on = None


def upgrade():
    # Convert all existing emails to lowercase to ensure case-insensitive matching
    # Note: This assumes no duplicates exist (e.g. 'Test@a.com' and 'test@a.com')
    # If duplicates exist, this operation might fail or require manual merge.
    op.execute("UPDATE users SET email = LOWER(email)")


def downgrade():
    # Cannot reversible reliably without backup
    pass

"""
Add external_id to payment_sessions

Revision ID: 0102_add_external_id_to_payment_sessions
Revises: 0101_add_books_source_etag
Create Date: 2025-11-17
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0102_ext_id_payment_sessions"
down_revision = "0101_add_books_source_etag"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE IF EXISTS payment_sessions ADD COLUMN IF NOT EXISTS external_id TEXT"
    )


def downgrade():
    op.execute(
        "ALTER TABLE IF EXISTS payment_sessions DROP COLUMN IF EXISTS external_id"
    )

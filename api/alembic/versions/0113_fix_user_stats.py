"""fix user_stats table add storage and book count columns

Revision ID: g2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2025-11-27 14:56:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'g2b3c4d5e6f7'
down_revision = '0112abcdef01'
branch_labels = None
depends_on = None


def upgrade():
    # Add missing columns to user_stats
    op.add_column('user_stats',
        sa.Column('storage_used', sa.BigInteger(), server_default='0', nullable=False))
    op.add_column('user_stats',
        sa.Column('book_count', sa.Integer(), server_default='0', nullable=False))
    
    # Backfill from books table for existing users (without deleted_at check)
    op.execute("""
        UPDATE user_stats us
        SET 
            book_count = COALESCE((
                SELECT COUNT(*) FROM books b 
                WHERE b.user_id = us.user_id
            ), 0),
            storage_used = COALESCE((
                SELECT SUM(b.size) FROM books b 
                WHERE b.user_id = us.user_id
            ), 0)
    """)


def downgrade():
    op.drop_column('user_stats', 'book_count')
    op.drop_column('user_stats', 'storage_used')

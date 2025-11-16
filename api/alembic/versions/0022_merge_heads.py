"""
Merge heads to line up branches

Revision ID: 0022_merge_heads
Revises: 0021_books_cols, 0020_reading_daily_stats, 0019_pricing_rules
Create Date: 2025-11-16
"""

from alembic import op

revision = '0022_merge_heads'
down_revision = ('0021_books_cols', '0020_reading_daily_stats', '0019_pricing_rules')
branch_labels = None
depends_on = None

def upgrade():
    pass

def downgrade():
    pass
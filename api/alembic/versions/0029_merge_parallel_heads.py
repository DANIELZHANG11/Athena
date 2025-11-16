"""
Merge parallel branches for books and features

Revision ID: 0029_merge_parallel_heads
Revises: 0021_books_cols, 0019_pricing_rules, 0020_ai_conversations
Create Date: 2025-11-16
"""

from alembic import op

revision = '0029_merge_parallel_heads'
down_revision = ('0021_books_cols', '0019_pricing_rules', '0020_ai_conversations')
branch_labels = None
depends_on = None

def upgrade():
    pass

def downgrade():
    pass
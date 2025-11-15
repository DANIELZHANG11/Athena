"""
Add wallet columns to credit_accounts

Revision ID: 0026_wallet_columns
Revises: 0025_ai_query_cache
Create Date: 2025-11-15
"""

from alembic import op

revision = '0026_wallet_columns'
down_revision = '0025_ai_query_cache'
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        ALTER TABLE IF EXISTS credit_accounts
          ADD COLUMN IF NOT EXISTS wallet_amount NUMERIC NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS wallet_currency TEXT NOT NULL DEFAULT 'CNY';
        """
    )

def downgrade():
    op.execute(
        """
        ALTER TABLE IF EXISTS credit_accounts
          DROP COLUMN IF EXISTS wallet_amount,
          DROP COLUMN IF EXISTS wallet_currency;
        """
    )
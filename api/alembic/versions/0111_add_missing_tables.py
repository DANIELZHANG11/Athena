"""add missing tables for invites billing admin

Revision ID: f1a2b3c4d5e6
Revises: e2b7c3d4e5f6
Create Date: 2025-11-23 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'f1a2b3c4d5e6'
down_revision = 'e2b7c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    # Invites
    op.create_table('invites',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('inviter_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('invite_code', sa.String(length=20), nullable=False),
        sa.Column('status', sa.String(length=20), server_default='pending', nullable=False),
        sa.Column('invitee_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_invites_code', 'invites', ['invite_code'], unique=True)
    op.create_index('ix_invites_inviter', 'invites', ['inviter_id'])

    # User Stats
    op.create_table('user_stats',
        sa.Column('user_id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('invite_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('extra_storage_quota', sa.BigInteger(), server_default='0', nullable=False),
        sa.Column('extra_book_quota', sa.Integer(), server_default='0', nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )

    # Payment Gateways
    op.create_table('payment_gateways',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(length=50), nullable=False),
        sa.Column('config', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
    )
    op.create_index('ix_payment_gateways_name', 'payment_gateways', ['name'], unique=True)

    # Payment Sessions
    op.create_table('payment_sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('owner_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('gateway', sa.String(length=50), nullable=False),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('currency', sa.String(length=10), server_default='CNY', nullable=False),
        sa.Column('status', sa.String(length=20), server_default='pending', nullable=False),
        sa.Column('return_url', sa.String(length=1024), nullable=True),
        sa.Column('cancel_url', sa.String(length=1024), nullable=True),
        sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('external_id', sa.String(length=255), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_payment_sessions_owner', 'payment_sessions', ['owner_id'])

    # Payment Webhook Events
    op.create_table('payment_webhook_events',
        sa.Column('id', sa.String(length=255), primary_key=True),
        sa.Column('gateway', sa.String(length=50), nullable=False),
        sa.Column('session_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('processed', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )

    # Credit Accounts
    op.create_table('credit_accounts',
        sa.Column('owner_id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('balance', sa.BigInteger(), server_default='0', nullable=False),
        sa.Column('currency', sa.String(length=10), server_default='CREDITS', nullable=False),
        sa.Column('wallet_amount', sa.Numeric(precision=12, scale=2), server_default='0', nullable=False),
        sa.Column('wallet_currency', sa.String(length=10), server_default='CNY', nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )

    # Credit Ledger
    op.create_table('credit_ledger',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('owner_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('amount', sa.BigInteger(), nullable=False),
        sa.Column('currency', sa.String(length=10), nullable=False),
        sa.Column('reason', sa.String(length=255), nullable=False),
        sa.Column('related_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('direction', sa.String(length=10), nullable=False), # credit/debit
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_credit_ledger_owner', 'credit_ledger', ['owner_id'])

    # Regional Prices
    op.create_table('regional_prices',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('plan_code', sa.String(length=50), nullable=False),
        sa.Column('currency', sa.String(length=10), nullable=False),
        sa.Column('period', sa.String(length=20), nullable=False),
        sa.Column('amount_minor', sa.Integer(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
    )
    op.create_index('ix_regional_prices_uniq', 'regional_prices', ['plan_code', 'currency', 'period'], unique=True)

    # System Settings
    op.create_table('system_settings',
        sa.Column('key', sa.String(length=100), primary_key=True),
        sa.Column('value', sa.Text(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )


def downgrade():
    op.drop_table('system_settings')
    op.drop_table('regional_prices')
    op.drop_table('credit_ledger')
    op.drop_table('credit_accounts')
    op.drop_table('payment_webhook_events')
    op.drop_table('payment_sessions')
    op.drop_table('payment_gateways')
    op.drop_table('user_stats')
    op.drop_table('invites')

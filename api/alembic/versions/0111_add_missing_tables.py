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


def downgrade():
    op.drop_table('regional_prices')
    op.drop_table('user_stats')
    op.drop_table('invites')

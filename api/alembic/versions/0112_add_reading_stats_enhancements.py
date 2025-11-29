"""
Add reading goals, streaks and finished_at timestamp

Revision ID: 0112_add_reading_stats_enhancements
Revises: 0111_add_missing_tables
Create Date: 2025-11-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0112abcdef01"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade():
    # 1. Create user_reading_goals table with FK
    op.create_table(
        "user_reading_goals",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("daily_minutes", sa.Integer(), server_default="30", nullable=False),
        sa.Column("yearly_books", sa.Integer(), server_default="10", nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # 2. Create user_streaks table with FK
    op.create_table(
        "user_streaks",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("current_streak", sa.Integer(), server_default="0", nullable=False),
        sa.Column("longest_streak", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_read_date", sa.Date(), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # 3. Add finished_at to reading_progress
    # Note: We rely on finished_at IS NOT NULL to determine "Finished" status.
    # We DO NOT add books_finished to reading_daily to avoid data pollution on status toggle.
    # Annual counts should be aggregated from reading_progress.finished_at.
    op.add_column("reading_progress", sa.Column("finished_at", sa.TIMESTAMP(timezone=True), nullable=True))
    
    # Index for querying yearly finished books
    op.create_index("idx_reading_progress_user_finished", "reading_progress", ["user_id", "finished_at"])


def downgrade():
    op.drop_index("idx_reading_progress_user_finished", table_name="reading_progress")
    op.drop_column("reading_progress", "finished_at")
    op.drop_table("user_streaks")
    op.drop_table("user_reading_goals")

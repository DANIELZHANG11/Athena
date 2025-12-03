"""Add metadata confirmation fields to books table

Revision ID: 0119
Revises: 0118
Create Date: 2025-12-03

This migration adds metadata confirmation fields to support the user-confirmed
metadata workflow for better AI conversation quality.

Design Principles:
- All uploaded books should prompt user to confirm metadata (title, author)
- Accurate metadata improves AI conversation context
- User can skip confirmation for private documents (not books)
- Metadata changes sync across devices via heartbeat protocol

Fields:
- metadata_confirmed: Whether user has confirmed (or skipped) metadata
- metadata_confirmed_at: When user confirmed metadata

AI Context Integration:
The title and author fields are sent to upstream AI models as context:
```
用户正在阅读的文档信息：
- 书籍/文档名称：{title}
- 作者：{author if author else "未知"}
```
"""
from alembic import op
import sqlalchemy as sa


revision = '0119'
down_revision = '0118'
branch_labels = None
depends_on = None


def upgrade():
    # Add metadata confirmation flag
    op.add_column(
        'books',
        sa.Column('metadata_confirmed', sa.Boolean(), nullable=False, server_default='false',
                  comment='用户是否已确认元数据（书名、作者），用于上传后弹窗提示')
    )
    
    # Add metadata confirmation timestamp
    op.add_column(
        'books',
        sa.Column('metadata_confirmed_at', sa.TIMESTAMP(timezone=True), nullable=True,
                  comment='元数据确认时间')
    )
    
    # Note: No index needed as we primarily query by user_id + updated_at
    # The metadata_confirmed field is used in frontend dialog logic, not server queries


def downgrade():
    op.drop_column('books', 'metadata_confirmed_at')
    op.drop_column('books', 'metadata_confirmed')

"""add shelf_books user_id column for PowerSync sync

PowerSync 需要 user_id 列来过滤数据。
shelf_books 表之前只有 shelf_id 和 book_id，无法直接参与 PowerSync 同步。

Revision ID: 0127
Revises: 0126_add_powersync_columns
Create Date: 2025-12-15
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0127'
down_revision = '0126'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 添加 user_id 列（允许为空，因为需要先填充现有数据）
    op.add_column('shelf_books', sa.Column('user_id', sa.UUID(), nullable=True))
    
    # 2. 从 shelves 表填充现有 shelf_books 的 user_id
    op.execute("""
        UPDATE shelf_books sb
        SET user_id = s.user_id
        FROM shelves s
        WHERE sb.shelf_id = s.id
    """)
    
    # 3. 设置 user_id 为非空（所有现有数据已填充）
    op.alter_column('shelf_books', 'user_id', nullable=False)
    
    # 4. 添加外键约束
    op.create_foreign_key(
        'shelf_books_user_id_fkey',
        'shelf_books',
        'users',
        ['user_id'],
        ['id'],
        ondelete='CASCADE'
    )
    
    # 5. 添加索引以提高查询性能
    op.create_index('idx_shelf_books_user', 'shelf_books', ['user_id'])
    
    # 6. 添加到 PowerSync publication (如果还没有)
    op.execute("""
        DO $$
        BEGIN
            -- 检查 publication 是否存在，不存在则创建
            IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
                CREATE PUBLICATION powersync;
            END IF;

            -- 检查表是否已经在 publication 中
            IF NOT EXISTS (
                SELECT 1 FROM pg_publication_tables 
                WHERE pubname = 'powersync' AND tablename = 'shelf_books'
            ) THEN
                ALTER PUBLICATION powersync ADD TABLE shelf_books;
            END IF;
        END $$;
    """)


def downgrade() -> None:
    # 从 PowerSync publication 移除
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_publication_tables 
                WHERE pubname = 'powersync' AND tablename = 'shelf_books'
            ) THEN
                ALTER PUBLICATION powersync DROP TABLE shelf_books;
            END IF;
        END $$;
    """)
    
    # 移除索引
    op.drop_index('idx_shelf_books_user', table_name='shelf_books')
    
    # 移除外键
    op.drop_constraint('shelf_books_user_id_fkey', 'shelf_books', type_='foreignkey')
    
    # 移除列
    op.drop_column('shelf_books', 'user_id')

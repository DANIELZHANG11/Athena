from alembic import op
import sqlalchemy as sa

revision = '0020_ai_conversations'
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.execute("""
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id UUID PRIMARY KEY,
      owner_id UUID NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS ai_messages (
      id UUID PRIMARY KEY,
      conversation_id UUID NOT NULL REFERENCES ai_conversations(id),
      owner_id UUID NOT NULL,
      role VARCHAR(16) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );
    """)

def downgrade():
    op.execute("DROP TABLE IF EXISTS ai_messages;")
    op.execute("DROP TABLE IF EXISTS ai_conversations;")
from alembic import op
import sqlalchemy as sa

revision = '0019_pricing_rules'
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.execute("""
    CREATE TABLE IF NOT EXISTS pricing_rules (
      id UUID PRIMARY KEY,
      service_type VARCHAR(32) NOT NULL,
      unit_type VARCHAR(32) NOT NULL,
      unit_size INTEGER NOT NULL,
      price_amount NUMERIC(10,2) NOT NULL,
      currency VARCHAR(10) NOT NULL,
      region VARCHAR(10),
      remark_template TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );
    """)

def downgrade():
    op.execute("DROP TABLE IF EXISTS pricing_rules;")
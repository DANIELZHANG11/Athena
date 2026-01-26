"""add ai_models extended fields

Revision ID: 0131
Revises: 0130_add_reading_settings
Create Date: 2026-01-03

扩展 ai_models 表以支持多服务商配置:
- provider: 服务商名称 (siliconflow, openrouter)
- api_key_encrypted: 加密存储的 API 密钥
- endpoint: 自定义 API 端点
- input_price_per_1k: 输入价格/1K tokens
- output_price_per_1k: 输出价格/1K tokens
- context_window: 上下文窗口大小
- is_default: 是否默认模型
- capabilities: 模型能力 (chat, embedding, vision)
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0131"
down_revision = "0130"
branch_labels = None
depends_on = None


def upgrade():
    # 扩展 ai_models 表
    op.add_column(
        "ai_models",
        sa.Column("api_key_encrypted", sa.Text(), nullable=True),
    )
    op.add_column(
        "ai_models",
        sa.Column("endpoint", sa.Text(), nullable=True),
    )
    op.add_column(
        "ai_models",
        sa.Column(
            "input_price_per_1k",
            sa.Numeric(precision=10, scale=6),
            nullable=True,
            server_default="0",
        ),
    )
    op.add_column(
        "ai_models",
        sa.Column(
            "output_price_per_1k",
            sa.Numeric(precision=10, scale=6),
            nullable=True,
            server_default="0",
        ),
    )
    op.add_column(
        "ai_models",
        sa.Column(
            "context_window",
            sa.Integer(),
            nullable=True,
            server_default="8192",
        ),
    )
    op.add_column(
        "ai_models",
        sa.Column(
            "is_default",
            sa.Boolean(),
            nullable=True,
            server_default="false",
        ),
    )
    op.add_column(
        "ai_models",
        sa.Column(
            "capabilities",
            postgresql.JSONB(),
            nullable=True,
            server_default='["chat"]',
        ),
    )
    op.add_column(
        "ai_models",
        sa.Column(
            "config",
            postgresql.JSONB(),
            nullable=True,
            server_default="{}",
        ),
    )

    # 插入默认的硅基流动模型配置
    op.execute(
        """
        INSERT INTO ai_models (id, provider, model_id, display_name, active, is_default, context_window, input_price_per_1k, output_price_per_1k, capabilities, updated_at)
        VALUES 
            (gen_random_uuid(), 'siliconflow', 'Pro/deepseek-ai/DeepSeek-V3.2', 'DeepSeek V3.2 (Pro)', true, true, 65536, 0.0014, 0.0028, '["chat"]', now()),
            (gen_random_uuid(), 'siliconflow', 'tencent/Hunyuan-MT-7B', 'Hunyuan MT 7B', true, false, 8192, 0.0005, 0.0010, '["chat"]', now())
        ON CONFLICT (model_id) DO NOTHING;
        """
    )


def downgrade():
    op.drop_column("ai_models", "config")
    op.drop_column("ai_models", "capabilities")
    op.drop_column("ai_models", "is_default")
    op.drop_column("ai_models", "context_window")
    op.drop_column("ai_models", "output_price_per_1k")
    op.drop_column("ai_models", "input_price_per_1k")
    op.drop_column("ai_models", "endpoint")
    op.drop_column("ai_models", "api_key_encrypted")

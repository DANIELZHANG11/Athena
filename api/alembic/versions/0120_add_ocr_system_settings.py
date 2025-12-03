"""Add OCR system settings defaults

Revision ID: 0120
Revises: 0119
Create Date: 2025-01-21

向 system_settings 表中添加 OCR 相关配置的默认值（按商业模型 V9.0 设计）:

OCR 收费模型:
1. 按"本"计费，按"页"风控
2. 页数阶梯规则:
   - ≤ 600页: 1个标准单位（优先扣免费额度）
   - 600-1000页: 2个标准单位（强制扣付费额度）
   - 1000-2000页: 3个标准单位（强制扣付费额度）
   - > 2000页: 拒绝服务
3. Pro 会员每月赠送 OCR 次数（月底清零）
4. 加油包 OCR 次数永久有效

这些配置用于动态控制 OCR 定价和限制，避免代码硬编码。
Admin 后台可修改这些配置。
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = '0120'
down_revision = '0119'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 添加 OCR 配置到 system_settings
    # 注意: system_settings.value 是 JSONB 类型，需要用 to_jsonb() 转换
    # 使用 INSERT ... ON CONFLICT DO NOTHING 来确保幂等性
    op.execute("""
        INSERT INTO system_settings (id, key, value)
        VALUES 
            -- OCR 页数阶梯配置 (JSON)
            (gen_random_uuid(), 'ocr_page_thresholds', '{"standard": 600, "double": 1000, "triple": 2000}'::jsonb),
            
            -- OCR 最大页数限制（超过此值拒绝服务）
            (gen_random_uuid(), 'ocr_max_pages', '2000'::jsonb),
            
            -- 免费用户每月 OCR 免费次数
            (gen_random_uuid(), 'ocr_monthly_free_quota', '3'::jsonb),
            
            -- Pro 会员每月赠送 OCR 次数（月底清零）
            (gen_random_uuid(), 'monthly_gift_ocr_count', '3'::jsonb),
            
            -- OCR 加油包单价（单位：分）
            (gen_random_uuid(), 'price_addon_ocr', '880'::jsonb),
            
            -- OCR 加油包包含次数
            (gen_random_uuid(), 'addon_ocr_count', '10'::jsonb),
            
            -- OCR 全局并发限制（单卡 3060 限制）
            (gen_random_uuid(), 'ocr_concurrency_limit', '1'::jsonb),
            
            -- OCR 预估每本书处理时间（分钟）
            (gen_random_uuid(), 'ocr_minutes_per_book', '5'::jsonb)
        ON CONFLICT (key) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM system_settings 
        WHERE key IN (
            'ocr_page_thresholds',
            'ocr_max_pages',
            'ocr_monthly_free_quota',
            'monthly_gift_ocr_count',
            'price_addon_ocr',
            'addon_ocr_count',
            'ocr_concurrency_limit',
            'ocr_minutes_per_book'
        )
    """)


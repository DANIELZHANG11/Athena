import asyncio
import os
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# Use the same DB URL as the app
DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+asyncpg://athena:athena_dev@postgres:5432/athena"
)

async def apply_schema():
    engine = create_async_engine(DATABASE_URL, echo=True)
    async with engine.begin() as conn:
        print("Applying V9.1 Schema Changes...")

        # 1. Create user_stats table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS user_stats (
                user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                storage_used BIGINT DEFAULT 0,
                book_count INTEGER DEFAULT 0,
                invite_count INTEGER DEFAULT 0,
                extra_storage_quota BIGINT DEFAULT 0,
                extra_book_quota INTEGER DEFAULT 0,
                updated_at TIMESTAMPTZ DEFAULT now()
            );
        """))
        print("Created user_stats table.")

        # 2. Create invites table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS invites (
                id UUID PRIMARY KEY,
                inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                invitee_id UUID REFERENCES users(id) ON DELETE SET NULL,
                invite_code VARCHAR(50) UNIQUE NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                reward_granted BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT now(),
                completed_at TIMESTAMPTZ
            );
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(invite_code);
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_invites_inviter ON invites(inviter_id);
        """))
        print("Created invites table.")

        # 3. Alter pricing_rules table
        # Check if columns exist first to avoid errors if re-run
        await conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pricing_rules' AND column_name='platform') THEN
                    ALTER TABLE pricing_rules ADD COLUMN platform VARCHAR(20) DEFAULT 'web';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pricing_rules' AND column_name='sku_id') THEN
                    ALTER TABLE pricing_rules ADD COLUMN sku_id VARCHAR(100);
                END IF;
            END $$;
        """))
        print("Updated pricing_rules table.")

        # 4. Alter users table
        await conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='membership_expire_at') THEN
                    ALTER TABLE users ADD COLUMN membership_expire_at TIMESTAMPTZ;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='monthly_gift_reset_at') THEN
                    ALTER TABLE users ADD COLUMN monthly_gift_reset_at TIMESTAMPTZ;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='free_ocr_usage') THEN
                    ALTER TABLE users ADD COLUMN free_ocr_usage INTEGER DEFAULT 0;
                END IF;
            END $$;
        """))
        print("Updated users table.")

        # 5. Alter ocr_jobs table
        await conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ocr_jobs' AND column_name='page_count') THEN
                    ALTER TABLE ocr_jobs ADD COLUMN page_count INTEGER DEFAULT 0;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ocr_jobs' AND column_name='deduction_strategy') THEN
                    ALTER TABLE ocr_jobs ADD COLUMN deduction_strategy VARCHAR(50);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ocr_jobs' AND column_name='deduction_amount') THEN
                    ALTER TABLE ocr_jobs ADD COLUMN deduction_amount INTEGER DEFAULT 0;
                END IF;
            END $$;
        """))
        print("Updated ocr_jobs table.")
        
        # 6. Initialize default system settings if not exist
        await conn.execute(text("""
            INSERT INTO system_settings (id, key, value) VALUES 
            (gen_random_uuid(), 'free_book_limit', '50'::jsonb),
            (gen_random_uuid(), 'free_storage_limit', '1073741824'::jsonb),
            (gen_random_uuid(), 'invite_bonus_storage', '524288000'::jsonb),
            (gen_random_uuid(), 'invite_bonus_books', '5'::jsonb),
            (gen_random_uuid(), 'ocr_page_thresholds', '{"standard": 600, "double": 1000, "triple": 2000}'::jsonb),
            (gen_random_uuid(), 'ocr_concurrency_limit', '1'::jsonb),
            (gen_random_uuid(), 'addon_packages', '[]'::jsonb)
            ON CONFLICT (key) DO NOTHING;
        """))
        print("Initialized system settings.")

    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(apply_schema())

from alembic import op

revision = "0016_owner_to_user_cleanup"
down_revision = "0015_tsv_triggers"
branch_labels = None
depends_on = None

def upgrade():
    op.execute(
        """
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dictionary_packages' AND column_name='owner_id') THEN
            ALTER TABLE dictionary_packages RENAME COLUMN owner_id TO user_id;
          END IF;
        END $$;
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dict_history' AND column_name='owner_id') THEN
            ALTER TABLE dict_history RENAME COLUMN owner_id TO user_id;
          END IF;
        END $$;
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='translation_history' AND column_name='owner_id') THEN
            ALTER TABLE translation_history RENAME COLUMN owner_id TO user_id;
          END IF;
        END $$;
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tts_requests' AND column_name='owner_id') THEN
            ALTER TABLE tts_requests RENAME COLUMN owner_id TO user_id;
          END IF;
        END $$;
        """
    )

def downgrade():
    op.execute(
        """
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dictionary_packages' AND column_name='user_id') THEN
            ALTER TABLE dictionary_packages RENAME COLUMN user_id TO owner_id;
          END IF;
        END $$;
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dict_history' AND column_name='user_id') THEN
            ALTER TABLE dict_history RENAME COLUMN user_id TO owner_id;
          END IF;
        END $$;
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='translation_history' AND column_name='user_id') THEN
            ALTER TABLE translation_history RENAME COLUMN user_id TO owner_id;
          END IF;
        END $$;
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tts_requests' AND column_name='user_id') THEN
            ALTER TABLE tts_requests RENAME COLUMN user_id TO owner_id;
          END IF;
        END $$;
        """
    )
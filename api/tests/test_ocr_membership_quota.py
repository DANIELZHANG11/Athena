from unittest.mock import MagicMock

import httpx
import pytest

from api.app.main import app


@pytest.mark.asyncio
async def test_ocr_quota_membership(monkeypatch):
    monkeypatch.setenv("DEV_MODE", "true")
    mock_minio = MagicMock()
    mock_minio.bucket_exists.return_value = True
    mock_minio.make_bucket.return_value = None
    mock_minio.presigned_put_object.return_value = "http://fake-upload-url.com"
    monkeypatch.setattr("api.app.storage.get_s3", lambda: mock_minio)
    monkeypatch.setattr("api.app.admin_panel._require_admin", lambda uid: True)
    monkeypatch.setattr("api.app.admin_panel._require_admin", lambda uid: True)
    monkeypatch.setattr("api.app.pricing._require_admin", lambda uid: True)
    
    # Mock Celery send_task to avoid Redis connection
    mock_send_task = MagicMock()
    monkeypatch.setattr("api.app.ocr.celery_app.send_task", mock_send_task)
    
    # Mock Redis for concurrency check
    mock_redis = MagicMock()
    mock_redis.scard.return_value = 0
    mock_redis.sadd.return_value = 1
    monkeypatch.setattr("api.app.ocr.r", mock_redis)

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post(
            "/api/v1/auth/email/send-code", json={"email": "user@athena.local"}
        )
        code = r.json()["data"]["dev_code"]
        r = await client.post(
            "/api/v1/auth/email/verify-code",
            json={"email": "user@athena.local", "code": code},
        )
        auth_data = r.json()["data"]
        token = auth_data["tokens"]["access_token"]
        user_id = auth_data["user"]["id"]
        h = {"Authorization": f"Bearer {token}"}

        r = await client.put(
            "/api/v1/admin/system/settings",
            headers=h,
            json={"membership_tiers": {"PRO": {"free_ocr_pages": 10}}},
        )
        assert r.status_code == 200

        r = await client.post(
            "/api/v1/admin/pricing/rules",
            headers=h,
            json={
                "service_type": "OCR",
                "unit_type": "PAGES",
                "unit_size": 1,
                "price_amount": 0.05,
                "currency": "CNY",
            },
        )
        assert r.status_code == 200

        # Create a book directly in database for testing
        import uuid
        from api.app.db import engine as db_engine
        from sqlalchemy import text as sql_text
        
        mock_book_id = str(uuid.uuid4())
        async with db_engine.begin() as conn:
            # Set session user for RLS if needed
            await conn.execute(
                sql_text("SELECT set_config('app.user_id', :uid, true)"),
                {"uid": user_id}  # Get user_id from earlier auth
            )
            # Insert book record
            await conn.execute(
                sql_text("""
                    INSERT INTO books (id, user_id, title, author, original_format, minio_key, size, meta)
                    VALUES (
                        cast(:id as uuid),
                        cast(:uid as uuid),
                        :title,
                        'Test Author',
                        'pdf',
                        'test/book.pdf',
                        1024,
                        '{"page_count": 3}'::jsonb
                    )
                """),
                {
                    "id": mock_book_id,
                    "uid": user_id,
                    "title": "Test Book for OCR"
                }
            )
        
        # Grant credits BEFORE OCR job to ensure sufficient balance
        grant_res = await client.post(
            "/api/v1/billing/debug/grant-credits",
            headers=h,
            json={"kind": "credits", "amount": 10000},
        )
        assert grant_res.status_code == 200, f"Grant credits failed: {grant_res.json()}"

        # Check ledger before OCR job
        r = await client.get("/api/v1/billing/ledger", headers=h)
        before = (
            len(r.json()["data"]["data"])
            if isinstance(r.json()["data"], dict)
            else len(r.json()["data"])
        )

        r = await client.post(
            "/api/v1/ocr/jobs", headers=h, json={"book_id": mock_book_id}
        )
        print(f"OCR job response: status={r.status_code}, body={r.json()}")
        assert r.status_code == 200, f"OCR job init failed: {r.json()}"
        jid = r.json()["data"]["job_id"]
        
        # Check ledger after OCR job (should have deduction entry)
        r = await client.get("/api/v1/billing/ledger", headers=h)
        after = (
            len(r.json()["data"]["data"])
            if isinstance(r.json()["data"], dict)
            else len(r.json()["data"])
        )
        assert after >= before + 1

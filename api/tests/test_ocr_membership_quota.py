import os
import pytest
import httpx
from unittest.mock import MagicMock
from api.app.main import app


@pytest.mark.asyncio
async def test_ocr_quota_membership(monkeypatch):
    monkeypatch.setenv("DEV_MODE", "true")
    mock_minio = MagicMock()
    mock_minio.bucket_exists.return_value = True
    mock_minio.make_bucket.return_value = None
    mock_minio.presigned_put_object.return_value = "http://fake-upload-url.com"
    monkeypatch.setattr('api.app.storage.get_s3', lambda: mock_minio)
    monkeypatch.setattr("api.app.admin_panel._require_admin", lambda uid: True)
    monkeypatch.setattr("api.app.pricing._require_admin", lambda uid: True)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/api/v1/auth/email/send-code", json={"email": "user@athena.local"})
        code = r.json()["data"]["dev_code"]
        r = await client.post("/api/v1/auth/email/verify-code", json={"email": "user@athena.local", "code": code})
        token = r.json()["data"]["tokens"]["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        r = await client.put("/api/v1/admin/system/settings", headers=h, json={"membership_tiers": {"PRO": {"free_ocr_pages": 10}}})
        assert r.status_code == 200

        r = await client.post("/api/v1/admin/pricing/rules", headers=h, json={"service_type": "OCR", "unit_type": "PAGES", "unit_size": 1, "price_amount": 0.05, "currency": "CNY"})
        assert r.status_code == 200

        r = await client.post("/api/v1/ocr/jobs/init", headers=h, json={"filename": "a.png"})
        jid = r.json()["data"]["id"]
        await client.post("/api/v1/billing/debug/grant-credits", headers=h, json={"kind": "credits", "amount": 10000})
        r = await client.get("/api/v1/billing/ledger", headers=h)
        before = len(r.json()["data"]["data"]) if isinstance(r.json()["data"], dict) else len(r.json()["data"]) 
        r = await client.post("/api/v1/ocr/jobs/complete", headers=h, json={"id": jid, "pages": 3})
        assert r.status_code == 200
        r = await client.get("/api/v1/billing/ledger", headers=h)
        after = len(r.json()["data"]["data"]) if isinstance(r.json()["data"], dict) else len(r.json()["data"]) 
        assert after >= before + 1
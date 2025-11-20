import os
import pytest
import httpx
from api.app.main import app


@pytest.mark.asyncio
async def test_providers_crud(monkeypatch):
    monkeypatch.setenv("DEV_MODE", "true")
    monkeypatch.setattr("api.app.admin_panel._require_admin", lambda uid: True)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/api/v1/auth/email/send-code", json={"email": "admin@athena.local"})
        assert r.status_code == 200
        code = r.json()["data"]["dev_code"]
        r = await client.post("/api/v1/auth/email/verify-code", json={"email": "admin@athena.local", "code": code})
        assert r.status_code == 200
        token = r.json()["data"]["tokens"]["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        for st in ("OCR", "VECTORIZE", "AI", "PAYMENT"):
            r = await client.post("/api/v1/admin/providers", headers=h, json={"service_type": st, "name": f"provider-{st}", "endpoint": "http://example", "config": {"k": 1}, "is_active": True, "priority": 1})
            assert r.status_code == 200

        r = await client.get("/api/v1/admin/providers", headers=h, params={"service_type": "OCR"})
        assert r.status_code == 200
        rows = r.json()["data"]
        assert len(rows) >= 1
        pid = rows[0]["id"]
        etag = rows[0]["etag"]
        r = await client.patch(f"/api/v1/admin/providers/{pid}", headers={**h, "If-Match": etag}, json={"is_active": False, "priority": 2})
        assert r.status_code == 200
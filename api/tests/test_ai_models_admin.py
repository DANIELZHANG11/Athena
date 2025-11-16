import os
import pytest
import httpx
from api.app.main import app


@pytest.mark.asyncio
async def test_ai_models_upsert_list(monkeypatch):
    monkeypatch.setenv("DEV_MODE", "true")
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/api/v1/auth/email/send-code", json={"email": "ai@athena.local"})
        code = r.json()["data"]["dev_code"]
        r = await client.post("/api/v1/auth/email/verify-code", json={"email": "ai@athena.local", "code": code})
        token = r.json()["data"]["tokens"]["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        r = await client.post("/api/v1/admin/models", headers=h, json={"provider": "openrouter", "model_id": "gpt-4o", "display_name": "GPT-4o", "active": True})
        assert r.status_code == 200
        r = await client.post("/api/v1/admin/models", headers=h, json={"provider": "openrouter", "model_id": "gpt-4o", "display_name": "GPT-4o", "active": False})
        assert r.status_code == 200
        r = await client.get("/api/v1/admin/models", headers=h)
        assert r.status_code == 200
        rows = r.json()["data"]
        assert any(it["model_id"] == "gpt-4o" for it in rows)

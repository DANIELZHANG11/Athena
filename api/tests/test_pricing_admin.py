import os
import pytest
import httpx
from api.app.main import app


@pytest.mark.asyncio
async def test_pricing_admin_and_user_rules(monkeypatch):
    monkeypatch.setenv("DEV_MODE", "true")
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/api/v1/auth/email/send-code", json={"email": "op@athena.local"})
        code = r.json()["data"]["dev_code"]
        r = await client.post("/api/v1/auth/email/verify-code", json={"email": "op@athena.local", "code": code})
        token = r.json()["data"]["tokens"]["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        r = await client.post("/api/v1/admin/pricing/rules", headers=h, json={"service_type": "OCR", "unit_type": "PAGES", "unit_size": 1, "price_amount": 0.05, "currency": "CNY", "region": "CN", "remark_template": "每{unit_size}页{price_amount}{currency}"})
        assert r.status_code == 200
        rid = r.json()["data"]["id"]
        r = await client.get("/api/v1/admin/pricing/rules", headers=h)
        rows = r.json()["data"]
        ver = None
        for it in rows:
            if it["id"] == rid:
                ver = it["version"]
                break
        assert ver is not None
        r = await client.patch(f"/api/v1/admin/pricing/rules/{rid}", headers=h, params={"if_match": f"W/\"{ver}\""}, json={"price_amount": 0.06})
        assert r.status_code == 200

        r = await client.get("/api/v1/pricing/rules", params={"service_type": "OCR", "region": "CN"})
        assert r.status_code == 200
        remark = r.json()["data"][0]["remark"]
        assert "0.06" in remark
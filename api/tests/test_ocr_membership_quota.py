import os
import pytest
import httpx
from api.app.main import app


@pytest.mark.asyncio
async def test_ocr_quota_membership():
    os.environ["DEV_MODE"] = "true"
    async with httpx.AsyncClient(app=app, base_url="http://test") as client:
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
        r = await client.get("/api/v1/billing/ledger", headers=h)
        before = len(r.json()["data"]["data"]) if isinstance(r.json()["data"], dict) else len(r.json()["data"]) 
        r = await client.post("/api/v1/ocr/jobs/complete", headers=h, json={"id": jid, "pages": 3})
        assert r.status_code == 200
        r = await client.get("/api/v1/billing/ledger", headers=h)
        after = len(r.json()["data"]["data"]) if isinstance(r.json()["data"], dict) else len(r.json()["data"]) 
        assert after == before
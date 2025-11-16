import os
import hmac
import hashlib
import json
import pytest
import httpx
from api.app.main import app


@pytest.mark.asyncio
async def test_exchange_wallet_multicurrency():
    os.environ["DEV_MODE"] = "true"
    async with httpx.AsyncClient(app=app, base_url="http://test") as client:
        r = await client.post("/api/v1/auth/email/send-code", json={"email": "test@athena.local"})
        assert r.status_code == 200
        dev_code = r.json()["data"].get("dev_code")
        assert dev_code
        r = await client.post("/api/v1/auth/email/verify-code", json={"email": "test@athena.local", "code": dev_code})
        assert r.status_code == 200
        tokens = r.json()["data"]["tokens"]
        auth = {"Authorization": f"Bearer {tokens['access_token']}"}

        settings = {
            "wallet_exchange_rate": {"CNY": 100, "USD": 20000, "default": 100}
        }
        r = await client.put("/api/v1/admin/system/settings", headers=auth, json=settings)
        assert r.status_code == 200

        os.environ["PAY_FAKE_WEBHOOK_SECRET"] = "s1"
        payload = {"event_id": "evt_1", "session_id": None, "amount": 1000, "status": "succeeded"}
        r = await client.post("/api/v1/billing/sessions", headers=auth, json={"gateway": "fake", "amount": 1000, "currency": "CNY"})
        assert r.status_code == 200
        sid = r.json()["data"]["id"]
        payload["session_id"] = sid
        body = json.dumps(payload).encode("utf-8")
        sig = hmac.new(b"s1", body, hashlib.sha256).hexdigest()
        r = await client.post(f"/api/v1/billing/webhook/fake", data=body, headers={"x_signature": sig, "Content-Type": "application/json"})
        assert r.status_code == 200

        r = await client.get("/api/v1/billing/balance", headers=auth)
        assert r.status_code == 200
        bal = r.json()["data"]["balance"]
        assert bal >= 1000

        r = await client.post("/api/v1/billing/exchange", headers=auth, json={"direction": "credits_to_wallet", "amount": 1000})
        assert r.status_code == 200
        r = await client.get("/api/v1/billing/balance", headers=auth)
        assert r.status_code == 200
        wallet = r.json()["data"]["wallet_amount"]
        assert wallet >= 10.0
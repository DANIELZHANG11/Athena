import pytest
import httpx
import json
import uuid
from unittest.mock import MagicMock
from api.app.main import app

@pytest.mark.asyncio
async def test_admin_billing_flow(monkeypatch):
    # Mock Redis (used in some places implicitly or explicitly)
    mock_redis = MagicMock()
    monkeypatch.setattr("api.app.billing.r", mock_redis, raising=False) # billing might not use redis directly but good to be safe
    
    # Mock Webhook Signature Verification
    monkeypatch.setattr("api.app.billing._sig_ok", lambda s, b, sig: True)

    # Enable Dev Mode for Grant Credits
    monkeypatch.setenv("DEV_MODE", "true")

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Auth & Admin Setup
        r = await client.post("/api/v1/auth/email/send-code", json={"email": "admin@test.com"})
        code = r.json()["data"]["dev_code"]
        r = await client.post("/api/v1/auth/email/verify-code", json={"email": "admin@test.com", "code": code})
        auth_data = r.json()["data"]
        token = auth_data["tokens"]["access_token"]
        user_id = auth_data["user"]["id"]
        h = {"Authorization": f"Bearer {token}"}

        # Set ADMIN_USER_ID to current user
        monkeypatch.setenv("ADMIN_USER_ID", user_id)

        # --- Admin Tests ---

        # List Users
        r = await client.get("/api/v1/admin/users", headers=h)
        assert r.status_code == 200
        users = r.json()["data"]
        assert any(u["id"] == user_id for u in users)
        user_etag = next(u["etag"] for u in users if u["id"] == user_id)

        # Update User
        r = await client.patch(f"/api/v1/admin/users/{user_id}", headers={**h, "If-Match": user_etag}, json={"display_name": "Admin User"})
        assert r.status_code == 200
        
        # Gateways CRUD
        r = await client.post("/api/v1/admin/gateways", headers=h, json={"name": "stripe", "config": {"key": "val"}, "is_active": True})
        assert r.status_code == 200
        gid = r.json()["data"]["id"]

        r = await client.get("/api/v1/admin/gateways", headers=h)
        assert r.status_code == 200
        gateways = r.json()["data"]
        assert any(g["id"] == gid for g in gateways)
        g_etag = next(g["etag"] for g in gateways if g["id"] == gid)

        r = await client.patch(f"/api/v1/admin/gateways/{gid}", headers={**h, "If-Match": g_etag}, json={"is_active": False})
        assert r.status_code == 200

        # Translations CRUD
        r = await client.post("/api/v1/admin/translations", headers=h, json={"namespace": "common", "key": "hello", "lang": "en", "value": "Hello"})
        assert r.status_code == 200
        tid = r.json()["data"]["id"]

        r = await client.get("/api/v1/admin/translations?namespace=common", headers=h)
        assert r.status_code == 200
        trans = r.json()["data"]
        assert any(t["id"] == tid for t in trans)
        t_etag = next(t["etag"] for t in trans if t["id"] == tid)

        r = await client.patch(f"/api/v1/admin/translations/{tid}", headers={**h, "If-Match": t_etag}, json={"value": "Hi"})
        assert r.status_code == 200

        r = await client.delete(f"/api/v1/admin/translations/{tid}", headers=h)
        assert r.status_code == 200

        # Regional Prices CRUD
        r = await client.post("/api/v1/admin/pricing/regions", headers=h, json={"plan_code": "pro_monthly", "currency": "USD", "period": "month", "amount_minor": 999})
        assert r.status_code == 200
        
        r = await client.get("/api/v1/admin/pricing/regions", headers=h)
        assert r.status_code == 200
        prices = r.json()["data"]
        assert len(prices) > 0

        # Admin Credit Views
        r = await client.get("/api/v1/admin/credits/accounts", headers=h)
        assert r.status_code == 200
        r = await client.get("/api/v1/admin/credits/ledger", headers=h)
        assert r.status_code == 200

        # --- Billing Tests ---

        # Grant Credits (Debug)
        r = await client.post("/api/v1/billing/debug/grant-credits", headers=h, json={"kind": "wallet", "amount": 100})
        assert r.status_code == 200
        r = await client.post("/api/v1/billing/debug/grant-credits", headers=h, json={"kind": "credits", "amount": 1000})
        assert r.status_code == 200

        # Get Balance
        r = await client.get("/api/v1/billing/balance", headers=h)
        assert r.status_code == 200
        bal = r.json()["data"]
        assert bal["balance"] >= 1000
        assert bal["wallet_amount"] >= 100

        # List Products
        r = await client.get("/api/v1/billing/products", headers=h)
        assert r.status_code == 200

        # Create Session
        r = await client.post("/api/v1/billing/sessions", headers=h, json={"gateway": "stripe", "amount": 1000})
        assert r.status_code == 200
        sid = r.json()["data"]["id"]

        # Webhook (Mocked)
        webhook_payload = {
            "session_id": sid,
            "status": "succeeded",
            "amount": 1000,
            "external_id": "ext_123"
        }
        r = await client.post("/api/v1/billing/webhook/stripe", json=webhook_payload, headers={"x-signature": "fake"})
        assert r.status_code == 200

        # Verify Balance Increase after Webhook
        r = await client.get("/api/v1/billing/balance", headers=h)
        assert r.status_code == 200
        # Balance should have increased by 1000 from webhook + 1000 from grant = 2000+
        assert r.json()["data"]["balance"] >= 2000

        # Consume Credits
        r = await client.post("/api/v1/billing/consume", headers=h, json={"amount": 100, "reason": "test"})
        assert r.status_code == 200

        # Exchange (Wallet -> Credits)
        # First ensure wallet balance (granted 100 earlier)
        r = await client.post("/api/v1/billing/exchange", headers=h, json={"direction": "wallet_to_credits", "amount": 10})
        assert r.status_code == 200

        # Exchange (Credits -> Wallet)
        r = await client.post("/api/v1/billing/exchange", headers=h, json={"direction": "credits_to_wallet", "amount": 1000})
        assert r.status_code == 200

        # Ledger
        r = await client.get("/api/v1/billing/ledger", headers=h)
        assert r.status_code == 200
        ledger = r.json()["data"]
        assert len(ledger) > 0

        # IAP Verify (Mock)
        r = await client.post("/api/v1/billing/iap/verify", headers=h, json={"platform": "apple", "receipt": "fake-receipt-long-enough"})
        assert r.status_code == 200

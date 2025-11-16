import os
import hmac
import hashlib
import json
from fastapi.testclient import TestClient
from api.app.main import app


def test_exchange_wallet_multicurrency():
    os.environ["DEV_MODE"] = "true"
    client = TestClient(app, raise_server_exceptions=False)

    # 1) 登录获取令牌
    r = client.post("/api/v1/auth/email/send-code", json={"email": "test@athena.local"})
    assert r.status_code == 200
    dev_code = r.json()["data"].get("dev_code")
    assert dev_code
    r = client.post("/api/v1/auth/email/verify-code", json={"email": "test@athena.local", "code": dev_code})
    assert r.status_code == 200
    tokens = r.json()["data"]["tokens"]
    auth = {"Authorization": f"Bearer {tokens['access_token']}"}

    # 2) 配置多币种汇率映射
    settings = {
        "wallet_exchange_rate": {"CNY": 100, "USD": 20000, "default": 100}
    }
    r = client.put("/api/v1/admin/system/settings", headers=auth, json=settings)
    assert r.status_code == 200

    # 3) 充值积分（通过 webhook 入账）
    os.environ["PAY_FAKE_WEBHOOK_SECRET"] = "s1"
    payload = {"event_id": "evt_1", "session_id": None, "amount": 1000, "status": "succeeded"}
    # 创建支付会话以获取 session_id
    r = client.post("/api/v1/billing/sessions", headers=auth, json={"gateway": "fake", "amount": 1000, "currency": "CNY"})
    assert r.status_code == 200
    sid = r.json()["data"]["id"]
    payload["session_id"] = sid
    body = json.dumps(payload).encode("utf-8")
    sig = hmac.new(b"s1", body, hashlib.sha256).hexdigest()
    r = client.post(f"/api/v1/billing/webhook/fake", data=body, headers={"x_signature": sig, "Content-Type": "application/json"})
    assert r.status_code == 200

    # 确认入账到余额（credits）
    r = client.get("/api/v1/billing/balance", headers=auth)
    assert r.status_code == 200
    bal = r.json()["data"]["balance"]
    assert bal >= 1000

    # 4) 积分兑换钱包（按 CNY:100 credits = 1 元）
    r = client.post("/api/v1/billing/exchange", headers=auth, json={"direction": "credits_to_wallet", "amount": 1000})
    assert r.status_code == 200
    r = client.get("/api/v1/billing/balance", headers=auth)
    assert r.status_code == 200
    wallet = r.json()["data"]["wallet_amount"]
    # 1000 credits / 100 = 10.00 元
    assert wallet >= 10.0
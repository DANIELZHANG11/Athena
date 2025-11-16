import os
from fastapi.testclient import TestClient
from api.app.main import app


def test_ocr_quota_membership():
    os.environ["DEV_MODE"] = "true"
    c = TestClient(app, raise_server_exceptions=False)
    r = c.post("/api/v1/auth/email/send-code", json={"email": "user@athena.local"})
    code = r.json()["data"]["dev_code"]
    r = c.post("/api/v1/auth/email/verify-code", json={"email": "user@athena.local", "code": code})
    token = r.json()["data"]["tokens"]["access_token"]
    h = {"Authorization": f"Bearer {token}"}

    r = c.put("/api/v1/admin/system/settings", headers=h, json={"membership_tiers": {"PRO": {"free_ocr_pages": 10}}})
    assert r.status_code == 200

    r = c.post("/api/v1/admin/pricing/rules", headers=h, json={"service_type": "OCR", "unit_type": "PAGES", "unit_size": 1, "price_amount": 0.05, "currency": "CNY"})
    assert r.status_code == 200

    # 初始化OCR任务并完成，页数在免费额度之内，应无账本扣费
    r = c.post("/api/v1/ocr/jobs/init", headers=h, json={"filename": "a.png"})
    jid = r.json()["data"]["id"]
    r = c.get("/api/v1/billing/ledger", headers=h)
    before = len(r.json()["data"]["data"]) if isinstance(r.json()["data"], dict) else len(r.json()["data"])  # 兼容结构
    r = c.post("/api/v1/ocr/jobs/complete", headers=h, json={"id": jid, "pages": 3})
    assert r.status_code == 200
    r = c.get("/api/v1/billing/ledger", headers=h)
    after = len(r.json()["data"]["data"]) if isinstance(r.json()["data"], dict) else len(r.json()["data"])  # 兼容结构
    assert after == before
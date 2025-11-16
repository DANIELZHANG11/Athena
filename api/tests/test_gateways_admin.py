import os
from fastapi.testclient import TestClient
from api.app.main import app


def test_payment_gateways_crud():
    os.environ["DEV_MODE"] = "true"
    c = TestClient(app, raise_server_exceptions=False)
    r = c.post("/api/v1/auth/email/send-code", json={"email": "pay@athena.local"})
    code = r.json()["data"]["dev_code"]
    r = c.post("/api/v1/auth/email/verify-code", json={"email": "pay@athena.local", "code": code})
    token = r.json()["data"]["tokens"]["access_token"]
    h = {"Authorization": f"Bearer {token}"}

    r = c.post("/api/v1/admin/gateways", headers=h, json={"name": "fake", "config": {"secret": "s1"}, "is_active": True})
    assert r.status_code == 200
    r = c.get("/api/v1/admin/gateways", headers=h)
    rows = r.json()["data"]
    assert len(rows) >= 1
    gid = rows[0]["id"]
    etag = rows[0]["etag"]
    r = c.patch(f"/api/v1/admin/gateways/{gid}", headers={**h, "If-Match": etag}, json={"name": "fake2", "is_active": False})
    assert r.status_code == 200
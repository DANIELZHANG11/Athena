import os
from fastapi.testclient import TestClient
from api.app.main import app


def test_providers_crud():
    os.environ["DEV_MODE"] = "true"
    c = TestClient(app, raise_server_exceptions=False)
    r = c.post("/api/v1/auth/email/send-code", json={"email": "admin@athena.local"})
    assert r.status_code == 200
    code = r.json()["data"]["dev_code"]
    r = c.post("/api/v1/auth/email/verify-code", json={"email": "admin@athena.local", "code": code})
    assert r.status_code == 200
    token = r.json()["data"]["tokens"]["access_token"]
    h = {"Authorization": f"Bearer {token}"}

    for st in ("OCR", "VECTORIZE", "AI", "PAYMENT"):
        r = c.post("/api/v1/admin/providers", headers=h, json={"service_type": st, "name": f"provider-{st}", "endpoint": "http://example", "config": {"k": 1}, "is_active": True, "priority": 1})
        assert r.status_code == 200

    r = c.get("/api/v1/admin/providers", headers=h, params={"service_type": "OCR"})
    assert r.status_code == 200
    rows = r.json()["data"]
    assert len(rows) >= 1
    pid = rows[0]["id"]
    etag = rows[0]["etag"]
    r = c.patch(f"/api/v1/admin/providers/{pid}", headers={**h, "If-Match": etag}, json={"is_active": False, "priority": 2})
    assert r.status_code == 200
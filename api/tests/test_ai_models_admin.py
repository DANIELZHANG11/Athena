import os
from fastapi.testclient import TestClient
from api.app.main import app


def test_ai_models_upsert_list():
    os.environ["DEV_MODE"] = "true"
    c = TestClient(app, raise_server_exceptions=False)
    r = c.post("/api/v1/auth/email/send-code", json={"email": "ai@athena.local"})
    code = r.json()["data"]["dev_code"]
    r = c.post("/api/v1/auth/email/verify-code", json={"email": "ai@athena.local", "code": code})
    token = r.json()["data"]["tokens"]["access_token"]
    h = {"Authorization": f"Bearer {token}"}

    r = c.post("/api/v1/admin/models", headers=h, json={"provider": "openrouter", "model_id": "gpt-4o", "display_name": "GPT-4o", "active": True})
    assert r.status_code == 200
    r = c.post("/api/v1/admin/models", headers=h, json={"provider": "openrouter", "model_id": "gpt-4o", "display_name": "GPT-4o", "active": False})
    assert r.status_code == 200
    r = c.get("/api/v1/admin/models", headers=h)
    assert r.status_code == 200
    rows = r.json()["data"]
    assert any(it["model_id"] == "gpt-4o" for it in rows)
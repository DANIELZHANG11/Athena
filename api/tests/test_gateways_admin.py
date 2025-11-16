import os
import pytest
import httpx
from api.app.main import app


@pytest.mark.asyncio
async def test_payment_gateways_crud():
    os.environ["DEV_MODE"] = "true"
    async with httpx.AsyncClient(app=app, base_url="http://test") as client:
        r = await client.post("/api/v1/auth/email/send-code", json={"email": "pay@athena.local"})
        code = r.json()["data"]["dev_code"]
        r = await client.post("/api/v1/auth/email/verify-code", json={"email": "pay@athena.local", "code": code})
        token = r.json()["data"]["tokens"]["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        r = await client.post("/api/v1/admin/gateways", headers=h, json={"name": "fake", "config": {"secret": "s1"}, "is_active": True})
        assert r.status_code == 200
        r = await client.get("/api/v1/admin/gateways", headers=h)
        rows = r.json()["data"]
        assert len(rows) >= 1
        gid = rows[0]["id"]
        etag = rows[0]["etag"]
        r = await client.patch(f"/api/v1/admin/gateways/{gid}", headers={**h, "If-Match": etag}, json={"name": "fake2", "is_active": False})
        assert r.status_code == 200
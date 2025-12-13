import httpx
import pytest

from api.app.main import app

# NOTE: Admin API 测试保留 REST 调用是合理的，因为管理后台本身就是 Web-First。
# APP-FIRST 原则只适用于用户面向的功能（书籍/笔记/阅读进度等）。
# 参考: 09_APP-FIRST架构改造计划.md Section 1 - “不在范围: Auth/Billing 功能”

@pytest.mark.asyncio
async def test_providers_crud(monkeypatch):
    monkeypatch.setenv("DEV_MODE", "true")
    monkeypatch.setattr("api.app.admin_panel._require_admin", lambda uid: True)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post(
            "/api/v1/auth/email/send-code", json={"email": "admin@athena.local"}
        )
        assert r.status_code == 200
        code = r.json()["data"]["dev_code"]
        r = await client.post(
            "/api/v1/auth/email/verify-code",
            json={"email": "admin@athena.local", "code": code},
        )
        assert r.status_code == 200
        token = r.json()["data"]["tokens"]["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        for st in ("OCR", "VECTORIZE", "AI", "PAYMENT"):
            r = await client.post(
                "/api/v1/admin/providers",
                headers=h,
                json={
                    "service_type": st,
                    "name": f"provider-{st}",
                    "endpoint": "http://example",
                    "config": {"k": 1},
                    "is_active": True,
                    "priority": 1,
                },
            )
            assert r.status_code == 200

        r = await client.get(
            "/api/v1/admin/providers", headers=h, params={"service_type": "OCR"}
        )
        assert r.status_code == 200
        rows = r.json()["data"]
        assert len(rows) >= 1
        pid = rows[0]["id"]
        etag = rows[0]["etag"]
        r = await client.patch(
            f"/api/v1/admin/providers/{pid}",
            headers={**h, "If-Match": etag},
            json={"is_active": False, "priority": 2},
        )
        assert r.status_code == 200

import httpx
import pytest

from api.app.main import app

# NOTE: Admin API 测试保留 REST 调用是合理的，因为管理后台本身就是 Web-First。
# APP-FIRST 原则只适用于用户面向的功能（书籍/笔记/阅读进度等）。
# 参考: 09_APP-FIRST架构改造计划.md Section 1 - “不在范围: Auth/Billing 功能、AI 对话协议”

@pytest.mark.asyncio
async def test_ai_models_upsert_list(monkeypatch):
    monkeypatch.setenv("DEV_MODE", "true")
    monkeypatch.setattr("api.app.admin_panel._require_admin", lambda uid: True)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post(
            "/api/v1/auth/email/send-code", json={"email": "ai@athena.local"}
        )
        code = r.json()["data"]["dev_code"]
        r = await client.post(
            "/api/v1/auth/email/verify-code",
            json={"email": "ai@athena.local", "code": code},
        )
        token = r.json()["data"]["tokens"]["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        r = await client.post(
            "/api/v1/admin/models",
            headers=h,
            json={
                "provider": "openrouter",
                "model_id": "gpt-4o",
                "display_name": "GPT-4o",
                "active": True,
            },
        )
        assert r.status_code == 200
        r = await client.post(
            "/api/v1/admin/models",
            headers=h,
            json={
                "provider": "openrouter",
                "model_id": "gpt-4o",
                "display_name": "GPT-4o",
                "active": False,
            },
        )
        assert r.status_code == 200
        r = await client.get("/api/v1/admin/models", headers=h)
        assert r.status_code == 200
        rows = r.json()["data"]
        assert any(it["model_id"] == "gpt-4o" for it in rows)

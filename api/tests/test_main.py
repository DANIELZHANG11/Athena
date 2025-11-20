import httpx
import pytest

from api.app.main import app


@pytest.mark.asyncio
async def test_health():
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/health")
        assert r.status_code == 200
        assert r.json().get("status") == "ok"


@pytest.mark.asyncio
async def test_root():
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/")
        assert r.status_code == 200
        j = r.json()
        assert j.get("status") == "ok"
        assert j.get("service") == "athena-api"


@pytest.mark.asyncio
async def test_error_handler():
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/error")
        assert r.status_code == 500
        body = r.json()
        assert body.get("status") == "error"
        assert body.get("error", {}).get("code") == "internal_error"

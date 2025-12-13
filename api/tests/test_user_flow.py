import pytest
import httpx
from api.app.main import app

@pytest.mark.asyncio
async def test_user_profile_invite_flow(monkeypatch):
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Register User A (Inviter)
        r = await client.post("/api/v1/auth/email/send-code", json={"email": "inviter@test.com"})
        code = r.json()["data"]["dev_code"]
        r = await client.post("/api/v1/auth/email/verify-code", json={"email": "inviter@test.com", "code": code})
        token_a = r.json()["data"]["tokens"]["access_token"]
        h_a = {"Authorization": f"Bearer {token_a}"}

        # 2. Register User B (Invitee)
        r = await client.post("/api/v1/auth/email/send-code", json={"email": "invitee@test.com"})
        code = r.json()["data"]["dev_code"]
        r = await client.post("/api/v1/auth/email/verify-code", json={"email": "invitee@test.com", "code": code})
        token_b = r.json()["data"]["tokens"]["access_token"]
        h_b = {"Authorization": f"Bearer {token_b}"}

        # 3. Profile Update (User A)
        r = await client.get("/api/v1/profile/me", headers=h_a)
        assert r.status_code == 200
        etag = r.json()["data"]["etag"]
        
        r = await client.patch("/api/v1/profile/me", headers={**h_a, "If-Match": etag}, json={"display_name": "Super Inviter"})
        assert r.status_code == 200

        r = await client.get("/api/v1/profile/me", headers=h_a)
        assert r.json()["data"]["display_name"] == "Super Inviter"

        # 4. Generate Invite Code (User A)
        r = await client.post("/api/v1/invites/generate", headers=h_a)
        assert r.status_code == 200
        invite_code = r.json()["data"]["code"]
        assert invite_code

        # 5. Redeem Invite Code (User B)
        r = await client.post("/api/v1/invites/redeem", headers=h_b, json={"code": invite_code})
        assert r.status_code == 200

        # 6. Verify Duplicate Redemption Fails
        # Note: After redemption, status becomes 'completed', so querying for 'pending' returns 404
        r = await client.post("/api/v1/invites/redeem", headers=h_b, json={"code": invite_code})
        assert r.status_code in [400, 404]  # 404 if code is completed, 400 if user already redeemed

        # 7. Verify Self-Invite Fails
        r = await client.post("/api/v1/invites/redeem", headers=h_a, json={"code": invite_code})
        # Should be 404 since status is now 'completed'
        assert r.status_code in [400, 404]

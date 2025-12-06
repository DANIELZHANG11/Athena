import pytest
import httpx
from unittest.mock import MagicMock
from api.app.main import app

@pytest.mark.asyncio
async def test_books_crud_flow(monkeypatch):
    # Mock S3 - mock functions in books module (imported from storage)
    monkeypatch.setattr("api.app.books.presigned_put", lambda bucket, key, **kwargs: "http://fake-upload-url.com")
    monkeypatch.setattr("api.app.books.presigned_get", lambda bucket, key, **kwargs: "http://fake-download-url.com")
    monkeypatch.setattr("api.app.books.stat_etag", lambda bucket, key: None)  # Return None to avoid etag matching
    monkeypatch.setattr("api.app.books.upload_bytes", lambda bucket, key, data, content_type: None)
    monkeypatch.setattr("api.app.books._quick_confidence", lambda b, k: (False, 0.0))
    monkeypatch.setattr("api.app.books.read_full", lambda bucket, key: b"fake-file-content")
    monkeypatch.setattr("api.app.books.read_head", lambda bucket, key, length=65536: b"fake-head-content")
    monkeypatch.setattr("api.app.books.delete_object", lambda bucket, key: None)
    
    # Mock search sync
    monkeypatch.setattr("api.app.books.index_book", lambda *args: None)
    monkeypatch.setattr("api.app.books.delete_book_from_index", lambda *args: None)

    # Mock S3 in book_service module
    monkeypatch.setattr("api.app.services.book_service.presigned_put", lambda bucket, key, **kwargs: "http://fake-upload-url.com")
    monkeypatch.setattr("api.app.services.book_service.presigned_get", lambda bucket, key, **kwargs: "http://fake-download-url.com")
    monkeypatch.setattr("api.app.services.book_service.stat_etag", lambda bucket, key: None)
    monkeypatch.setattr("api.app.services.book_service.make_object_key", lambda uid, fname: f"{uid}/{fname}")

    # Mock Celery
    mock_send_task = MagicMock()
    monkeypatch.setattr("api.app.books.celery_app.send_task", mock_send_task)

    # Mock Redis
    mock_redis = MagicMock()
    monkeypatch.setattr("api.app.books.r", mock_redis)

    # Mock Permissions using dependency_overrides
    from api.app.dependencies import require_upload_permission, require_write_permission
    
    app.dependency_overrides[require_upload_permission] = lambda: {"can_upload": True, "is_pro": True}
    app.dependency_overrides[require_write_permission] = lambda: {"is_readonly": False}
    
    try:
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Auth
            r = await client.post("/api/v1/auth/email/send-code", json={"email": "user@test.com"})
            code = r.json()["data"]["dev_code"]
            r = await client.post("/api/v1/auth/email/verify-code", json={"email": "user@test.com", "code": code})
            token = r.json()["data"]["tokens"]["access_token"]
            h = {"Authorization": f"Bearer {token}"}

            # 2. Upload Init
            r = await client.post("/api/v1/books/upload_init", headers=h, json={"filename": "test.pdf"})
            if r.status_code != 200:
                print(f"upload_init failed: {r.status_code}")
                print(f"Response: {r.text}")
            assert r.status_code == 200
            key = r.json()["data"]["key"]
            assert key

            # 3. Upload Complete
            r = await client.post("/api/v1/books/upload_complete", headers=h, json={
                "key": key,
                "title": "Test Book",
                "author": "Tester",
                "original_format": "pdf",
                "size": 1024
            })
            assert r.status_code == 200
            book_id = r.json()["data"]["id"]
            assert book_id

            # 4. Get Book Detail
            r = await client.get(f"/api/v1/books/{book_id}", headers=h)
            if r.status_code != 200:
                print(f"get_book failed: {r.status_code}")
                print(f"Response: {r.text}")
            assert r.status_code == 200
            data = r.json()["data"]
            assert data["title"] == "Test Book"
            assert data["author"] == "Tester"
            etag = r.headers.get("ETag")
            assert etag

            # 5. List Books
            r = await client.get("/api/v1/books", headers=h)
            assert r.status_code == 200
            items = r.json()["data"]["items"]
            assert len(items) >= 1
            assert items[0]["id"] == book_id

            # 6. Update Book
            r = await client.patch(f"/api/v1/books/{book_id}", headers={**h, "If-Match": etag}, json={"title": "Updated Title"})
            assert r.status_code == 200
            
            r = await client.get(f"/api/v1/books/{book_id}", headers=h)
            assert r.json()["data"]["title"] == "Updated Title"

            # 7. Convert Request
            r = await client.post(f"/api/v1/books/{book_id}/convert", headers=h, json={"target_format": "epub"})
            assert r.status_code == 200
            job_id = r.json()["data"]["job_id"]

            # 8. List Jobs
            r = await client.get("/api/v1/books/jobs/list", headers=h)
            assert r.status_code == 200
            jobs = r.json()["data"]
            assert any(j["id"] == job_id for j in jobs)

            # 9. Delete Book
            r = await client.delete(f"/api/v1/books/{book_id}", headers=h)
            assert r.status_code == 200

            # Verify Deletion
            r = await client.get(f"/api/v1/books/{book_id}", headers=h)
            assert r.status_code == 404
    finally:
        app.dependency_overrides = {}

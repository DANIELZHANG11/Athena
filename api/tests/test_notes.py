import pytest
import httpx
from unittest.mock import MagicMock
from api.app.main import app

@pytest.mark.asyncio
async def test_notes_highlights_tags_flow(monkeypatch):
    # Mock Search Sync
    monkeypatch.setattr("api.app.notes.index_note", lambda *args: None)
    monkeypatch.setattr("api.app.notes.delete_note_from_index", lambda *args: None)
    monkeypatch.setattr("api.app.notes.index_highlight", lambda *args: None)
    monkeypatch.setattr("api.app.notes.delete_highlight_from_index", lambda *args: None)

    # Mock Celery
    mock_send_task = MagicMock()
    monkeypatch.setattr("api.app.notes.celery_app.send_task", mock_send_task)

    # Mock Redis
    mock_redis = MagicMock()
    monkeypatch.setattr("api.app.notes.r", mock_redis)

    # Mock Permissions
    monkeypatch.setattr("api.app.dependencies.require_write_permission", lambda: True)

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Auth
        r = await client.post("/api/v1/auth/email/send-code", json={"email": "user@test.com"})
        code = r.json()["data"]["dev_code"]
        r = await client.post("/api/v1/auth/email/verify-code", json={"email": "user@test.com", "code": code})
        token = r.json()["data"]["tokens"]["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        # 2. Create Book (Prerequisite)
        # We need a book_id for notes and highlights. 
        # Since we are mocking everything, we can just generate a random UUID and insert it directly into DB 
        # OR use the book API if we want integration. Let's use direct DB insertion for speed/isolation if possible,
        # but using API is easier since we already have auth.
        # However, upload_complete requires S3 mock. Let's reuse the S3 mock setup or just insert a fake book ID.
        # Actually, notes/highlights foreign key constraints might fail if book doesn't exist.
        # So we MUST create a book.
        
        # Mock S3 for book creation
        mock_minio = MagicMock()
        mock_minio.stat_object.return_value.etag = "fake-etag"
        monkeypatch.setattr("api.app.books.stat_etag", lambda b, k: "fake-etag")
        monkeypatch.setattr("api.app.books._quick_confidence", lambda b, k: (False, 0.0))
        monkeypatch.setattr("api.app.storage.get_s3", lambda: mock_minio)

        r = await client.post("/api/v1/books/upload_init", headers=h, json={"filename": "test.pdf"})
        key = r.json()["data"]["key"]
        r = await client.post("/api/v1/books/upload_complete", headers=h, json={
            "key": key,
            "title": "Test Book",
            "original_format": "pdf"
        })
        book_id = r.json()["data"]["id"]

        # 3. Tags CRUD
        # Create Tag
        r = await client.post("/api/v1/tags", headers=h, json={"name": "Important"})
        assert r.status_code == 200
        tag_id = r.json()["data"]["id"]

        # List Tags
        r = await client.get("/api/v1/tags", headers=h)
        assert r.status_code == 200
        tags = r.json()["data"]
        assert any(t["id"] == tag_id for t in tags)
        tag_etag = next(t["etag"] for t in tags if t["id"] == tag_id)

        # Update Tag
        r = await client.patch(f"/api/v1/tags/{tag_id}", headers={**h, "If-Match": tag_etag}, json={"name": "Very Important"})
        assert r.status_code == 200

        # 4. Notes CRUD
        # Create Note
        r = await client.post("/api/v1/notes", headers=h, json={
            "book_id": book_id,
            "content": "This is a test note",
            "chapter": "Chapter 1",
            "location": "loc-1",
            "tags": [tag_id]
        })
        assert r.status_code == 200
        note_id = r.json()["data"]["id"]

        # Get Note
        r = await client.get(f"/api/v1/notes/{note_id}", headers=h)
        assert r.status_code == 200
        note_data = r.json()["data"]
        assert note_data["content"] == "This is a test note"
        note_etag = r.headers.get("ETag")

        # List Notes
        r = await client.get("/api/v1/notes", headers=h)
        assert r.status_code == 200
        notes = r.json()["data"]
        assert any(n["id"] == note_id for n in notes)

        # Update Note
        r = await client.patch(f"/api/v1/notes/{note_id}", headers={**h, "If-Match": note_etag}, json={"content": "Updated Note"})
        assert r.status_code == 200

        # Delete Note
        r = await client.delete(f"/api/v1/notes/{note_id}", headers=h)
        assert r.status_code == 200

        # 5. Highlights CRUD
        # Create Highlight
        r = await client.post("/api/v1/highlights", headers=h, json={
            "book_id": book_id,
            "start_location": "loc-10",
            "end_location": "loc-20",
            "color": "yellow",
            "comment": "Nice quote",
            "tags": [tag_id]
        })
        assert r.status_code == 200
        hl_id = r.json()["data"]["id"]

        # List Highlights
        r = await client.get(f"/api/v1/highlights?book_id={book_id}", headers=h)
        assert r.status_code == 200
        hls = r.json()["data"]
        assert any(h["id"] == hl_id for h in hls)
        hl_etag = next(h["etag"] for h in hls if h["id"] == hl_id)

        # Update Highlight
        r = await client.patch(f"/api/v1/highlights/{hl_id}", headers={**h, "If-Match": hl_etag}, json={"color": "red"})
        assert r.status_code == 200

        # Delete Highlight
        r = await client.delete(f"/api/v1/highlights/{hl_id}", headers=h)
        assert r.status_code == 200

        # 6. Delete Tag (Cleanup)
        r = await client.delete(f"/api/v1/tags/{tag_id}", headers=h)
        assert r.status_code == 200

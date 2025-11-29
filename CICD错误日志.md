Run pnpm run typecheck

> athena-web@0.0.1 typecheck /home/runner/work/Athena/Athena/web
> tsc --noEmit


> athena-web@0.0.1 lint /home/runner/work/Athena/Athena/web
> eslint "src/**/*.{ts,tsx}"


/home/runner/work/Athena/Athena/web/src/components/upload/UploadManager.tsx
Warning:   24:15  warning  Empty block statement  no-empty

/home/runner/work/Athena/Athena/web/src/hooks/useBookUpload.ts
Warning:   47:15  warning  Empty block statement  no-empty

/home/runner/work/Athena/Athena/web/src/pages/LibraryPage.tsx
Error:   8:10  error  'useAuthStore' is defined but never used  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/pages/app/Home.tsx
Warning:   24:13  warning  Empty block statement  no-empty
Warning:   52:17  warning  Empty block statement  no-empty

/home/runner/work/Athena/Athena/web/src/pages/app/home/ReadingGoalCard.tsx
Error:    5:10  error  'Input' is defined but never used                 @typescript-eslint/no-unused-vars
Error:   25:9   error  'timeDisplay' is assigned a value but never used  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/pages/app/home/WeeklyActivity.tsx
Error:    7:11  error  't' is assigned a value but never used         @typescript-eslint/no-unused-vars
Error:   16:17  error  'isMissed' is assigned a value but never used  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/pages/auth/Login.tsx
Error:   30:15  error  'data' is assigned a value but never used  @typescript-eslint/no-unused-vars

✖ 10 problems (6 errors, 4 warnings)

 ELIFECYCLE  Command failed with exit code 1.
Error: Process completed with exit code 1.

Run pytest -q api/tests
..F.....F.....                                                           [100%]
=================================== FAILURES ===================================
_____________________________ test_books_crud_flow _____________________________

monkeypatch = <_pytest.monkeypatch.MonkeyPatch object at 0x7fab147fb090>

    @pytest.mark.asyncio
    async def test_books_crud_flow(monkeypatch):
        # Mock S3 - mock functions in books module (imported from storage)
        monkeypatch.setattr(
            "api.app.books.presigned_put",
            lambda bucket, key, **kwargs: "http://fake-upload-url.com",
        )
        monkeypatch.setattr(
            "api.app.books.presigned_get",
            lambda bucket, key, **kwargs: "http://fake-download-url.com",
        )
        monkeypatch.setattr("api.app.books.stat_etag", lambda bucket, key: "fake-etag")
        monkeypatch.setattr(
            "api.app.books.upload_bytes", lambda bucket, key, data, content_type: None
        )
        monkeypatch.setattr("api.app.books._quick_confidence", lambda b, k: (False, 0.0))
    
        # Mock Celery
        mock_send_task = MagicMock()
        monkeypatch.setattr("api.app.books.celery_app.send_task", mock_send_task)
    
        # Mock Redis
        mock_redis = MagicMock()
        monkeypatch.setattr("api.app.books.r", mock_redis)
    
        # Mock Permissions using dependency_overrides
        from api.app.dependencies import (require_upload_permission,
                                          require_write_permission)
    
        app.dependency_overrides[require_upload_permission] = lambda: {
            "can_upload": True,
            "is_pro": True,
        }
        app.dependency_overrides[require_write_permission] = lambda: {"is_readonly": False}
    
        try:
            transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://test"
            ) as client:
                # 1. Auth
                r = await client.post(
                    "/api/v1/auth/email/send-code", json={"email": "user@test.com"}
                )
                code = r.json()["data"]["dev_code"]
                r = await client.post(
                    "/api/v1/auth/email/verify-code",
                    json={"email": "user@test.com", "code": code},
                )
                token = r.json()["data"]["tokens"]["access_token"]
                h = {"Authorization": f"***"}
    
                # 2. Upload Init
                r = await client.post(
                    "/api/v1/books/upload_init", headers=h, json={"filename": "test.pdf"}
                )
                if r.status_code != 200:
                    print(f"upload_init failed: {r.status_code}")
                    print(f"Response: {r.text}")
>               assert r.status_code == 200
E               assert 500 == 200
E                +  where 500 = <Response [500 Internal Server Error]>.status_code

api/tests/test_books.py:68: AssertionError
----------------------------- Captured stdout call -----------------------------
407256
upload_init failed: 500
Response: {"status":"error","error":{"code":"internal_error","message":"internal_error"}}
_______________________ test_notes_highlights_tags_flow ________________________

monkeypatch = <_pytest.monkeypatch.MonkeyPatch object at 0x7fab0cbd3250>

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
    
        # Mock Permissions using dependency_overrides
        from api.app.dependencies import (require_upload_permission,
                                          require_write_permission)
    
        app.dependency_overrides[require_upload_permission] = lambda: {
            "can_upload": True,
            "is_pro": True,
        }
        app.dependency_overrides[require_write_permission] = lambda: {"is_readonly": False}
    
        try:
            transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://test"
            ) as client:
                # 1. Auth
                r = await client.post(
                    "/api/v1/auth/email/send-code", json={"email": "user@test.com"}
                )
                code = r.json()["data"]["dev_code"]
                r = await client.post(
                    "/api/v1/auth/email/verify-code",
                    json={"email": "user@test.com", "code": code},
                )
                token = r.json()["data"]["tokens"]["access_token"]
                h = {"Authorization": f"***"}
    
                # 2. Create Book (Prerequisite)
                # Mock S3 for book creation - mock functions in books module
                monkeypatch.setattr(
                    "api.app.books.presigned_put",
                    lambda bucket, key, **kwargs: "http://fake-upload-url.com",
                )
                monkeypatch.setattr(
                    "api.app.books.presigned_get",
                    lambda bucket, key, **kwargs: "http://fake-download-url.com",
                )
                monkeypatch.setattr(
                    "api.app.books.stat_etag", lambda bucket, key: "fake-etag"
                )
                monkeypatch.setattr(
                    "api.app.books.upload_bytes",
                    lambda bucket, key, data, content_type: None,
                )
                monkeypatch.setattr(
                    "api.app.books._quick_confidence", lambda b, k: (False, 0.0)
                )
    
                r = await client.post(
                    "/api/v1/books/upload_init", headers=h, json={"filename": "test.pdf"}
                )
>               assert r.status_code == 200
E               assert 500 == 200
E                +  where 500 = <Response [500 Internal Server Error]>.status_code

api/tests/test_notes.py:76: AssertionError
----------------------------- Captured stdout call -----------------------------
495776
=============================== warnings summary ===============================
<frozen importlib._bootstrap>:283
  <frozen importlib._bootstrap>:283: DeprecationWarning: the load_module() method is deprecated and slated for removal in Python 3.12; use exec_module() instead

tests/test_admin_billing.py::test_admin_billing_flow
  /opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/pytest_asyncio/plugin.py:761: DeprecationWarning: The event_loop fixture provided by pytest-asyncio has been redefined in
  /home/runner/work/Athena/Athena/api/tests/conftest.py:6
  Replacing the event_loop fixture with a custom implementation is deprecated
  and will lead to errors in the future.
  If you want to request an asyncio event loop with a scope other than function
  scope, use the "scope" argument to the asyncio mark when marking the tests.
  If you want to return different types of event loops, use the event_loop_policy
  fixture.
  
    warnings.warn(

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
=========================== short test summary info ============================
FAILED api/tests/test_books.py::test_books_crud_flow - assert 500 == 200
 +  where 500 = <Response [500 Internal Server Error]>.status_code
FAILED api/tests/test_notes.py::test_notes_highlights_tags_flow - assert 500 == 200
 +  where 500 = <Response [500 Internal Server Error]>.status_code
2 failed, 12 passed, 2 warnings in 21.68s
Error: Process completed with exit code 1.
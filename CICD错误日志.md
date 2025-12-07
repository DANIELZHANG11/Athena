Run pytest -q api/tests
..F...........                                                           [100%]
=================================== FAILURES ===================================
_____________________________ test_books_crud_flow _____________________________

monkeypatch = <_pytest.monkeypatch.MonkeyPatch object at 0x7fb3fd94d9d0>

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
        monkeypatch.setattr(
            "api.app.books.stat_etag", lambda bucket, key: None
        )  # Return None to avoid etag matching
        monkeypatch.setattr(
            "api.app.books.upload_bytes", lambda bucket, key, data, content_type: None
        )
        monkeypatch.setattr("api.app.books._quick_confidence", lambda b, k: (False, 0.0))
        monkeypatch.setattr(
            "api.app.books.read_full", lambda bucket, key: b"fake-file-content"
        )
        monkeypatch.setattr(
            "api.app.books.read_head",
            lambda bucket, key, length=65536: b"fake-head-content",
        )
        monkeypatch.setattr("api.app.books.delete_object", lambda bucket, key: None)
    
        # Mock search sync
        monkeypatch.setattr("api.app.books.index_book", lambda *args: None)
        monkeypatch.setattr("api.app.books.delete_book_from_index", lambda *args: None)
    
        # Mock S3 in book_service module
        monkeypatch.setattr(
            "api.app.services.book_service.presigned_put",
            lambda bucket, key, **kwargs: "http://fake-upload-url.com",
        )
        monkeypatch.setattr(
            "api.app.services.book_service.presigned_get",
            lambda bucket, key, **kwargs: "http://fake-download-url.com",
        )
        monkeypatch.setattr(
            "api.app.services.book_service.stat_etag", lambda bucket, key: None
        )
        monkeypatch.setattr(
            "api.app.services.book_service.make_object_key",
            lambda uid, fname: f"{uid}/{fname}",
        )
    
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
                assert r.status_code == 200
                key = r.json()["data"]["key"]
                assert key
    
                # 3. Upload Complete
                r = await client.post(
                    "/api/v1/books/upload_complete",
                    headers=h,
                    json={
                        "key": key,
                        "title": "Test Book",
                        "author": "Tester",
                        "original_format": "pdf",
                        "size": 1024,
                    },
                )
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
                r = await client.patch(
                    f"/api/v1/books/{book_id}",
                    headers={**h, "If-Match": etag},
                    json={"title": "Updated Title"},
                )
                assert r.status_code == 200
    
                r = await client.get(f"/api/v1/books/{book_id}", headers=h)
                assert r.json()["data"]["title"] == "Updated Title"
    
                # 7. Convert Request
                r = await client.post(
                    f"/api/v1/books/{book_id}/convert",
                    headers=h,
                    json={"target_format": "epub"},
                )
                assert r.status_code == 200
                job_id = r.json()["data"]["job_id"]
    
                # 8. List Jobs
                r = await client.get("/api/v1/books/jobs/list", headers=h)
                assert r.status_code == 200
                jobs = r.json()["data"]
                assert any(j["id"] == job_id for j in jobs)
    
                # 9. Delete Book
                r = await client.delete(f"/api/v1/books/{book_id}", headers=h)
>               assert r.status_code == 200
E               assert 500 == 200
E                +  where 500 = <Response [500 Internal Server Error]>.status_code

api/tests/test_books.py:166: AssertionError
----------------------------- Captured stdout call -----------------------------
697103
[Upload Init] No dedup hit, creating new upload for test.pdf
[Upload] Client did not provide SHA256, computing server-side for 4b4b0046-c8a8-455d-8277-adcd3d5b9696/test.pdf...
[Upload] Server computed SHA256: bb33e4383a0ee2f7...
[Upload] Created book 87f10fde-2100-46f7-af99-abc64dd58610 for user 4b4b0046-c8a8-455d-8277-adcd3d5b9696, SHA256=bb33e4383a0ee2f7..., title=Test Book
[Delete Book] Error: (sqlalchemy.dialects.postgresql.asyncpg.ProgrammingError) <class 'asyncpg.exceptions.UndefinedColumnError'>: column "ocr_result_key" does not exist
[SQL: 
                    SELECT id, minio_key, cover_image_key, canonical_book_id, storage_ref_count,
                           ocr_result_key, digitalize_report_key, content_sha256
                    FROM books 
                    WHERE id = cast($1 as uuid) AND user_id = cast($2 as uuid)
                ]
[parameters: ('87f10fde-2100-46f7-af99-abc64dd58610', '4b4b0046-c8a8-455d-8277-adcd3d5b9696')]
(Background on this error at: https://sqlalche.me/e/20/f405)
Traceback (most recent call last):
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/dialects/postgresql/asyncpg.py", line 510, in _prepare_and_execute
    prepared_stmt, attributes = await adapt_connection._prepare(
                                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/dialects/postgresql/asyncpg.py", line 756, in _prepare
    prepared_stmt = await self._connection.prepare(
                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/asyncpg/connection.py", line 635, in prepare
    return await self._prepare(
           ^^^^^^^^^^^^^^^^^^^^
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/asyncpg/connection.py", line 653, in _prepare
    stmt = await self._get_statement(
           ^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/asyncpg/connection.py", line 432, in _get_statement
    statement = await self._protocol.prepare(
                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "asyncpg/protocol/protocol.pyx", line 165, in prepare
asyncpg.exceptions.UndefinedColumnError: column "ocr_result_key" does not exist

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/engine/base.py", line 1967, in _exec_single_context
    self.dialect.do_execute(
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/engine/default.py", line 941, in do_execute
    cursor.execute(statement, parameters)
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/dialects/postgresql/asyncpg.py", line 568, in execute
    self._adapt_connection.await_(
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/util/_concurrency_py3k.py", line 132, in await_only
    return current.parent.switch(awaitable)  # type: ignore[no-any-return,attr-defined] # noqa: E501
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/util/_concurrency_py3k.py", line 196, in greenlet_spawn
    value = await result
            ^^^^^^^^^^^^
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/dialects/postgresql/asyncpg.py", line 546, in _prepare_and_execute
    self._handle_exception(error)
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/dialects/postgresql/asyncpg.py", line 497, in _handle_exception
    self._adapt_connection._handle_exception(error)
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/dialects/postgresql/asyncpg.py", line 780, in _handle_exception
    raise translated_error from error
sqlalchemy.dialects.postgresql.asyncpg.AsyncAdapt_asyncpg_dbapi.ProgrammingError: <class 'asyncpg.exceptions.UndefinedColumnError'>: column "ocr_result_key" does not exist

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File "/home/runner/work/Athena/Athena/api/app/books.py", line 2341, in delete_book
    res = await conn.execute(
          ^^^^^^^^^^^^^^^^^^^
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/ext/asyncio/engine.py", line 657, in execute
    result = await greenlet_spawn(
             ^^^^^^^^^^^^^^^^^^^^^
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/util/_concurrency_py3k.py", line 201, in greenlet_spawn
    result = context.throw(*sys.exc_info())
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/engine/base.py", line 1418, in execute
    return meth(
           ^^^^^
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/sql/elements.py", line 515, in _execute_on_connection
    return connection._execute_clauseelement(
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/engine/base.py", line 1640, in _execute_clauseelement
    ret = self._execute_context(
          ^^^^^^^^^^^^^^^^^^^^^^
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/engine/base.py", line 1846, in _execute_context
    return self._exec_single_context(
           ^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/engine/base.py", line 1986, in _exec_single_context
    self._handle_dbapi_exception(
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/engine/base.py", line 2355, in _handle_dbapi_exception
    raise sqlalchemy_exception.with_traceback(exc_info[2]) from e
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/engine/base.py", line 1967, in _exec_single_context
    self.dialect.do_execute(
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/engine/default.py", line 941, in do_execute
    cursor.execute(statement, parameters)
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/dialects/postgresql/asyncpg.py", line 568, in execute
    self._adapt_connection.await_(
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/util/_concurrency_py3k.py", line 132, in await_only
    return current.parent.switch(awaitable)  # type: ignore[no-any-return,attr-defined] # noqa: E501
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/util/_concurrency_py3k.py", line 196, in greenlet_spawn
    value = await result
            ^^^^^^^^^^^^
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/dialects/postgresql/asyncpg.py", line 546, in _prepare_and_execute
    self._handle_exception(error)
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/dialects/postgresql/asyncpg.py", line 497, in _handle_exception
    self._adapt_connection._handle_exception(error)
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/dialects/postgresql/asyncpg.py", line 780, in _handle_exception
    raise translated_error from error
sqlalchemy.exc.ProgrammingError: (sqlalchemy.dialects.postgresql.asyncpg.ProgrammingError) <class 'asyncpg.exceptions.UndefinedColumnError'>: column "ocr_result_key" does not exist
[SQL: 
                    SELECT id, minio_key, cover_image_key, canonical_book_id, storage_ref_count,
                           ocr_result_key, digitalize_report_key, content_sha256
                    FROM books 
                    WHERE id = cast($1 as uuid) AND user_id = cast($2 as uuid)
                ]
[parameters: ('87f10fde-2100-46f7-af99-abc64dd58610', '4b4b0046-c8a8-455d-8277-adcd3d5b9696')]
(Background on this error at: https://sqlalche.me/e/20/f405)

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
1 failed, 13 passed, 2 warnings in 21.36s
Error: Process completed with exit code 1.
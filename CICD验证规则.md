### 🛡️ 雅典娜计划：CI/CD 修复五大宪章以及最新的错误提示：

项目仓库地址：https://github.com/DANIELZHANG11/Athena.git

#### 1. “架构降级”零容忍原则 (No Architectural Regression)
*   **场景**：如果计费测试挂了，报错说“数据库锁超时”或“事务回滚”。
*   **原则**：**绝对不允许**为了让测试通过，而移除 `FOR UPDATE` 锁或 `atomic update`（原子更新）逻辑。**绝对不允许**把数据库事务拆散。
*   **指令话术**：*“修复这个测试错误，但**严禁**修改计费的原子性逻辑。如果是测试用例写得不对（比如没模拟好并发环境），请修改测试用例，而不是修改业务代码。”*

#### 2. DDL 隔离原则 (Migration Sanctity)
*   **场景**：如果测试报错说 `Table 'users' already exists` 或 `Relation not found`。
*   **原则**：**严禁**在代码里加回 `CREATE TABLE IF NOT EXISTS`。
*   **原因**：这是我们刚刚费劲清理掉的“毒瘤”。
*   **指令话术**：*“检查 Alembic 迁移脚本是否在 CI 环境中正确执行了。如果是表结构缺失，请新增 Alembic 版本文件，**绝不许**在业务代码里写 SQL 建表语句。”*

#### 3. 真实服务 vs 测试 Mock 的边界原则
*   **场景**：现在代码里集成了 `PaddleOCR` 和 `BGE-M3`，这些库很大，CI 环境（GitHub Actions）可能跑不动或者没显卡，导致安装超时或内存溢出报错。
*   **原则**：**CI 环境中允许使用 Mock，但生产环境必须用真家伙。**
*   **指令话术**：*“CI 环境资源有限。请确保 `conftest.py` 或测试配置中，能够检测 `TESTING` 环境变量。在测试运行时，自动注入 `MockOCR` 和 `MockEmbedder` 来替代真实的 `PaddleOCR`，但在 Docker 生产镜像构建时，必须保留真实库的依赖。”*

#### 4. 依赖锁定原则 (Dependency Strictness)
*   **场景**：报错 `ModuleNotFoundError` 或 `VersionConflict`。
*   **原则**：不要随意升级或降级核心库（尤其是 `fastapi`, `sqlalchemy`, `pydantic`）。
*   **指令话术**：*“请分析依赖冲突的原因。如果需要添加新库（如 `paddleocr`），请确保它与现有的 `python 3.11` 环境兼容，并将精确版本号写入 `requirements.txt`。”*

#### 5. 基础设施对齐原则 (Infra Alignment)
*   **场景**：测试报错 `Connection Refused` 连接不上 `s3://...` 或 `opensearch`。
*   **原则**：代码已经改成了 SeaweedFS 和 OpenSearch，但 CI 的配置文件（如 `.github/workflows/main.yml` 或 `tests/docker-compose.test.yml`）可能还没改，还在用 MinIO/ES。
*   **指令话术**：*“不要修改后端连接代码。请检查 CI 的配置文件和服务定义，确保测试环境启动的是 `seaweedfs` 和 `opensearch`，且端口映射与后端代码中的配置一致。”*

---

### 🚑 针对常见报错的“急救包” (Cheat Sheet)

当看到以下错误时，直接复制对应的指令给 AI：

**情况 A：Lint/Format 错误 (Flake8, Black, Isort)**
> **指令**：*“这是代码风格问题。请直接运行格式化工具修复所有 lint 错误，不要修改任何业务逻辑。”*

**情况 B：Mypy 类型检查错误 (Type Mismatch)**
> **指令**：*“请修复类型注解错误。如果是第三方库（如 paddleocr）缺少类型定义，可以使用 `# type: ignore` 临时规避，但不要修改变量的实际类型。”*

**情况 C：Docker 构建失败 (Build Failure)**
> **指令**：*“Docker 构建失败。请检查 `Dockerfile`。如果是 PaddleOCR 或 PyTorch 导致镜像过大或下载超时，请尝试使用国内镜像源或精简版基础镜像，并确保使用多阶段构建（Multi-stage build）减小体积。”*

**情况 D：数据库迁移失败 (Alembic Divergence)**
> **指令**：*“数据库模型与迁移脚本不一致。请不要修改模型。请生成一个新的 `alembic revision --autogenerate` 脚本来对齐数据库状态。”*

---
修复，调整或补全代码后，重新推送至GITHUB仓库进行验证


Run pytest -q api/tests
F.F.....F...FF                                                           [100%]
=================================== FAILURES ===================================
___________________________ test_admin_billing_flow ____________________________

monkeypatch = <_pytest.monkeypatch.MonkeyPatch object at 0x7ffb14a98d50>

    @pytest.mark.asyncio
    async def test_admin_billing_flow(monkeypatch):
        # Mock Redis (used in some places implicitly or explicitly)
        mock_redis = MagicMock()
        monkeypatch.setattr(
            "api.app.billing.r", mock_redis, raising=False
        )  # billing might not use redis directly but good to be safe
    
        # Mock Webhook Signature Verification
        monkeypatch.setattr("api.app.billing._sig_ok", lambda s, b, sig: True)
    
        # Enable Dev Mode for Grant Credits
        monkeypatch.setenv("DEV_MODE", "true")
    
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Auth & Admin Setup
            r = await client.post(
                "/api/v1/auth/email/send-code", json={"email": "admin@test.com"}
            )
            code = r.json()["data"]["dev_code"]
            r = await client.post(
                "/api/v1/auth/email/verify-code",
                json={"email": "admin@test.com", "code": code},
            )
            auth_data = r.json()["data"]
            token = auth_data["tokens"]["access_token"]
            user_id = auth_data["user"]["id"]
            h = {"Authorization": f"***"}
    
            # Set ADMIN_USER_ID to current user
            monkeypatch.setenv("ADMIN_USER_ID", user_id)
    
            # --- Admin Tests ---
    
            # List Users
            r = await client.get("/api/v1/admin/users", headers=h)
            assert r.status_code == 200
            users = r.json()["data"]
            assert any(u["id"] == user_id for u in users)
            user_etag = next(u["etag"] for u in users if u["id"] == user_id)
    
            # Update User
            r = await client.patch(
                f"/api/v1/admin/users/{user_id}",
                headers={**h, "If-Match": user_etag},
                json={"display_name": "Admin User"},
            )
>           assert r.status_code == 200
E           assert 500 == 200
E            +  where 500 = <Response [500 Internal Server Error]>.status_code

api/tests/test_admin_billing.py:59: AssertionError
----------------------------- Captured stdout call -----------------------------
821848
_____________________________ test_books_crud_flow _____________________________

monkeypatch = <_pytest.monkeypatch.MonkeyPatch object at 0x7ffb12d282d0>

    @pytest.mark.asyncio
    async def test_books_crud_flow(monkeypatch):
        # Mock S3
        mock_minio = MagicMock()
        mock_minio.bucket_exists.return_value = True
        mock_minio.make_bucket.return_value = None
        mock_minio.presigned_put_object.return_value = "http://fake-upload-url.com"
        mock_minio.presigned_get_object.return_value = "http://fake-download-url.com"
        mock_minio.stat_object.return_value.etag = "fake-etag"
        monkeypatch.setattr("api.app.storage.get_s3", lambda: mock_minio)
        monkeypatch.setattr("api.app.books.stat_etag", lambda b, k: "fake-etag")
        monkeypatch.setattr("api.app.books._quick_confidence", lambda b, k: (False, 0.0))
    
        # Mock Celery
        mock_send_task = MagicMock()
        monkeypatch.setattr("api.app.books.celery_app.send_task", mock_send_task)
    
        # Mock Redis
        mock_redis = MagicMock()
        monkeypatch.setattr("api.app.books.r", mock_redis)
    
        # Mock Permissions
        monkeypatch.setattr("api.app.dependencies.require_upload_permission", lambda: True)
        monkeypatch.setattr("api.app.dependencies.require_write_permission", lambda: True)
    
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
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
>           assert r.status_code == 200
E           assert 500 == 200
E            +  where 500 = <Response [500 Internal Server Error]>.status_code

api/tests/test_books.py:52: AssertionError
----------------------------- Captured stdout call -----------------------------
883114
_______________________ test_notes_highlights_tags_flow ________________________

monkeypatch = <_pytest.monkeypatch.MonkeyPatch object at 0x7ffb12d40fd0>

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
            monkeypatch.setattr(
                "api.app.books._quick_confidence", lambda b, k: (False, 0.0)
            )
            monkeypatch.setattr("api.app.storage.get_s3", lambda: mock_minio)
    
            r = await client.post(
                "/api/v1/books/upload_init", headers=h, json={"filename": "test.pdf"}
            )
>           key = r.json()["data"]["key"]
                  ^^^^^^^^^^^^^^^^
E           KeyError: 'data'

api/tests/test_notes.py:63: KeyError
----------------------------- Captured stdout call -----------------------------
136969
_____________________________ test_search_ai_flow ______________________________

monkeypatch = <_pytest.monkeypatch.MonkeyPatch object at 0x7ffb12989510>

    @pytest.mark.asyncio
    async def test_search_ai_flow(monkeypatch):
        # Mock Redis
        mock_redis = MagicMock()
        mock_redis.get.return_value = None  # No cache hit
        mock_redis.ttl.return_value = 0
        monkeypatch.setattr("api.app.ai.r", mock_redis)
    
        # Mock ES (Ensure it fails so we fallback to Postgres)
        monkeypatch.setenv("ES_URL", "http://non-existent-es:9200")
    
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
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
    
            # 2. Search (Postgres Fallback)
            # First, insert some data via Notes API (requires mocking notes dependencies again or just raw SQL)
            # Let's use raw SQL for speed and isolation
            import uuid
    
            from sqlalchemy import text
    
            from api.app.db import engine
    
            book_id = str(uuid.uuid4())
            note_id = str(uuid.uuid4())
    
            async with engine.begin() as conn:
                # Set user_id
                await conn.execute(
                    text("SELECT set_config('app.user_id', :uid, true)"),
                    {"uid": r.json()["data"]["user"]["id"]},
                )
    
                # Insert Dummy Book
                await conn.execute(
                    text(
                        "INSERT INTO books(id, user_id, title, author, minio_key) VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, 'Searchable Book', 'Author X', 'key')"
                    ),
                    {"id": book_id},
                )
    
                # Insert Dummy Note
                await conn.execute(
                    text(
                        "INSERT INTO notes(id, user_id, book_id, content, tsv) VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, cast(:bid as uuid), 'Searchable Note Content', to_tsvector('simple', 'Searchable Note Content'))"
                    ),
                    {"id": note_id, "bid": book_id},
                )
    
            # Search for Book
            r = await client.get("/api/v1/search?q=Searchable&kind=book", headers=h)
            assert r.status_code == 200
            items = r.json()["data"]
            assert any(i["title"] == "Searchable Book" for i in items)
    
            # Search for Note
            r = await client.get("/api/v1/search?q=Content&kind=note", headers=h)
            assert r.status_code == 200
            items = r.json()["data"]
            assert any(i["content"] == "Searchable Note Content" for i in items)
    
            # Reindex (Smoke Test)
            r = await client.post("/api/v1/search/reindex", headers=h)
            assert r.status_code == 200
    
            # 3. AI Flow
            # Create Conversation
            r = await client.post(
                "/api/v1/ai/conversations", headers=h, json={"title": "Test Chat"}
            )
>           assert r.status_code == 200
E           assert 500 == 200
E            +  where 500 = <Response [500 Internal Server Error]>.status_code

api/tests/test_search_ai.py:90: AssertionError
----------------------------- Captured stdout call -----------------------------
551001
------------------------------ Captured log call -------------------------------
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (0/20) now.
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (1/20) in 1.00 second.
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (2/20) in 1.00 second.
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (3/20) in 1.00 second.
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (4/20) in 1.00 second.
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (5/20) in 1.00 second.
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (6/20) in 1.00 second.
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (7/20) in 1.00 second.
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (8/20) in 1.00 second.
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (9/20) in 1.00 second.
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (10/20) in 1.00 second.
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (11/20) in 1.00 second.
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (12/20) in 1.00 second.
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (13/20) in 1.00 second.
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (14/20) in 1.00 second.
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (15/20) in 1.00 second.
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (16/20) in 1.00 second.
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (17/20) in 1.00 second.
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (18/20) in 1.00 second.
ERROR    celery.backends.redis:redis.py:391 Connection to Redis lost: Retry (19/20) in 1.00 second.
CRITICAL celery.backends.redis:redis.py:132 
Retry limit exceeded while trying to reconnect to the Celery redis result store backend. The Celery application must be restarted.
________________________ test_user_profile_invite_flow _________________________

monkeypatch = <_pytest.monkeypatch.MonkeyPatch object at 0x7ffb12a83390>

    @pytest.mark.asyncio
    async def test_user_profile_invite_flow(monkeypatch):
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Register User A (Inviter)
            r = await client.post(
                "/api/v1/auth/email/send-code", json={"email": "inviter@test.com"}
            )
            code = r.json()["data"]["dev_code"]
            r = await client.post(
                "/api/v1/auth/email/verify-code",
                json={"email": "inviter@test.com", "code": code},
            )
            token_a = r.json()["data"]["tokens"]["access_token"]
            h_a = {"Authorization": f"***"}
    
            # 2. Register User B (Invitee)
            r = await client.post(
                "/api/v1/auth/email/send-code", json={"email": "invitee@test.com"}
            )
            code = r.json()["data"]["dev_code"]
            r = await client.post(
                "/api/v1/auth/email/verify-code",
                json={"email": "invitee@test.com", "code": code},
            )
            token_b = r.json()["data"]["tokens"]["access_token"]
            h_b = {"Authorization": f"***"}
    
            # 3. Profile Update (User A)
            r = await client.get("/api/v1/profile/me", headers=h_a)
            assert r.status_code == 200
            etag = r.json()["data"]["etag"]
    
            r = await client.patch(
                "/api/v1/profile/me",
                headers={**h_a, "If-Match": etag},
                json={"display_name": "Super Inviter"},
            )
            assert r.status_code == 200
    
            r = await client.get("/api/v1/profile/me", headers=h_a)
            assert r.json()["data"]["display_name"] == "Super Inviter"
    
            # 4. Generate Invite Code (User A)
            r = await client.post("/api/v1/invites/generate", headers=h_a)
>           assert r.status_code == 200
E           assert 404 == 200
E            +  where 404 = <Response [404 Not Found]>.status_code

api/tests/test_user_flow.py:52: AssertionError
----------------------------- Captured stdout call -----------------------------
726099
708645
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
FAILED api/tests/test_admin_billing.py::test_admin_billing_flow - assert 500 == 200
 +  where 500 = <Response [500 Internal Server Error]>.status_code
FAILED api/tests/test_books.py::test_books_crud_flow - assert 500 == 200
 +  where 500 = <Response [500 Internal Server Error]>.status_code
FAILED api/tests/test_notes.py::test_notes_highlights_tags_flow - KeyError: 'data'
FAILED api/tests/test_search_ai.py::test_search_ai_flow - assert 500 == 200
 +  where 500 = <Response [500 Internal Server Error]>.status_code
FAILED api/tests/test_user_flow.py::test_user_profile_invite_flow - assert 404 == 200
 +  where 404 = <Response [404 Not Found]>.status_code
5 failed, 9 passed, 2 warnings in 21.00s
Error: Process completed with exit code 1.
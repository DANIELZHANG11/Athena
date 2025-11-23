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
......FF.                                                                [100%]
=================================== FAILURES ===================================
__________________________ test_ocr_quota_membership ___________________________

monkeypatch = <_pytest.monkeypatch.MonkeyPatch object at 0x7f73b60016d0>

    @pytest.mark.asyncio
    async def test_ocr_quota_membership(monkeypatch):
        monkeypatch.setenv("DEV_MODE", "true")
        mock_minio = MagicMock()
        mock_minio.bucket_exists.return_value = True
        mock_minio.make_bucket.return_value = None
        mock_minio.presigned_put_object.return_value = "http://fake-upload-url.com"
        monkeypatch.setattr("api.app.storage.get_s3", lambda: mock_minio)
        monkeypatch.setattr("api.app.admin_panel._require_admin", lambda uid: True)
        monkeypatch.setattr("api.app.pricing._require_admin", lambda uid: True)
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.post(
                "/api/v1/auth/email/send-code", json={"email": "user@athena.local"}
            )
            code = r.json()["data"]["dev_code"]
            r = await client.post(
                "/api/v1/auth/email/verify-code",
                json={"email": "user@athena.local", "code": code},
            )
            token = r.json()["data"]["tokens"]["access_token"]
            h = {"Authorization": f"***"}
    
            r = await client.put(
                "/api/v1/admin/system/settings",
                headers=h,
                json={"membership_tiers": {"PRO": {"free_ocr_pages": 10}}},
            )
            assert r.status_code == 200
    
            r = await client.post(
                "/api/v1/admin/pricing/rules",
                headers=h,
                json={
                    "service_type": "OCR",
                    "unit_type": "PAGES",
                    "unit_size": 1,
                    "price_amount": 0.05,
                    "currency": "CNY",
                },
            )
>           assert r.status_code == 200
E           assert 500 == 200
E            +  where 500 = <Response [500 Internal Server Error]>.status_code

api/tests/test_ocr_membership_quota.py:50: AssertionError
----------------------------- Captured stdout call -----------------------------
358794
______________________ test_pricing_admin_and_user_rules _______________________

monkeypatch = <_pytest.monkeypatch.MonkeyPatch object at 0x7f73b5db8a10>

    @pytest.mark.asyncio
    async def test_pricing_admin_and_user_rules(monkeypatch):
        monkeypatch.setenv("DEV_MODE", "true")
        monkeypatch.setattr("api.app.pricing._require_admin", lambda uid: True)
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.post(
                "/api/v1/auth/email/send-code", json={"email": "op@athena.local"}
            )
            code = r.json()["data"]["dev_code"]
            r = await client.post(
                "/api/v1/auth/email/verify-code",
                json={"email": "op@athena.local", "code": code},
            )
            token = r.json()["data"]["tokens"]["access_token"]
            h = {"Authorization": f"***"}
    
            r = await client.post(
                "/api/v1/admin/pricing/rules",
                headers=h,
                json={
                    "service_type": "OCR",
                    "unit_type": "PAGES",
                    "unit_size": 1,
                    "price_amount": 0.05,
                    "currency": "CNY",
                    "region": "CN",
                    "remark_template": "每{unit_size}页{price_amount}{currency}",
                },
            )
>           assert r.status_code == 200
E           assert 500 == 200
E            +  where 500 = <Response [500 Internal Server Error]>.status_code

api/tests/test_pricing_admin.py:37: AssertionError
----------------------------- Captured stdout call -----------------------------
886855
=============================== warnings summary ===============================
<frozen importlib._bootstrap>:283
  <frozen importlib._bootstrap>:283: DeprecationWarning: the load_module() method is deprecated and slated for removal in Python 3.12; use exec_module() instead

tests/test_ai_models_admin.py::test_ai_models_upsert_list
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
FAILED api/tests/test_ocr_membership_quota.py::test_ocr_quota_membership - assert 500 == 200
 +  where 500 = <Response [500 Internal Server Error]>.status_code
FAILED api/tests/test_pricing_admin.py::test_pricing_admin_and_user_rules - assert 500 == 200
 +  where 500 = <Response [500 Internal Server Error]>.status_code
2 failed, 7 passed, 2 warnings in 1.64s
Error: Process completed with exit code 1.
### 🛡️ 雅典娜计划：CI/CD 修复五大宪章以及最新的错误提示：

项目仓库地址：git@github.com:DANIELZHANG11/Athena.git

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

Run alembic -c alembic.ini upgrade head
Traceback (most recent call last):
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/engine/base.py", line 1967, in _exec_single_context
    self.dialect.do_execute(
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/engine/default.py", line 941, in do_execute
    cursor.execute(statement, parameters)
psycopg2.errors.FeatureNotSupported: extension "vector" is not available
DETAIL:  Could not open extension control file "/usr/share/postgresql/16/extension/vector.control": No such file or directory.
HINT:  The extension must first be installed on the system where PostgreSQL is running.


The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File "/opt/hostedtoolcache/Python/3.11.14/x64/bin/alembic", line 7, in <module>
    sys.exit(main())
             ^^^^^^
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/alembic/config.py", line 636, in main
    CommandLine(prog=prog).main(argv=argv)
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/alembic/config.py", line 626, in main
    self.run_cmd(cfg, options)
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/alembic/config.py", line 603, in run_cmd
    fn(
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/alembic/command.py", line 406, in upgrade
    script.run_env()
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/alembic/script/base.py", line 582, in run_env
    util.load_python_file(self.dir, "env.py")
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/alembic/util/pyfiles.py", line 95, in load_python_file
    module = load_module_py(module_id, path)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/alembic/util/pyfiles.py", line 113, in load_module_py
    spec.loader.exec_module(module)  # type: ignore
    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<frozen importlib._bootstrap_external>", line 940, in exec_module
  File "<frozen importlib._bootstrap>", line 241, in _call_with_frames_removed
  File "/home/runner/work/Athena/Athena/api/alembic/env.py", line 30, in <module>
    run_migrations_online()
  File "/home/runner/work/Athena/Athena/api/alembic/env.py", line 25, in run_migrations_online
    context.run_migrations()
  File "<string>", line 8, in run_migrations
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/alembic/runtime/environment.py", line 946, in run_migrations
    self.get_context().run_migrations(**kw)
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/alembic/runtime/migration.py", line 628, in run_migrations
    step.migration_fn(**kw)
  File "/home/runner/work/Athena/Athena/api/alembic/versions/0100_squash_baseline.py", line 17, in upgrade
    op.execute(
  File "<string>", line 8, in execute
  File "<string>", line 3, in execute
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/alembic/operations/ops.py", line 2537, in execute
    return operations.invoke(op)
           ^^^^^^^^^^^^^^^^^^^^^
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/alembic/operations/base.py", line 442, in invoke
    return fn(self, operation)
           ^^^^^^^^^^^^^^^^^^^
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/alembic/operations/toimpl.py", line 224, in execute_sql
    operations.migration_context.impl.execute(
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/alembic/ddl/impl.py", line 217, in execute
    self._exec(sql, execution_options)
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/alembic/ddl/impl.py", line 210, in _exec
    return conn.execute(construct, params)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
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
sqlalchemy.exc.NotSupportedError: (psycopg2.errors.FeatureNotSupported) extension "vector" is not available
DETAIL:  Could not open extension control file "/usr/share/postgresql/16/extension/vector.control": No such file or directory.
HINT:  The extension must first be installed on the system where PostgreSQL is running.

[SQL: 
        -- required extensions
        CREATE EXTENSION IF NOT EXISTS pgcrypto;
        CREATE EXTENSION IF NOT EXISTS vector;

        -- Core tables for Athena baseline

        CREATE TABLE IF NOT EXISTS shelves (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            version INT NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS books (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            language TEXT,
            original_format TEXT,
            minio_key TEXT NOT NULL,
            size BIGINT,
            cover_image_key TEXT,
            version INT NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS shelf_items (
            shelf_id UUID NOT NULL,
            book_id UUID NOT NULL,
            position INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (shelf_id, book_id)
        );

        CREATE TABLE IF NOT EXISTS conversion_jobs (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            book_id UUID NOT NULL,
            source_key TEXT NOT NULL,
            target_format TEXT NOT NULL,
            output_key TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            error TEXT
        );

        CREATE TABLE IF NOT EXISTS payment_sessions (
            id UUID PRIMARY KEY,
            owner_id UUID NOT NULL,
            gateway TEXT NOT NULL,
            amount INT NOT NULL,
            currency TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            return_url TEXT,
            cancel_url TEXT,
            metadata JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS payment_webhook_events (
            id TEXT PRIMARY KEY,
            gateway TEXT NOT NULL,
            session_id UUID,
            payload JSONB,
            processed BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS credit_accounts (
            owner_id UUID PRIMARY KEY,
            balance BIGINT NOT NULL DEFAULT 0,
            currency TEXT,
            wallet_amount NUMERIC NOT NULL DEFAULT 0,
            wallet_currency TEXT NOT NULL DEFAULT 'CNY',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS credit_ledger (
            id UUID PRIMARY KEY,
            owner_id UUID NOT NULL,
            amount BIGINT NOT NULL,
            currency TEXT NOT NULL,
            reason TEXT,
            related_id UUID,
            direction TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS ocr_jobs (
            id UUID PRIMARY KEY,
            owner_id UUID NOT NULL,
            source_key TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'uploading',
            result_text TEXT,
            error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS system_settings (
            id UUID PRIMARY KEY,
            key TEXT UNIQUE NOT NULL,
            value JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS ai_models (
            id UUID PRIMARY KEY,
            provider TEXT NOT NULL,
            model_id TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS payment_gateways (
            id UUID PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            config JSONB NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            version INT NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS pricing_rules (
            id UUID PRIMARY KEY,
            service_type VARCHAR(32) NOT NULL,
            unit_type VARCHAR(32) NOT NULL,
            unit_size INTEGER NOT NULL,
            price_amount NUMERIC(10,2) NOT NULL,
            currency VARCHAR(10) NOT NULL,
            region VARCHAR(10),
            remark_template TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            version INT NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS service_providers (
            id UUID PRIMARY KEY,
            service_type TEXT NOT NULL,
            name TEXT NOT NULL,
            endpoint TEXT,
            config JSONB NOT NULL DEFAULT '{}'::jsonb,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            priority INTEGER NOT NULL DEFAULT 0,
            version INTEGER NOT NULL DEFAULT 1,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(service_type, name)
        );

        -- Useful indexes
        CREATE INDEX IF NOT EXISTS idx_shelves_user_updated ON shelves(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_books_user_updated ON books(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_shelf_items_shelf ON shelf_items(shelf_id);
        CREATE INDEX IF NOT EXISTS idx_conversion_jobs_user_status ON conversion_jobs(user_id, status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_credit_ledger_owner_created ON credit_ledger(owner_id, created_at DESC);
        ]
(Background on this error at: https://sqlalche.me/e/20/tw8g)
Error: Process completed with exit code 1.

Run actions/setup-node@v4
Found in cache @ /opt/hostedtoolcache/node/20.19.5/x64
Environment details
Error: Unable to locate executable file: pnpm. Please verify either the file path exists or the file can be found within a directory specified by the PATH environment variable. Also check the file mode to verify the file is executable.
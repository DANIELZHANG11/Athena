## 第一章：CI/CD 六大宪章 (The 6 Commandments)

### 1. "架构降级"零容忍 (No Architectural Regression)
*   **规则**：严禁为了通过测试或简化开发而移除核心架构保障。
*   **具体表现**：
    *   **严禁**移除数据库事务中的 `FOR UPDATE` 锁。
    *   **严禁**移除原子更新（Atomic Update）逻辑。
    *   **必须**在同一事务中完成计费扣除与业务写入。
    *   **严禁**在 PowerSync 的 sync_rules.yaml 中使用开放式查询（如 SELECT *），必须显式列出字段。这是为了防止后端 Schema 变更导致前端意外接收敏感数据或大量无用数据。

### 2. DDL 迁移圣洁性 (Migration Sanctity)
*   **规则**：数据库结构的任何变更必须通过 Alembic 迁移脚本完成。
*   **具体表现**：
    *   **严禁**在业务代码中执行 `CREATE/ALTER TABLE`。
    *   **严禁**使用 `if not exists` 偷懒。
    *   **新增具体表现**：不仅是后端的 Alembic，前端的 SQLite Schema 变更（web/src/lib/powersync/schema.ts）也必须包含对应的版本号注释或迁移日志。如果发现 Schema 文件被修改但没有更新版本号，CI 报警。

### 3. 真实服务与 Mock 的边界 (Mocking Boundaries)
*   **规则**：CI 环境资源有限，生产环境必须使用真实服务。
*   **具体表现**：
    *   **CI 环境**：允许使用 `MockOCR`、`MockEmbedder`。
    *   **生产/Docker 环境**：必须加载真实的 `PaddleOCR` 和 `BGE-M3`。

### 4. 依赖锁定原则 (Dependency Strictness)
*   **规则**：核心库版本必须严格锁定，禁止随意升级。

### 5. 基础设施对齐 (Infra Alignment)
*   **规则**：代码配置必须与 `docker-compose.yml` 定义的基础设施完全一致（SeaweedFS, OpenSearch）。

### 6. 设备指纹强制 (Device Identity)
*   **规则**：所有涉及同步的写操作（Write），**必须**携带 `deviceId`。
*   **具体表现**：
    *   前端生成 UUID 并持久化在 LocalStorage，严禁每次刷新变动。
    *   后端必须校验 `deviceId`，这是判断“冲突”还是“更新”的唯一依据。

### 7. 架构隔离探针 (Architectural Isolation Probe)
**背景**：AI 在写前端代码时，极易产生幻觉，习惯性地去 fetch('/api/v1/notes')，这会直接破坏离线优先架构。
**规则**：UI 层严禁直接触碰业务 REST API。前端代码库中，除白名单模块外，禁止出现网络请求代码。
具体表现：
**CI 扫描**：在 web/src/components 和 web/src/pages 目录下，运行静态分析脚本（如 ESLint 插件或简单的 grep）。
**红线**：如果检测到 axios, fetch, 或 useQuery（React Query）直接调用了 /api/v1/books, /api/v1/notes 等路径，CI 直接失败。
**白名单**：仅允许 web/src/services/auth.ts (认证), web/src/services/billing.ts (支付), web/src/services/ai.ts (流式对话) 包含网络请求。
**正确路径**：必须强制使用 useLiveQuery (PowerSync) 或自定义的 Repo 层。

### 8. 类型契约强校验 (Type Contract Enforcement)
**背景**：PowerSync 的核心是 SQLite Schema 与前端 TypeScript 类型的一致性。如果 AI 随意定义类型（使用 any 或与 Schema 不符），会导致同步数据在 UI 渲染时静默失败。
**规则**：前端 TypeScript 类型必须与 SQLite Schema 严格对齐，禁止隐式 any。
具体表现：
**Schema 驱动**：web/src/lib/powersync/schema.ts 是前端类型的唯一真理源。
**严禁 Any**：tsconfig.json 中必须开启 noImplicitAny: true，CI 阶段运行 tsc --noEmit，有任何类型报错直接拦截。
字段对齐检查：建议编写一个简单的 CI 脚本，校验 AppSchema 导出的类型字段是否覆盖了 UI 组件中使用的字段，防止字段名拼写错误（如 cover_url vs coverUrl）。

Run alembic -c alembic.ini upgrade head
Traceback (most recent call last):
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/engine/base.py", line 1967, in _exec_single_context
    self.dialect.do_execute(
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/engine/default.py", line 941, in do_execute
    cursor.execute(statement, parameters)
psycopg2.errors.UndefinedObject: publication "powersync" does not exist
CONTEXT:  SQL statement "ALTER PUBLICATION powersync ADD TABLE shelf_books"
PL/pgSQL function inline_code_block line 7 at SQL statement


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
  File "/home/runner/work/Athena/Athena/api/alembic/env.py", line 34, in <module>
    run_migrations_online()
  File "/home/runner/work/Athena/Athena/api/alembic/env.py", line 28, in run_migrations_online
    context.run_migrations()
  File "<string>", line 8, in run_migrations
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/alembic/runtime/environment.py", line 946, in run_migrations
    self.get_context().run_migrations(**kw)
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/alembic/runtime/migration.py", line 628, in run_migrations
    step.migration_fn(**kw)
  File "/home/runner/work/Athena/Athena/api/alembic/versions/0127_add_shelf_books_user_id.py", line 52, in upgrade
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
sqlalchemy.exc.ProgrammingError: (psycopg2.errors.UndefinedObject) publication "powersync" does not exist
CONTEXT:  SQL statement "ALTER PUBLICATION powersync ADD TABLE shelf_books"
PL/pgSQL function inline_code_block line 7 at SQL statement

[SQL: 
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_publication_tables 
                WHERE pubname = 'powersync' AND tablename = 'shelf_books'
            ) THEN
                ALTER PUBLICATION powersync ADD TABLE shelf_books;
            END IF;
        END $$;
    ]
(Background on this error at: https://sqlalche.me/e/20/f405)
Error: Process completed with exit code 1.

Run pnpm run typecheck

> athena-web@0.0.1 typecheck /home/runner/work/Athena/Athena/web
> tsc --noEmit


> athena-web@0.0.1 lint /home/runner/work/Athena/Athena/web
> eslint "src/**/*.{ts,tsx}"


/home/runner/work/Athena/Athena/web/src/components/AddToShelfDialog.tsx
Error:   26:28  error  'getDeviceId' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/components/BookCard/BookCardGrid.tsx
Error:   8:17  error  'Loader2' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/components/BookCard/BookCardHero.tsx
Error:   22:5  error  'id' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/components/BookCard/BookCardList.tsx
Error:   16:21  error  'ProcessingPlaceholder' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/components/BookCardMenu.tsx
Error:   8:10  error  'bookStorage' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/components/readers/EpubReader.tsx
Warning:   243:8  warning  React Hook useEffect has missing dependencies: 'clearAutoHideTimer', 'initialLocation', 'onLocationChanged', and 'startAutoHideTimer'. Either include them or remove the dependency array. If 'onLocationChanged' changes too often, find the parent component that defines it and wrap that definition in useCallback  react-hooks/exhaustive-deps

/home/runner/work/Athena/Athena/web/src/hooks/useProgressData.ts
Error:   155:13  error  'deviceId' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/hooks/useShelvesData.ts
Error:   14:24  error  'getDeviceId' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/lib/powersync/hooks/useReadingProgress.ts
Error:   287:9  error  'markAsFinished' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/lib/powersync/hooks/useShelves.ts
Error:   14:24  error  'getDeviceId' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/pages/LibraryPage.tsx
Error:   21:90  error  'Plus' is defined but never used. Allowed unused vars must match /^_/u    @typescript-eslint/no-unused-vars
Error:   22:10  error  'Button' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/pages/ReaderPage.tsx
Error:   13:52  error  'useMemo' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

✖ 13 problems (12 errors, 1 warning)

 ELIFECYCLE  Command failed with exit code 1.
Error: Process completed with exit code 1.

Run alembic -c alembic.ini upgrade head
Traceback (most recent call last):
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/engine/base.py", line 1967, in _exec_single_context
    self.dialect.do_execute(
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/sqlalchemy/engine/default.py", line 941, in do_execute
    cursor.execute(statement, parameters)
psycopg2.errors.UndefinedObject: publication "powersync" does not exist
CONTEXT:  SQL statement "ALTER PUBLICATION powersync ADD TABLE shelf_books"
PL/pgSQL function inline_code_block line 7 at SQL statement


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
  File "/home/runner/work/Athena/Athena/api/alembic/env.py", line 34, in <module>
    run_migrations_online()
  File "/home/runner/work/Athena/Athena/api/alembic/env.py", line 28, in run_migrations_online
    context.run_migrations()
  File "<string>", line 8, in run_migrations
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/alembic/runtime/environment.py", line 946, in run_migrations
    self.get_context().run_migrations(**kw)
  File "/opt/hostedtoolcache/Python/3.11.14/x64/lib/python3.11/site-packages/alembic/runtime/migration.py", line 628, in run_migrations
    step.migration_fn(**kw)
  File "/home/runner/work/Athena/Athena/api/alembic/versions/0127_add_shelf_books_user_id.py", line 52, in upgrade
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
sqlalchemy.exc.ProgrammingError: (psycopg2.errors.UndefinedObject) publication "powersync" does not exist
CONTEXT:  SQL statement "ALTER PUBLICATION powersync ADD TABLE shelf_books"
PL/pgSQL function inline_code_block line 7 at SQL statement

[SQL: 
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_publication_tables 
                WHERE pubname = 'powersync' AND tablename = 'shelf_books'
            ) THEN
                ALTER PUBLICATION powersync ADD TABLE shelf_books;
            END IF;
        END $$;
    ]
(Background on this error at: https://sqlalche.me/e/20/f405)
Error: Process completed with exit code 1.

Run pnpm run typecheck

> athena-web@0.0.1 typecheck /home/runner/work/Athena/Athena/web
> tsc --noEmit


> athena-web@0.0.1 lint /home/runner/work/Athena/Athena/web
> eslint "src/**/*.{ts,tsx}"


/home/runner/work/Athena/Athena/web/src/components/AddToShelfDialog.tsx
Error:   26:28  error  'getDeviceId' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/components/BookCard/BookCardGrid.tsx
Error:   8:17  error  'Loader2' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/components/BookCard/BookCardHero.tsx
Error:   22:5  error  'id' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/components/BookCard/BookCardList.tsx
Error:   16:21  error  'ProcessingPlaceholder' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/components/BookCardMenu.tsx
Error:   8:10  error  'bookStorage' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/hooks/useProgressData.ts
Error:   155:13  error  'deviceId' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/hooks/useShelvesData.ts
Error:   14:24  error  'getDeviceId' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/lib/powersync/hooks/useReadingProgress.ts
Error:   287:9  error  'markAsFinished' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/lib/powersync/hooks/useShelves.ts
Error:   14:24  error  'getDeviceId' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/pages/LibraryPage.tsx
Error:   21:90  error  'Plus' is defined but never used. Allowed unused vars must match /^_/u    @typescript-eslint/no-unused-vars
Error:   22:10  error  'Button' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/pages/ReaderPage.tsx
Error:   134:9  error  'sessionStarted' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

✖ 12 problems (12 errors, 0 warnings)

 ELIFECYCLE  Command failed with exit code 1.
Error: Process completed with exit code 1.
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
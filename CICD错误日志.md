## 第一章：CI/CD 六大宪章 (The 6 Commandments)

### 1. “架构降级”零容忍 (No Architectural Regression)
*   **规则**：严禁为了通过测试或简化开发而移除核心架构保障。
*   **具体表现**：
    *   **严禁**移除数据库事务中的 `FOR UPDATE` 锁。
    *   **严禁**移除原子更新（Atomic Update）逻辑。
    *   **必须**在同一事务中完成计费扣除与业务写入。

### 2. DDL 迁移圣洁性 (Migration Sanctity)
*   **规则**：数据库结构的任何变更必须通过 Alembic 迁移脚本完成。
*   **具体表现**：
    *   **严禁**在业务代码中执行 `CREATE/ALTER TABLE`。
    *   **严禁**使用 `if not exists` 偷懒。

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


Run pnpm run build

> athena-web@0.0.1 build /home/runner/work/Athena/Athena/web
> vite build

Error: R] Unexpected "}"

    vite.config.ts:75:2:
      75 │   },
         ╵   ^

failed to load config from /home/runner/work/Athena/Athena/web/vite.config.ts
error during build:
Error: Build failed with 1 error:
vite.config.ts:75:2: ERROR: Unexpected "}"
    at failureErrorWithLog (/home/runner/work/Athena/Athena/web/node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/lib/main.js:1472:15)
    at /home/runner/work/Athena/Athena/web/node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/lib/main.js:945:25
    at runOnEndCallbacks (/home/runner/work/Athena/Athena/web/node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/lib/main.js:1315:45)
    at buildResponseToResult (/home/runner/work/Athena/Athena/web/node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/lib/main.js:943:7)
    at /home/runner/work/Athena/Athena/web/node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/lib/main.js:970:16
    at responseCallbacks.<computed> (/home/runner/work/Athena/Athena/web/node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/lib/main.js:622:9)
    at handleIncomingPacket (/home/runner/work/Athena/Athena/web/node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/lib/main.js:677:12)
    at Socket.readFromStdout (/home/runner/work/Athena/Athena/web/node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/lib/main.js:600:7)
    at Socket.emit (node:events:524:28)
    at addChunk (node:internal/streams/readable:561:12)
 ELIFECYCLE  Command failed with exit code 1.
Error: Process completed with exit code 1.

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

vite v5.4.21 building for production...
transforming...
Found 3 warnings while optimizing generated CSS:

Issue #1:
│   }
│   .\[\&_\.recharts-dot\[stroke\=\\\'\#fff\\\'\]\]\:stroke-transparent {
│     & .recharts-dot[stroke=\'#fff\'] {
┆                              ^-- Unexpected token IDHash("fff'")
┆
│       stroke: transparent;
│     }

Issue #2:
│   }
│   .\[\&_\.recharts-sector\[stroke\=\\\'\#fff\\\'\]\]\:stroke-transparent {
│     & .recharts-sector[stroke=\'#fff\'] {
┆                                 ^-- Unexpected token IDHash("fff'")
┆
│       stroke: transparent;
│     }

Issue #3:
│   }
│   .\[\&_svg\:not\(\[class\*\\\'size-\\\'\]\)\]\:size-4 {
│     & svg:not([class*\'size-\']) {
┆                     ^-- Unexpected token in attribute selector: Delim('*')
┆
│       width: calc(var(--spacing) * 4);
│       height: calc(var(--spacing) * 4);

✓ 3312 modules transformed.
vite v5.4.21 building for production...
transforming...
✓ 82 modules transformed.
rendering chunks...
computing gzip size...
dist/sw.js  73.64 kB │ gzip: 19.05 kB
✓ built in 177ms

PWA v0.16.7
mode      injectManifest
precache  1 entries (0.00 KiB)
files generated
  dist/sw.js
warnings
  One of the glob patterns doesn't match any files. Please remove or fix the following: {
  "globDirectory": "/home/runner/work/Athena/Athena/web/dist",
  "globPattern": "**/*.{js,css,html,ico,png,svg,json,woff,woff2}",
  "globIgnores": [
    "**/node_modules/**/*",
    "sw.js",
    "sw.js"
  ]
}

x Build failed in 7.89s
error during build:
[vite-plugin-pwa:build] [plugin vite-plugin-pwa:build] node_modules/.pnpm/@powersync+web@1.30.0_@journeyapps+wa-sqlite@1.4.1_@powersync+common@1.44.0/node_modules/@powersync/web/lib/src/worker/db/open-worker-database.js: There was an error during the build:
  Invalid value "iife" for option "output.format" - UMD and IIFE output formats are not supported for code-splitting builds.
Additionally, handling the error in the 'buildEnd' hook caused the following error:
  Invalid value "iife" for option "output.format" - UMD and IIFE output formats are not supported for code-splitting builds.
file: /home/runner/work/Athena/Athena/web/node_modules/.pnpm/@powersync+web@1.30.0_@journeyapps+wa-sqlite@1.4.1_@powersync+common@1.44.0/node_modules/@powersync/web/lib/src/worker/db/open-worker-database.js
    at getRollupError (file:///home/runner/work/Athena/Athena/web/node_modules/.pnpm/rollup@4.53.2/node_modules/rollup/dist/es/shared/parseAst.js:401:41)
    at file:///home/runner/work/Athena/Athena/web/node_modules/.pnpm/rollup@4.53.2/node_modules/rollup/dist/es/shared/node-entry.js:23333:39
    at async catchUnfinishedHookActions (file:///home/runner/work/Athena/Athena/web/node_modules/.pnpm/rollup@4.53.2/node_modules/rollup/dist/es/shared/node-entry.js:22791:16)
    at async rollupInternal (file:///home/runner/work/Athena/Athena/web/node_modules/.pnpm/rollup@4.53.2/node_modules/rollup/dist/es/shared/node-entry.js:23316:5)
    at async build (file:///home/runner/work/Athena/Athena/web/node_modules/.pnpm/vite@5.4.21_@types+node@20.19.26_lightningcss@1.30.2_terser@5.44.1/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:65709:14)
    at async CAC.<anonymous> (file:///home/runner/work/Athena/Athena/web/node_modules/.pnpm/vite@5.4.21_@types+node@20.19.26_lightningcss@1.30.2_terser@5.44.1/node_modules/vite/dist/node/cli.js:829:5)
 ELIFECYCLE  Command failed with exit code 1.
Error: Process completed with exit code 1.

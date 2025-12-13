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


Run pnpm run typecheck

> athena-web@0.0.1 typecheck /home/runner/work/Athena/Athena/web
> tsc --noEmit

Error: src/hooks/useOcrData.ts(244,25): error TS2345: Argument of type '{ bookId: string; isImageBased: any; confidence: any; totalPages: any; totalChars: any; totalRegions: any; imageWidth: any; imageHeight: any; pageSizes: Record<string, { width: number; height: number; pdfWidth?: number; pdfHeight?: number; dpi?: number; }>; regions: any; }' is not assignable to parameter of type 'OcrDataRecord'.
  Property 'downloadedAt' is missing in type '{ bookId: string; isImageBased: any; confidence: any; totalPages: any; totalChars: any; totalRegions: any; imageWidth: any; imageHeight: any; pageSizes: Record<string, { width: number; height: number; pdfWidth?: number; pdfHeight?: number; dpi?: number; }>; regions: any; }' but required in type 'OcrDataRecord'.
 ELIFECYCLE  Command failed with exit code 2.
Error: Process completed with exit code 2.
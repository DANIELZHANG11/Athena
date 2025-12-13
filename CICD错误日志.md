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


> athena-web@0.0.1 lint /home/runner/work/Athena/Athena/web
> eslint "src/**/*.{ts,tsx}"


/home/runner/work/Athena/Athena/web/src/hooks/useBookFileCache.ts
Error:   87:27  error  Definition for rule 'react-hooks/exhaustive-deps' was not found  react-hooks/exhaustive-deps

/home/runner/work/Athena/Athena/web/src/hooks/useBookUpload.ts
Error:   20:48  error  'getOfflineUploadQueue' is defined but never used  @typescript-eslint/no-unused-vars
Error:   21:10  error  'useOnlineStatus' is defined but never used        @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/hooks/useDashboardData.ts
Error:   184:13  error  'checkDate' is never reassigned. Use 'const' instead  prefer-const
Error:   204:16  error  Unexpected constant condition                         no-constant-condition
Error:   254:19  error  'firstDate' is assigned a value but never used        @typescript-eslint/no-unused-vars
Error:   255:19  error  'lastDate' is assigned a value but never used         @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/hooks/useUploadPostProcessing.ts
Error:    71:24  error  'isLoading' is assigned a value but never used  @typescript-eslint/no-unused-vars
Error:   121:56  error  'initialTitle' is defined but never used        @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/lib/aiChatStorage.ts
Error:   25:41  error  'conversations' is defined but never used   @typescript-eslint/no-unused-vars
Error:   29:36  error  'messages' is defined but never used        @typescript-eslint/no-unused-vars
Error:   37:47  error  'conversationId' is defined but never used  @typescript-eslint/no-unused-vars
Error:   41:42  error  'id' is defined but never used              @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/lib/shelvesStorage.ts
Error:    6:38  error  'shelfId' is defined but never used  @typescript-eslint/no-unused-vars
Error:    6:55  error  'bookId' is defined but never used   @typescript-eslint/no-unused-vars
Error:   10:43  error  'shelfId' is defined but never used  @typescript-eslint/no-unused-vars
Error:   10:60  error  'bookId' is defined but never used   @typescript-eslint/no-unused-vars
Error:   18:39  error  'bookId' is defined but never used   @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/pages/AIConversationsPage.tsx
Error:    94:5  error  Definition for rule 'react-hooks/exhaustive-deps' was not found  react-hooks/exhaustive-deps
Error:   103:5  error  Definition for rule 'react-hooks/exhaustive-deps' was not found  react-hooks/exhaustive-deps

/home/runner/work/Athena/Athena/web/src/pages/LibraryPage.tsx
Error:   10:31  error  'useRef' is defined but never used            @typescript-eslint/no-unused-vars
Error:   16:29  error  'BookItem' is defined but never used          @typescript-eslint/no-unused-vars
Error:   20:70  error  'Check' is defined but never used             @typescript-eslint/no-unused-vars
Error:   61:5   error  'isReady' is assigned a value but never used  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/pages/NotesPage.tsx
Error:    45:53  error  'updateHighlight' is assigned a value but never used  @typescript-eslint/no-unused-vars
Error:   132:14  error  'error' is defined but never used                     @typescript-eslint/no-unused-vars
Error:   158:14  error  'error' is defined but never used                     @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/pages/ProfilePage.tsx
Error:   113:5  error  Definition for rule 'react-hooks/exhaustive-deps' was not found  react-hooks/exhaustive-deps
Error:   121:5  error  Definition for rule 'react-hooks/exhaustive-deps' was not found  react-hooks/exhaustive-deps

/home/runner/work/Athena/Athena/web/src/pages/SearchPage.tsx
Error:   13:20  error  'useCallback' is defined but never used                 @typescript-eslint/no-unused-vars
Error:   35:10  error  'debouncedQuery' is assigned a value but never used     @typescript-eslint/no-unused-vars
Error:   35:26  error  'setDebouncedQuery' is assigned a value but never used  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/pages/app/Home.tsx
Error:   18:9  error  'db' is assigned a value but never used  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/pages/app/home/ContinueReadingHero.tsx
Error:   77:18  error  'securityError' is defined but never used  @typescript-eslint/no-unused-vars

✖ 34 problems (34 errors, 0 warnings)
  1 error and 0 warnings potentially fixable with the `--fix` option.

 ELIFECYCLE  Command failed with exit code 1.
Error: Process completed with exit code 1.
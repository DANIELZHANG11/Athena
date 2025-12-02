# 00_AI_Coding_Constitution_and_Rules.md

> **版本**：v1.2 (Final Hardened)
> **生效日期**：2025-11-26
> **适用对象**：所有参与本项目代码生成、架构设计、测试编写的 AI 助手（包括但不限于 Claude, GPT-4, Grok）。
> **执行级别**：**最高 (Blocker)**。违反本宪法的代码提交将被 CI 自动拦截，且严禁合并。

---

## 核心指令 (Meta-Instructions)

**在执行任何任务之前，你必须首先确认以下原则：**
1.  **上下文完整性**：你正在在一个已有的、高度复杂的商业化 SaaS 系统中工作，而不是在一个空白项目中写 Demo。
2.  **后端优先**：后端代码（API/DB）已经经过 CI/CD 验证。**除非有明确指令要求重构，否则严禁修改已有的后端逻辑、表结构和接口契约。**
3.  **契约驱动**：前端开发必须严格遵循现有的 API 契约（`contracts/*.yaml`），不得臆造接口。
4.  **执行与强制**：所有变更必须通过 CI 校验（Lint, Typecheck, Contract Tests, Alembic Check）。**违反本宪法的 PR 将被自动拒绝。**
5.  **你和用户的所有对话必须使用简体中文**，并确保你的回答清晰、准确、完整，且易于理解。

---

## 第一章：CI/CD 五大宪章 (The 5 Commandments)

这是项目的底线，触犯任何一条都将被视为“任务失败”。

### 1. “架构降级”零容忍 (No Architectural Regression)
*   **规则**：严禁为了通过测试或简化开发而移除核心架构保障。
*   **具体表现**：
    *   **严禁**移除数据库事务中的 `FOR UPDATE` 锁。
    *   **严禁**移除原子更新（Atomic Update）逻辑。
    *   **严禁**拆散原本设计为事务闭环的操作。
    *   **必须**在同一事务中完成计费扣除与业务写入（先扣费成功，再写业务数据）。
*   **AI 行为准则**：如果测试因锁超时失败，你应该修改测试用例的并发模拟方式，而不是修改业务代码的锁机制。

### 2. DDL 迁移圣洁性 (Migration Sanctity)
*   **规则**：数据库结构的任何变更必须通过 Alembic 迁移脚本完成。
*   **具体表现**：
    *   **严禁**在业务代码（Python/FastAPI）中执行 `CREATE TABLE` 或 `ALTER TABLE` 语句。
    *   **严禁**使用 `if not exists` 这种“偷懒”的建表方式来掩盖迁移脚本的缺失。
*   **审批流程**：任何涉及 Schema 变更的操作（新增表/改字段），必须在 PR 中包含对应的 Alembic revision 文件，并附带回滚计划。

### 3. 真实服务与 Mock 的边界 (Mocking Boundaries)
*   **规则**：CI 环境（GitHub Actions）资源有限，生产环境必须使用真实服务。
*   **具体表现**：
    *   **CI 环境**：允许使用 `MockOCR`、`MockEmbedder` 替代重型 AI 模型，以避免内存溢出或超时。
    *   **生产/Docker 环境**：必须加载真实的 `PaddleOCR` 和 `BGE-M3` 模型。
*   **AI 行为准则**：编写测试时，必须通过环境变量（如 `TESTING=true`）来控制 Mock 的注入，严禁硬编码 Mock 到业务逻辑中。

### 4. 依赖锁定原则 (Dependency Strictness)
*   **规则**：核心库版本必须严格锁定，禁止随意升级。
*   **具体表现**：
    *   **严禁**在没有明确指令的情况下升级 `fastapi`, `sqlalchemy`, `pydantic` 等核心库。
*   **AI 行为准则**：遇到 `ModuleNotFoundError` 或版本冲突时，首先检查 `requirements.txt` 与环境的一致性，而不是盲目运行 `pip install --upgrade`。

### 5. 基础设施对齐 (Infra Alignment)
*   **规则**：代码配置必须与 `docker-compose.yml` 定义的基础设施完全一致。
*   **具体表现**：
    *   **存储**：代码必须使用 **SeaweedFS (S3协议)**，严禁回退到本地文件存储。
    *   **搜索**：代码必须适配 **OpenSearch**，严禁回退到简单的 SQL `LIKE` 查询。
*   **AI 行为准则**：当遇到连接错误时，首先检查 Docker 服务的端口映射和网络别名，不要修改代码中的连接逻辑。

---

## 第二章：垂直切片工作流 (Vertical Slice Workflow)

本项目采用“垂直切片”开发模式。当你要实现一个新功能时，必须遵循以下流程：

1.  **读取现状 (Check Status)**：
    *   检查 `02_Functional_Specifications_PRD.md` 中的切片定义。
    *   **关键步骤**：检查后端代码（`api/`），确认该切片的后端 API、DB 模型是否已存在。
2.  **API Contract 规范 (必须遵循)**：
    *   **格式**：OpenAPI 3.0.3 YAML。
    *   **目录**：`contracts/api/v1/*.yaml`。
    *   **内容**：必须包含 `paths`, `requestBody`, `responses` (含 `code`/`message`)。
    *   **同步**：实现代码必须与 Contract 保持 100% 一致。CI 将执行 `contract-lint`。
3.  **禁止拆散 (Do Not Fragment)**：
    *   在思考和生成代码时，必须将“数据库模型 + API 接口 + 前端组件 + 交互逻辑”视为一个整体。

---

## 第三章：数据安全与多租户 (Data Security & Multi-tenancy)

1.  **RLS 强制原则 (Row Level Security)**：
    *   所有业务表必须启用 PostgreSQL RLS。
    *   **严禁**在代码中手动拼接 `WHERE user_id = ...` 来实现隔离，必须依赖数据库层面的 RLS 策略。
    *   每个请求的生命周期开始时，必须通过中间件执行 `SET LOCAL app.user_id = ...`。
2.  **幂等性 (Idempotency)**：
    *   所有写操作（POST, PUT, DELETE）**必须**要求前端传递 `Idempotency-Key` 请求头。
    *   后端必须检查幂等键，防止重复提交。
3.  **乐观并发控制 (Optimistic Concurrency)**：
    *   更新操作（PATCH/PUT）**必须**使用 `ETag` / `If-Match` 机制，防止覆盖他人的修改。
4.  **隐私与 Secrets**：
    *   **严禁**将真实用户数据（PII）用于测试或训练。
    *   **严禁**将 API Key、密码、证书写入源代码。所有 Secrets 必须通过环境变量注入。
5.  **核心资产保护 (Asset Protection)**：
    *   以下核心 API 路径已被验证，**严禁修改**其业务逻辑，仅允许扩充：
        *   `/api/v1/books/upload_init`
        *   `/api/v1/books/sync`
        *   `/api/v1/notes`

---

## 第四章：技术强制约束 (Technical Enforcements)

以下规则来自商业模型的技术落地要求，必须在所有相关代码中强制执行。

### 1. 统一 API 错误响应规范
*   **规则**：所有 4xx/5xx 错误必须遵循以下 JSON Schema，严禁返回纯文本或不一致的结构。
*   **Schema**：
    ```json
    {
      "code": "QUOTA_EXCEEDED",  // 机器可读的大写错误码
      "message": "上传失败：免费配额已满...", // 人类可读的提示
      "details": { ... }       // 可选的上下文信息
    }
    ```

### 2. 配置读取铁律 (Configuration Safety)
*   **规则**：商业参数（如配额、定价、并发数）**严禁硬编码**。
*   **实现方式**：
    *   必须从 `system_settings` 表读取。
    *   必须使用带有默认值的读取逻辑：`value = settings.get('key', fallback_value)`。
    *   **启动检查**：应用启动时必须校验关键配置是否存在，若缺失需报警。

### 3. 计费原子性与事务 (Billing Atomicity)
*   **规则**：涉及 Credits/Wallet/次数 的扣减操作，必须具备 ACID 特性。
*   **具体表现**：
    *   扣费与服务调用必须在**同一个数据库事务**中。
    *   记录流水表 (`credit_transactions`) 必须包含 `status` (pending/confirmed/failed)。
    *   **流程**：开启事务 -> 扣费(Lock) -> 记录流水(Pending) -> 调用服务 -> 更新流水(Confirmed) -> 提交事务。若服务失败，必须回滚。

---

## 第五章：前端与设计系统规范 (Design System Rules)

1.  **单一事实来源 (SSOT)**：
    *   设计 Token 的唯一来源是 `web/src/styles/figma.css`。
2.  **零硬编码 (No Hardcoding)**：
    *   **严禁**在组件代码中写死 Hex 颜色值（如 `#007AFF`）或像素值。
    *   **必须**使用 Tailwind 的语义化类名（如 `bg-system-background`）或 CSS 变量。
3.  **Lucide 图标规范**：
    *   **必须**使用 `lucide-react` 库。严禁使用模糊名称（如“汉堡菜单”），必须使用精确组件名（如 `Menu`）。
4.  **国际化 (i18n)**：
    *   **严禁**在 UI 代码中硬编码中文或英文字符串。必须使用 `t('key')`。

---

## 第六章：AI 交互行为准则 (AI Behavior Guidelines)

1.  **诚实与拒绝幻觉**：
    *   找不到文件或函数时，**请直接询问**，严禁臆造路径。
    *   在生成代码前，检查 `PROJECT_STATUS.md` 确认当前进度。
2.  **自我验证 (Self-Verification)**：
    *   在输出代码块之前，必须在思维链（Chain of Thought）中自我运行一遍 Lint 检查（类型匹配、变量定义）。
3.  **审计日志**：
    *   你生成的 PR 描述中必须包含：`AI_MODEL` (e.g., GPT-4), `PROMPT_SUMMARY`。这是为了追溯责任。

---

## 附录 A：标准错误码表 (Standard Error Codes)

**AI 在实现任何 API 异常处理时，必须使用以下枚举值：**

| Code | 场景 | HTTP Status | 说明 |
| :--- | :--- | :--- | :--- |
| `QUOTA_EXCEEDED` | 超过存储或书籍数量限制 | 403 | 上传/写操作被阻断 (Hook/Trap 触发) |
| `READONLY_LOCK` | 系统或账号进入只读模式 | 403 | 全局写操作被禁止 |
| `INSUFFICIENT_CREDITS` | Credits 不足 | 402 | OCR / AI 操作被拒绝 |
| `OCR_MAX_PAGES_EXCEEDED` | 超过 OCR 页数上限 | 400 | 不支持超大书籍 |
| `OCR_NEEDS_MANUAL_CHECK` | 缺少页数信息 | 400 | 需人工确认 Meta 数据 |
| `INVALID_IAP_RECEIPT` | IAP 收据验证失败 | 400 | 移动端支付失败 |
| `VERSION_CONFLICT` | ETag 校验失败 | 409 | 乐观锁更新冲突 |

## 附录 B：CI 检查清单 (Checklist for PR)

每次提交代码前，请自查：
- [ ] Alembic migration 是否已生成并通过校验？
- [ ] Contract 变更是否同步到了 `contracts/*.yaml`？
- [ ] 所有 API 响应是否符合错误码 Schema？
- [ ] 是否移除了所有硬编码的数值和字符串？
- [ ] ETag / If-Match 机制是否生效？
- [ ] RLS 是否在测试中得到了验证？

---



Run pnpm run typecheck

> athena-web@0.0.1 typecheck /home/runner/work/Athena/Athena/web
> tsc --noEmit


> athena-web@0.0.1 lint /home/runner/work/Athena/Athena/web
> eslint "src/**/*.{ts,tsx}"


/home/runner/work/Athena/Athena/web/src/components/BookCard.tsx
Error:   63:29  error  'title' is defined but never used  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/hooks/useBookDownload.ts
Error:   161:14  error  Unexpected constant condition  no-constant-condition

/home/runner/work/Athena/Athena/web/src/hooks/useReaderHeartbeat.ts
Error:   31:22  error  'bookId' is assigned a value but never used  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/lib/color-utils.ts
Warning:   88:11  warning  Empty block statement  no-empty

/home/runner/work/Athena/Athena/web/src/pages/LibraryPage.tsx
Error:   79:40  error  'refreshCacheStatus' is assigned a value but never used  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/pages/ReaderPage.tsx
Error:   36:7  error  'readerStyles' is assigned a value but never used  @typescript-eslint/no-unused-vars

/home/runner/work/Athena/Athena/web/src/pages/app/Home.tsx
Warning:   24:13  warning  Empty block statement  no-empty
Warning:   63:13  warning  Empty block statement  no-empty

/home/runner/work/Athena/Athena/web/src/pages/app/home/ContinueReadingHero.tsx
Warning:   107:11  warning  Empty block statement          no-empty
Error:   187:47  error    'e' is defined but never used  @typescript-eslint/no-unused-vars

✖ 10 problems (6 errors, 4 warnings)

 ELIFECYCLE  Command failed with exit code 1.
Error: Process completed with exit code 1.

# 00_AI_Coding_Constitution_and_Rules.md

> **版本**：v2.1 (App-First Edition)
> **生效日期**：2025-12-09
> **适用对象**：所有参与本项目代码生成、架构设计、测试编写的 AI 助手（包括但不限于 Claude, GPT-4, Grok）。
> **核心变更**：引入 App-First（SQLite + PowerSync）架构约束，强制实施 PowerSync SDK + Native SQLite 数据路径。
> **执行级别**：**最高 (Blocker)**。违反本宪法的代码提交将被 CI 自动拦截，且严禁合并。

---

## 核心指令 (Meta-Instructions)

**在执行任何任务之前，你必须首先确认以下原则：**
1.  **上下文完整性**：你正在在一个已有的、高度复杂的商业化 SaaS 系统中工作。
2.  **离线优先 (Local-First)**：前端开发的默认假设是“设备当前无网络”。UI 必须直接响应本地数据库的变化，而不是等待网络请求。
3.  **后端基石**：后端代码（API/DB）是数据安全和多端同步的最终真理。**除非有明确指令要求重构，否则严禁修改已有的后端逻辑、表结构和接口契约。**
4.  **契约驱动**：前端开发必须严格遵循现有的 API 契约（`contracts/*.yaml`），不得臆造接口。
5.  **执行与强制**：所有变更必须通过 CI 校验。**违反本宪法的 PR 将被自动拒绝。**
6.  **语言规范**：你和用户的所有对话必须使用简体中文。

---

## 第零章：离线优先铁律 (The App-First Prime Directives)

**这是 v2.1 架构的核心，任何前端/移动端代码生成必须首先通过本章校验。**

### 1. UI 数据源唯一性 (Single Source of Truth is Local)
*   **规则**：UI 组件只允许读取 PowerSync Provider 暴露的 SQLite 实体，**禁止**直接用 REST API 渲染数据（实时搜索/支付除外）。
*   **具体表现**：
    *   ❌ **错误**：`useEffect` 中 `await api.get('/books')` 然后 `setBooks(response.data)`。
    *   ✅ **正确**：`const books = useLiveQuery(powersync.books.all())`。
    *   **原理**：UI ↔ SQLite 的绑定由 PowerSync SDK 保证，网络同步完全托管给 SDK/Service。

### 2. 写入操作“本地优先” (Local Writes First)
*   **规则**：所有 CUD 操作必须先落地 SQLite，再由 PowerSync 上传；**任何直接调用 `/api/v1/notes` 的代码都是违规**。
*   **具体表现**：
    *   使用 `powersync.db.execute()` 或 Repository 写入本地表，附带 `device_id`、`_updated_at` 等同步字段。
    *   PowerSync 自动追踪变更队列，无需手动维护 `syncQueue`。
    *   仅限在线操作（AI SSE、支付 webhook、全局搜索）可以直连 REST API。

### 3. 本地 Schema 迁移 (Client-Side Migration)
*   **规则**：SQLite Schema 通过 Migration SQL（或 PowerSync Schema DSL）严格版本化，与后端 Alembic 同等级别。
*   **具体表现**：
    *   Schema 变更必须更新 `web/src/lib/powersync/schema.ts` + `migrations/*.sql`。
    *   在 PR 中列出 Schema 版本号，并提供数据迁移兼容策略（Web WASM + Mobile 原生）。

---

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

---

## 第二章：垂直切片工作流 (Vertical Slice Workflow)

1.  **读取现状 (Check Status)**：
    *   检查 `02_Functional_Specifications_PRD.md` 和后端代码现状。
2.  **API Contract 规范 (必须遵循)**：
    *   格式：OpenAPI 3.0.3 YAML。
    *   实现代码必须与 Contract 保持 100% 一致。
3.  **同步协议定义 (Sync Protocol)**：
    *   在实现新功能前，必须定义该实体的**同步策略**：
        *   **LWW (Last-Write-Wins)**？（如阅读进度）
        *   **Append-Only**？（如日志）
        *   **Conflict-Copy**？（如笔记，冲突时保留副本）
    *   必须在前端 `SyncEngine` 中注册该实体的处理逻辑。

---

## 第三章：数据安全与多租户 (Data Security & Multi-tenancy)

1.  **RLS 强制原则 (Row Level Security)**：
    *   所有业务表必须启用 PostgreSQL RLS。
    *   **严禁**在代码中手动拼接 `WHERE user_id`，必须依赖 `SET LOCAL app.user_id`。
2.  **幂等性 (Idempotency)**：
    *   所有写操作必须检查 `Idempotency-Key`。
3.  **乐观并发控制 (Optimistic Concurrency)**：
    *   更新操作必须使用 `ETag` / `If-Match`。
4.  **隐私与 Secrets**：
    *   严禁将 Secrets 写入源代码。

---

## 第四章：技术强制约束 (Technical Enforcements)

### 1. 统一 API 错误响应规范
*   所有错误必须遵循 JSON Schema (`code`, `message`, `details`)。

### 2. 配置读取铁律
*   商业参数严禁硬编码，必须从 `system_settings` 表读取。

### 3. 计费原子性与事务
*   扣费与服务调用必须在**同一个数据库事务**中完成。

### 4. 时间戳统一标准 (Timestamp Standardization)
*   **规则**：为了解决跨时区同步和冲突检测，时间戳必须统一。
*   **具体表现**：
    *   **存储 (DB/Dexie)**：统一使用 **UTC 毫秒时间戳** (`number` 类型，如 `1733750000000`)。
    *   **传输 (API)**：统一使用 **ISO 8601 UTC 字符串** (如 `"2025-12-09T12:00:00.000Z"`)。
    *   **禁止**：严禁传输或存储“本地时间”（如 "2025-12-09 20:00:00"）。

---

## 第五章：前端与设计系统规范 (Design System Rules)

1.  **单一事实来源 (SSOT)**：设计 Token 唯一来源是 `web/src/styles/figma.css`。
2.  **零硬编码**：严禁写死 Hex 颜色或像素值，必须使用 Tailwind 语义化类名。
3.  **图标规范**：必须使用 `lucide-react`。
4.  **国际化 (i18n)**：严禁硬编码文本，必须使用 `t('key')`。

---

## 第六章：AI 交互行为准则 (AI Behavior Guidelines)

1.  **诚实与拒绝幻觉**：找不到文件直接问，不要臆造。
2.  **自我验证**：在输出前进行 Lint 思维链检查。
3.  **审计日志**：生成代码时需包含模型信息。
4.  **离线意识**：当你编写前端代码时，请时刻自问：“**这段代码在断网（Airplane Mode）时能运行吗？**”如果答案是“不能”（因为它直接 fetch 了 API），那么你的代码就是**违规**的。

---

## 附录 A：标准错误码表 (Standard Error Codes)

| Code | 场景 | HTTP Status | 说明 |
| :--- | :--- | :--- | :--- |
| `QUOTA_EXCEEDED` | 超过配额 | 403 | 上传/写操作被阻断 |
| `READONLY_LOCK` | 只读模式 | 403 | 全局写操作被禁止 |
| `INSUFFICIENT_CREDITS` | Credits 不足 | 402 | 付费操作被拒绝 |
| `SYNC_CONFLICT` | 同步冲突 | 409 | 需客户端处理冲突副本 |
| `SYNC_VERSION_MISMATCH` | 版本不匹配 | 409 | 需客户端拉取最新数据 |
| `DEVICE_ID_REQUIRED` | 缺少设备ID | 400 | 同步操作必须标识来源 |
| `VERSION_CONFLICT` | ETag 校验失败 | 409 | 乐观锁更新冲突 |

## 附录 B：CI 检查清单 (Checklist for PR)

每次提交代码前，请自查：
- [ ] Alembic migration 是否已生成？
- [ ] PowerSync SQLite schema 版本是否更新并附带迁移脚本？
- [ ] 是否通过 PowerSync Repository 进行写操作（而非直接 REST API）？
- [ ] 时间戳是否统一为 UTC？
- [ ] 是否移除了所有硬编码？
- [ ] RLS 是否在测试中验证？
- [ ] PowerSync download/upload config 是否同步更新？
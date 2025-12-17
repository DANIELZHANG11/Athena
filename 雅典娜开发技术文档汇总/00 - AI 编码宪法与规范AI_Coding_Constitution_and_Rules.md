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
    *   使用 `powersync.db.execute()` 或 Repository 写入本地表，附带 `device_id`、`updated_at` 等同步字段。
    *   PowerSync 自动追踪变更队列，无需手动维护 `syncQueue`。
    *   仅限在线操作（AI SSE、支付 webhook、全局搜索）可以直连 REST API。

### 3. 本地 Schema 迁移 (Client-Side Migration)
*   **规则**：SQLite Schema 通过 Migration SQL（或 PowerSync Schema DSL）严格版本化，与后端 Alembic 同等级别。
*   **具体表现**：
    *   Schema 变更必须更新 `web/src/lib/powersync/schema.ts` + `migrations/*.sql`。
    *   在 PR 中列出 Schema 版本号，并提供数据迁移兼容策略（Web WASM + Mobile 原生）。

---

## 第零章 B：API 与 PowerSync 责任分工 (API vs PowerSync Responsibility Matrix)

> **🔴 核心架构规范 - 必须严格遵守**
> **添加日期**：2025-12-16

### 1. 架构原则

```
┌─────────────────────────────────────────────────────────────────────┐
│                    雅典娜数据同步架构                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌─────────────┐        PowerSync         ┌─────────────┐          │
│   │   前端       │ ◄═══════════════════════► │  PostgreSQL │          │
│   │  (SQLite)   │    双向实时同步            │   (后端)    │          │
│   └──────┬──────┘                          └──────┬──────┘          │
│          │                                        │                 │
│          │ REST API (仅特殊场景)                   │                 │
│          └────────────────────────────────────────┘                 │
│                                                                     │
│   【PowerSync 负责】                    【REST API 负责】            │
│   ├─ 书籍元数据 CRUD                    ├─ 文件上传/下载             │
│   ├─ 阅读进度同步                       ├─ AI 对话 (SSE)             │
│   ├─ 笔记/高亮/书签                     ├─ OCR 触发                  │
│   ├─ 书架管理                          ├─ 支付/账单                  │
│   └─ 用户设置                          └─ 认证/登录                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2. 数据表责任矩阵

| 表 | 读取负责方 | 写入负责方 | PowerSync 操作 | REST API 操作 |
|:---|:----------|:----------|:--------------|:-------------|
| **books** | PowerSync | 混合 | UPDATE (metadata_confirmed, deleted_at, title, author) | 创建 (upload_complete)、硬删除 (DELETE) |
| **reading_progress** | PowerSync | PowerSync | INSERT/UPDATE | 无 |
| **reading_sessions** | PowerSync | PowerSync | INSERT/UPDATE | 无 |
| **notes** | PowerSync | PowerSync | 完整 CRUD | 无 |
| **highlights** | PowerSync | PowerSync | 完整 CRUD | 无 |
| **bookmarks** | PowerSync | PowerSync | 完整 CRUD | 无 |
| **shelves** | PowerSync | PowerSync | 完整 CRUD | 无 |
| **shelf_books** | PowerSync | PowerSync | 完整 CRUD | 无 |
| **user_settings** | PowerSync | PowerSync | UPSERT | 无 |

### 3. 操作规范详解

#### 3.1 书籍 (books)

| 操作 | 责任方 | 前端实现 | 后端处理 |
|:-----|:------|:--------|:--------|
| **创建** | REST API | `POST /api/v1/books/upload_complete` | 创建记录，PowerSync 自动同步到客户端 |
| **读取列表** | PowerSync | `SELECT * FROM books WHERE deleted_at IS NULL` | 无 |
| **修改标题/作者** | PowerSync | `UPDATE books SET title=?, author=?` | `powersync.py` 接收并写入 PostgreSQL |
| **软删除** | PowerSync | `UPDATE books SET deleted_at=?` | `powersync.py` 接收并写入 PostgreSQL |
| **恢复删除** | PowerSync | `UPDATE books SET deleted_at=NULL` | `powersync.py` 接收并写入 PostgreSQL |
| **硬删除（含文件）** | REST API | `DELETE /api/v1/books/{id}` | 删除 MinIO 文件 + 私人数据 + 记录 |

> ⚠️ **关键配置**：后端 `api/app/powersync.py` 的 `ALLOWED_TABLES` 必须包含 `books`！

#### 3.2 笔记/高亮/书签 (notes/highlights/bookmarks)

| 操作 | 责任方 | 说明 |
|:-----|:------|:-----|
| **创建** | PowerSync | 离线创建，自动同步 |
| **更新** | PowerSync | 离线更新，自动同步 |
| **软删除** | PowerSync | `UPDATE SET is_deleted=1, deleted_at=?` |
| **读取** | PowerSync | `WHERE is_deleted=0` 过滤 |

#### 3.3 REST API 专属场景（PowerSync 无法处理）

| 场景 | API 端点 | 原因 |
|:-----|:---------|:-----|
| 上传书籍文件 | `POST /books/upload_init` + S3 + `POST /books/upload_complete` | 二进制文件传输 |
| 下载书籍文件 | `GET /books/{id}/content` | 获取 S3 Presigned URL |
| 获取封面图片 | `GET /books/{id}/cover` | 图片二进制流 |
| 触发 OCR | `POST /books/{id}/ocr` | 计算密集型异步任务 |
| AI 对话 | `POST /ai/chat` (SSE) | 流式响应 |
| 认证登录 | `POST /auth/*` | JWT 签发 |
| 支付账单 | `POST /billing/*` | Stripe 集成 |
| 永久删除书籍 | `DELETE /books/{id}` | 需删除私人数据和更新引用计数 |

### 4. 代码实现规范

**✅ 正确示例 - 使用 PowerSync 修改书籍元数据：**
```typescript
const db = usePowerSyncDatabase()
await db.execute(
  'UPDATE books SET title = ?, author = ?, updated_at = ? WHERE id = ?',
  [newTitle, newAuthor, new Date().toISOString(), bookId]
)
// PowerSync 自动同步到服务器
```

**✅ 正确示例 - 使用 PowerSync 软删除书籍：**
```typescript
await db.execute(
  'UPDATE books SET deleted_at = ?, updated_at = ? WHERE id = ?',
  [new Date().toISOString(), new Date().toISOString(), bookId]
)
// 30天后由后台任务硬删除
```

**❌ 错误示例 - 不应该用 API 修改元数据：**
```typescript
// 错误：绕过了 PowerSync，导致数据不一致
await fetch(`/api/v1/books/${bookId}/metadata`, {
  method: 'PATCH',
  body: JSON.stringify({ title: newTitle })
})
```

### 5. 关键配置文件

| 配置项 | 文件位置 | 说明 |
|:------|:--------|:-----|
| PowerSync Bucket Rules | `docker/powersync/sync_rules.yaml` | 定义同步规则和字段映射 |
| SQLite Schema | `web/src/lib/powersync/schema.ts` | 9 同步表 + 3 本地表 |
| ALLOWED_TABLES | `api/app/powersync.py` | PowerSync 写入白名单 |
| JWT Claims | `api/app/auth.py` | `sub` (user_id) + `aud` ("authenticated") |

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
    *   必须在 sync_rules.yaml 中配置 PowerSync 同步规则。

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
    *   **存储 (PostgreSQL)**：统一使用 **TIMESTAMPTZ** 类型（UTC 时区）。
    *   **存储 (SQLite/PowerSync)**：统一使用 **ISO 8601 UTC 字符串** (`TEXT` 类型，如 `"2025-12-09T12:00:00.000Z"`)。
    *   **传输 (API)**：统一使用 **ISO 8601 UTC 字符串** (如 `"2025-12-09T12:00:00.000Z"`)。
    *   **禁止**：严禁传输或存储"本地时间"（如 "2025-12-09 20:00:00"）。

### 5. UI 时区显示规范 (UI Timezone Display)
*   **规则**：存储和传输使用 UTC，但 UI 显示必须转换为用户本地时区。
*   **具体表现**：
    *   **日期显示**：使用 `date-fns` 或 `Intl.DateTimeFormat` 将 UTC 转换为用户时区。
    *   **相对时间**：使用 `formatRelativeTime()` 或 `date-fns/formatDistance` 显示"5分钟前"。
    *   **日历视图**：根据用户时区计算"今天"的边界。
    *   **阅读连续天数 (Lazy Reset)**：新一天的判定基于用户时区凌晨 4:00，而非 UTC 00:00。
*   **代码示例**：
```typescript
// ✅ 正确：使用 Intl 转换为本地时区显示
const displayDate = new Intl.DateTimeFormat(locale, {
  dateStyle: 'medium',
  timeStyle: 'short'
}).format(new Date(utcTimestamp))

// ✅ 正确：使用 date-fns 转换
import { formatInTimeZone } from 'date-fns-tz'
const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone
const localTime = formatInTimeZone(utcTimestamp, userTz, 'yyyy-MM-dd HH:mm')

// ❌ 错误：直接显示 UTC 时间给用户
const wrongDisplay = new Date(utcTimestamp).toISOString()
```

---

## 第五章：前端与设计系统规范 (Design System Rules)

1.  **单一事实来源 (SSOT)**：设计 Token 唯一来源是 `web/src/styles/figma.css`。
2.  **零硬编码**：严禁写死 Hex 颜色或像素值，必须使用 Tailwind 语义化类名。
3.  **图标规范**：必须使用 `lucide-react`。
4.  **国际化 (i18n) 规范**：
    *   **严禁硬编码文本**：所有用户可见文本必须使用 `t('key')` 函数。
    *   **翻译文件位置**：`web/translations/*.json`（zh-CN.json, en.json 等）。
    *   **错误信息翻译**：后端只返回错误码（如 `quota_exceeded`），前端负责翻译显示。
    *   **动态内容**：使用 `t('key', { count, name })` 处理插值。
    *   **日期格式化**：使用 `Intl.DateTimeFormat` 或 `date-fns` 的 locale 参数。
    *   **复数规则**：使用 i18next 的 `_one`/`_other` 后缀。
```typescript
// ✅ 正确
<p>{t('books.upload_success')}</p>
<p>{t('books.count', { count: bookCount })}</p>

// ❌ 错误
<p>上传成功！</p>
<p>您有 {bookCount} 本书</p>
```

---

## 第六章：AI 交互行为准则 (AI Behavior Guidelines)

1.  **诚实与拒绝幻觉**：找不到文件直接问，不要臆造。
2.  **自我验证**：在输出前进行 Lint 思维链检查。
3.  **审计日志**：生成代码时需包含模型信息。
4.  **离线意识**：当你编写前端代码时，请时刻自问：“**这段代码在断网（Airplane Mode）时能运行吗？**”如果答案是“不能”（因为它直接 fetch 了 API），那么你的代码就是**违规**的。

---

## 附录 A：标准错误码表 (Standard Error Codes)

> **注意**：错误码统一使用 **小写 snake_case** 格式。
> 后端返回 `HTTPException(detail="quota_exceeded")`，前端使用 `t('errors.quota_exceeded')` 翻译显示。

| Code | 场景 | HTTP Status | 说明 |
| :--- | :--- | :--- | :--- |
| `quota_exceeded` | 超过配额 | 403 | 上传/写操作被阻断 |
| `readonly_mode` | 只读模式 | 403 | 全局写操作被禁止 |
| `insufficient_credits` | Credits 不足 | 402 | 付费操作被拒绝 |
| `sync_conflict` | 同步冲突 | 409 | 需客户端处理冲突副本 |
| `version_conflict` | 版本不匹配 | 409 | 乐观锁更新冲突（需客户端拉取最新数据） |
| `device_id_required` | 缺少设备ID | 400 | 同步操作必须标识来源 |
| `ocr_quota_exceeded` | OCR 配额不足 | 403 | OCR 次数用尽 |
| `ocr_max_pages_exceeded` | 页数超限 | 400 | 书籍超过 2000 页限制 |

## 附录 B：CI 检查清单 (Checklist for PR)

每次提交代码前，请自查：
- [ ] Alembic migration 是否已生成？
- [ ] PowerSync SQLite schema 版本是否更新并附带迁移脚本？
- [ ] 是否通过 PowerSync Repository 进行写操作（而非直接 REST API）？
- [ ] 时间戳是否统一为 UTC？
- [ ] 是否移除了所有硬编码？
- [ ] RLS 是否在测试中验证？
- [ ] PowerSync download/upload config 是否同步更新？
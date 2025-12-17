# 05 - API 契约与协议 (API Contracts & Protocols)

> **版本**: v1.1
> **最后更新**: 2025-12-13
> **SSOT (Single Source of Truth)**: 具体的 Request/Response Schema 以 `contracts/api/v1/*.yaml` (OpenAPI) 文件为唯一事实来源。本文档仅作为核心协议与交互逻辑的开发者手册。

## 1. 接口设计规范 (Interface Design Specifications)

### 1.1 版本控制与路径
所有 API 均遵循 RESTful 风格，URI 必须包含版本号：
*   **Base URL**: `https://api.athena.app/api/v1`
*   **Format**: `/api/v1/{resource}/{id}/{action}`

### 1.2 认证与鉴权 (Authentication)
*   **Header**: `Authorization: Bearer <access_token>`
*   **Token Type**: JWT (JSON Web Token)
*   **Token Source**: 通过 `/api/v1/auth/email/verify_code` 获取。
*   **无状态性**: 服务端不存储 Session，完全依赖 JWT 签名验证。

### 1.3 跨域资源共享 (CORS)
*   **Policy**: 严格限制 Origin，仅允许白名单域名（Web/Mobile App）。
*   **Headers**: 允许标准 Headers 及自定义 Headers (`Idempotency-Key`, `If-Match`)。

---

## 2. 标准错误码表 (Global Error Codes)

以下错误码对应 `HTTPException(status_code=..., detail="...")` 中的 `detail` 字段。

| Code (detail) | HTTP Status | Description |
| :--- | :--- | :--- |
| `unauthorized` | 401 | 认证失败或 Token 过期 |
| `forbidden` | 403 | 权限不足 |
| `not_found` | 404 | 资源不存在 |
| `missing_if_match` | 428 | 缺少 `If-Match` 头（针对乐观锁资源） |
| `invalid_if_match` | 400 | `If-Match` 格式错误（需为 `W/"<version>"`） |
| `version_conflict` | 409 | 资源版本冲突（乐观锁检查失败） |
| `quota_exceeded` | 403 | 存储或书籍配额超限，账户进入只读模式 |
| `upload_forbidden_quota_exceeded` | 403 | 上传动作因配额超限被拒绝 |
| `ocr_quota_exceeded` | 403 | OCR 配额不足 |
| `ocr_max_pages_exceeded` | 400 | 书籍页数超过 2000 页限制 |
| `ocr_in_progress` | 409 | OCR 任务正在处理中 |
| `already_digitalized` | 400 | 书籍已是文字型，无需 OCR |
| `missing_filename` | 400 | 上传初始化时缺少文件名 |
| `missing_key` | 400 | 上传完成时缺少 S3 Object Key |
| `canonical_not_found` | 404 | 秒传时原书不存在 |
| `device_id_required` | 400 | 同步操作缺少设备 ID |
| `rate_limited` | 429 | 请求频率过高 |
| `internal_error` | 500 | 服务器内部错误 |

---

## 3. 同步接口 (Sync API) - [DEPRECATED]

> **STATUS**: **DEPRECATED**. Replaced by PowerSync Protocol.
> The legacy REST-based sync APIs (`/sync/initial`, `/sync/pull`, `/sync/push`) are no longer used. Data synchronization is handled transparently by the PowerSync SDK and Service.

### 3.A PowerSync 访问协议（New）
- **Endpoint**: `wss://sync.athena.app/stream`（生产） / `ws://localhost:8090/stream`（本地）。
- **Auth**: 与 REST 相同的 `Authorization: Bearer <JWT>`，PowerSync Service 会验证并在连接上下文中注入 `user_id`、`device_id`。
- **Metadata**: 客户端在 `connect()` 时需传入：
  ```json
  {
    "client": "web|ios|android",
    "sdk_version": "1.2.0",
    "device_id": "uuid",
    "schema_version": 3
  }
  ```
- **Backpressure**: SDK 自动处理；Service 端暴露 `stream_lag_ms` 指标供监控。
- **错误映射**: PowerSync 错误码映射至 REST 错误：`permission_denied -> 403`, `validation_failed -> 400`, `conflict -> 409`。

### 3.B API 与 PowerSync 职责分离 (Responsibility Separation)

> **新增日期**: 2025-06-17
> **重要性**: 🔴 核心架构决策 - 所有开发者必读

雅典娜采用 **App-First 架构**，PowerSync 负责数据同步，REST API 负责文件操作和复杂业务逻辑。**两者使用统一的 JWT 认证**，避免 token 分裂。

#### 3.B.1 职责划分表

| 功能类别 | 负责方 | 说明 |
| :--- | :--- | :--- |
| **用户认证** | REST API | 登录、发送验证码、token 签发与刷新 |
| **元数据同步** | PowerSync | 书籍列表、笔记、高亮、阅读进度、书架 |
| **文件上传** | REST API | 书籍文件通过 S3 Presigned URL 上传，PowerSync 无法传输二进制文件 |
| **文件下载** | REST API + S3 | 获取 Presigned Download URL |
| **OCR 任务** | REST API | 触发 OCR、查询进度（计算密集型任务） |
| **AI 功能** | REST API | 流式响应、向量检索、对话历史 |
| **账单支付** | REST API | Stripe 集成、配额管理 |
| **离线读写** | PowerSync (SQLite) | 本地优先，后台自动同步 |
| **实时通知** | PowerSync | 通过同步流推送状态变更 |

#### 3.B.2 JWT 统一规范

**单一 Token 源**: 所有 JWT 由 REST API 的 `/auth/*` 端点签发，PowerSync 和 API 使用相同的 secret 验证。

```
┌─────────────────┐                    ┌─────────────────┐
│   REST API      │ ──── 签发 JWT ──→  │     客户端      │
│  (auth.py)      │                    │                 │
└─────────────────┘                    └────────┬────────┘
        ↑                                       │
        │ 相同 secret                           │ 同一个 JWT
        ↓                                       ↓
┌─────────────────┐                    ┌─────────────────┐
│   PowerSync     │ ←── 验证 JWT ────  │     客户端      │
│  (验证器)       │                    │  (sync 请求)    │
└─────────────────┘                    └─────────────────┘
```

**必须包含的 JWT Claims**:
```json
{
  "sub": "<user_id>",           // 必须: 用户 ID
  "aud": "authenticated",       // 必须: PowerSync Supabase 模式要求
  "iat": 1718600000,
  "exp": 1718686400
}
```

**关键配置（docker-compose.yml）**:
```yaml
# REST API
api:
  environment:
    AUTH_SECRET: ${AUTH_SECRET:-dev_powersync_secret_change_in_production}

# PowerSync
powersync:
  environment:
    PS_SUPABASE_JWT_SECRET: ${AUTH_SECRET:-dev_powersync_secret_change_in_production}
```

> ⚠️ **警告**: API 和 PowerSync 的 JWT secret 必须完全一致，否则客户端无法同时访问两个服务。

#### 3.B.3 典型工作流示例

**上传书籍**（需要 API + PowerSync 协作）:
```
1. [客户端] 调用 POST /api/v1/books/upload_init → 获取 S3 Presigned URL
2. [客户端] PUT 文件到 S3
3. [客户端] 调用 POST /api/v1/books/upload_complete → 创建 books 记录
4. [PowerSync] 自动同步 books 表变更到所有设备
5. [客户端其他设备] 通过 PowerSync 接收到新书，显示在书架
```

**创建笔记**（纯 PowerSync）:
```
1. [客户端] 写入本地 SQLite (notes 表)
2. [PowerSync SDK] 后台自动推送到服务器
3. [服务器] 写入 PostgreSQL
4. [PowerSync] 同步到其他设备
```

**AI 对话**（纯 REST API）:
```
1. [客户端] POST /api/v1/ai/chat (SSE)
2. [API] 流式返回 AI 响应
3. [客户端] 实时显示
```

#### 3.B.4 故障排查检查清单

| 症状 | 可能原因 | 解决方案 |
| :--- | :--- | :--- |
| API 认证成功，PowerSync 401 | JWT secret 不一致 | 检查 `AUTH_SECRET` 和 `PS_SUPABASE_JWT_SECRET` 是否相同 |
| PowerSync "Known keys: " 空 | 缺少 `supabase: true` 配置 | 在 powersync.yaml 中启用 Supabase 模式 |
| Token 刷新后仍然 401 | 浏览器缓存旧 token | 强制刷新页面或清除 localStorage |
| 上传成功但书架不显示 | PowerSync 未连接 | 检查 WebSocket 连接状态 |
| 书籍元数据同步但封面不显示 | 封面 URL 过期 | 检查 S3 Presigned URL 有效期 |

---

## 3.C PowerSync 数据操作规范 (Data Operation Specification)

> **新增日期**: 2025-12-16
> **重要性**: 🔴 **核心架构规范 - 必须严格遵守**
> **原则**: PowerSync 是主要同步通道，REST API 仅用于 PowerSync 无法处理的场景

### 3.C.1 核心原则

```
┌─────────────────────────────────────────────────────────────────────┐
│                    数据同步架构                                       │
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
└─────────────────────────────────────────────────────────────────────┘
```

**核心原则**：
1. **PowerSync 优先**：所有 CRUD 操作优先使用 PowerSync 本地写入
2. **API 辅助**：仅文件操作、计算密集型任务使用 REST API
3. **离线优先**：用户操作应立即响应，后台自动同步

### 3.C.2 数据表操作规范

#### 表 1: books（书籍元数据）

| 操作 | 负责方 | 前端实现 | 说明 |
|:-----|:------|:--------|:-----|
| **创建** | REST API | `POST /api/v1/books/upload_complete` | 上传流程创建，PowerSync 自动同步到客户端 |
| **读取** | PowerSync | `SELECT * FROM books` | 实时响应式查询 |
| **更新标题/作者** | PowerSync | `UPDATE books SET title=?, author=? WHERE id=?` | 本地写入，自动同步到服务器 |
| **软删除** | PowerSync | `UPDATE books SET deleted_at=? WHERE id=?` | 本地写入，自动同步到服务器 |
| **硬删除(含文件)** | REST API | `DELETE /api/v1/books/{id}` | 需要删除 MinIO 文件 |
| **恢复删除** | PowerSync | `UPDATE books SET deleted_at=NULL WHERE id=?` | 本地写入，自动同步 |

> **⚠️ 关键配置**: 后端 `powersync.py` 的 `ALLOWED_TABLES` 必须包含 `books`！

#### 表 2: reading_progress（阅读进度）

| 操作 | 负责方 | 前端实现 | 说明 |
|:-----|:------|:--------|:-----|
| **创建/更新** | PowerSync | `INSERT OR REPLACE INTO reading_progress` | 实时保存，跨设备同步 |
| **读取** | PowerSync | `SELECT * FROM reading_progress WHERE book_id=?` | 响应式查询 |

#### 表 3: notes / highlights / bookmarks（笔记/高亮/书签）

| 操作 | 负责方 | 前端实现 | 说明 |
|:-----|:------|:--------|:-----|
| **创建** | PowerSync | `INSERT INTO notes (...)` | 离线创建，自动同步 |
| **更新** | PowerSync | `UPDATE notes SET ... WHERE id=?` | 离线更新 |
| **软删除** | PowerSync | `UPDATE notes SET is_deleted=1, deleted_at=?` | 离线删除 |
| **读取** | PowerSync | `SELECT * FROM notes WHERE book_id=? AND is_deleted=0` | 响应式 |

#### 表 4: shelves / shelf_books（书架）

| 操作 | 负责方 | 前端实现 | 说明 |
|:-----|:------|:--------|:-----|
| **创建书架** | PowerSync | `INSERT INTO shelves (...)` | 离线创建 |
| **更新书架** | PowerSync | `UPDATE shelves SET ... WHERE id=?` | 离线更新 |
| **删除书架** | PowerSync | `UPDATE shelves SET is_deleted=1` | 软删除 |
| **添加书籍到书架** | PowerSync | `INSERT INTO shelf_books (...)` | 离线操作 |
| **从书架移除书籍** | PowerSync | `DELETE FROM shelf_books WHERE ...` | 离线操作 |

### 3.C.3 REST API 专属场景

以下场景 **必须** 使用 REST API，因为 PowerSync 无法处理：

| 场景 | API 端点 | 原因 |
|:-----|:---------|:-----|
| **上传书籍文件** | `POST /books/upload_init` + S3 + `POST /books/upload_complete` | 二进制文件传输 |
| **下载书籍文件** | `GET /books/{id}/content` | 获取 S3 Presigned URL |
| **获取封面图片** | `GET /books/{id}/cover` | 图片二进制流 |
| **触发 OCR** | `POST /books/{id}/ocr/trigger` | 计算密集型异步任务 |
| **AI 对话** | `POST /ai/chat` (SSE) | 流式响应 |
| **AI 向量搜索** | `POST /ai/search` | 需要 OpenSearch |
| **认证登录** | `POST /auth/*` | JWT 签发 |
| **账单支付** | `POST /billing/*` | Stripe 集成 |
| **永久删除书籍** | `DELETE /books/{id}/permanent` | 需要删除私人数据和更新引用计数 |
| **批量永久删除** | `DELETE /books/permanent` | 批量删除私人数据 |

> **⚠️ 注意**：软删除（设置 `deleted_at`）应使用 PowerSync；  
> 恢复删除（清除 `deleted_at`）也应使用 PowerSync（与软删除对称）；  
> 永久删除（清理私人数据）**必须**使用 REST API，因为需要：
> 1. 删除 notes, highlights, bookmarks, reading_progress 等关联数据
> 2. 更新引用书的 `storage_ref_count`
> 3. 检查是否需要清理孤立的原书

### 3.C.4 后端 ALLOWED_TABLES 配置

**位置**: `api/app/powersync.py`

```python
ALLOWED_TABLES = {
    "books",              # ✅ 必须添加！允许元数据修改和软删除
    "reading_progress",
    "reading_sessions",
    "notes",
    "highlights",
    "bookmarks",
    "shelves",
    "shelf_books",
    "user_settings",
}
```

> **🔴 重要**: 如果 `books` 不在白名单中，前端对书籍的所有修改都不会同步到服务器！

### 3.C.5 前端代码实现规范

**✅ 正确示例 - 使用 PowerSync：**
```typescript
// 修改书籍元数据
const db = usePowerSync()
await db.execute(
  'UPDATE books SET title = ?, author = ?, updated_at = ? WHERE id = ?',
  [newTitle, newAuthor, new Date().toISOString(), bookId]
)
// PowerSync 自动同步到服务器，无需额外处理
```

**✅ 正确示例 - 软删除书籍：**
```typescript
await db.execute(
  'UPDATE books SET deleted_at = ?, updated_at = ? WHERE id = ?',
  [new Date().toISOString(), new Date().toISOString(), bookId]
)
// 30天后由后台任务硬删除
```

**❌ 错误示例 - 不应该这样做：**
```typescript
// 错误：不应该用 API 修改元数据（除非必须删除文件）
await fetch(`/api/v1/books/${bookId}/metadata`, {
  method: 'PATCH',
  body: JSON.stringify({ title: newTitle })
})
// 这绕过了 PowerSync，导致数据不一致
```

### 3.C.6 同步流程图

```
用户操作 (书籍元数据修改)
     │
     ▼
┌─────────────────┐
│  前端 SQLite    │  ← 1. 立即写入本地数据库
│  (PowerSync)    │
└────────┬────────┘
         │
         ▼  2. PowerSync SDK 后台推送
┌─────────────────┐
│  PowerSync      │  ← 3. 调用 /api/v1/sync/upload
│  Connector      │
└────────┬────────┘
         │
         ▼  4. 写入 PostgreSQL
┌─────────────────┐
│   PostgreSQL    │
│   (后端数据库)   │
└────────┬────────┘
         │
         ▼  5. PowerSync sync_rules 检测变更
┌─────────────────┐
│  其他设备       │  ← 6. 实时同步到所有设备
│  (PowerSync)    │
└─────────────────┘
```

---

### [DEPRECATED] 3.1 初始全量同步 (Initial Sync)
*(Legacy content preserved for reference, do not implement)*


用于新设备首次登录时一次性下载所有必须同步的业务数据。

*   **Endpoint**: `GET /api/v1/sync/initial`
*   **Query Params**:
    *   `offset`: Integer (分页偏移量，用于断点续传)
    *   `limit`: Integer (每次请求数量，默认 50)
    *   `category`: String (数据类别: 'metadata' | 'covers' | 'notes' | 'all')
*   **Headers**:
    *   `Range`: 封面图片等大文件支持断点续传
*   **Response**: 
    ```json
    {
      "data": {
        "books": [...],        // 书籍元数据
        "progress": [...],     // 阅读进度
        "shelves": [...],      // 书架
        "settings": {...},     // 用户设置
        "readerSettings": [...], // 每本书的阅读器设置（完整快照）
        "notes": [...],        // 笔记
        "highlights": [...],   // 高亮
        "aiHistory": [...],    // AI对话历史（离线只读）
        "billing": [...]       // 账单记录（离线只读）
      },
      "pagination": {
        "offset": 0,
        "limit": 50,
        "total": 150,
        "hasMore": true
      },
      "timestamp": 1733650000
    }
    ```

**首次同步策略（完全体确认）**：
| 配置项 | 决策 | 说明 |
| :--- | :--- | :--- |
| 下载方式 | 一次性下载 | 显示进度条，一次性下载全部数据 |
| 断点续传 | 必须支持 | 服务器分包传输，支持 HTTP Range |
| 封面图片 | 必须下载 | 全部封面纳入首次同步 |
| 不同步项 | 书籍文件/OCR/向量 | 按需下载 |

### 3.2 增量拉取 (Pull Changes)
*   **Endpoint**: `GET /api/v1/sync/pull`
*   **Query Params**: `last_synced_at` (Timestamp)
*   **Response**:
    ```json
    {
      "changes": {
        "books": { "created": [], "updated": [], "deleted": [] },
        "notes": { ... }
      },
      "timestamp": 1733650000
    }
    ```

### 3.3 增量推送 (Push Changes)
*   **Endpoint**: `POST /api/v1/sync/push`
*   **Body**:
    ```json
    {
      "changes": [
        { "table": "notes", "op": "create", "data": { ... } },
        { "table": "progress", "op": "update", "data": { ... } }
      ]
    }
    ```
*   **Conflict Handling**: 服务端检测冲突并返回解决结果。
    *   阅读进度：LWW（始终以最新 `_updatedAt` 为准）
    *   笔记/高亮：智能合并（内容相同保留最新；不同则生成两版本）
    *   删除 vs 修改：以修改为准（数据不丢失优先）

### [DEPRECATED] 3.4 资源断点续传
*   **Endpoint**: `GET /api/v1/sync/covers/{book_id}`
*   **Headers**: `Range: bytes=0-1024`
*   **Response**: `206 Partial Content`

---

## 4. 特殊交互协议 (Special Protocols)

### 4.1 幂等性设计 (Idempotency)
防止网络重试导致的数据重复创建。

*   **Header**: `Idempotency-Key: <UUID>`
*   **适用范围**: 所有非安全方法 (`POST`, `PATCH`, `DELETE`)，特别是 `POST /api/v1/books` 和 `POST /api/v1/notes`。
*   **后端机制**:
    1.  Redis 缓存 Key: `idem:{resource}:{action}:{user_id}:{key}`。
    2.  TTL: 24 小时。
    3.  **Hit**: 直接返回缓存的 Response Body (HTTP 200)。
    4.  **Miss**: 执行业务逻辑 -> 缓存结果 -> 返回。

### 4.2 乐观并发控制 (Optimistic Concurrency)
解决多端同时修改同一资源（如笔记、标签）的冲突问题。

*   **Header**: `If-Match: W/"<version>"` (Weak ETag format)
*   **适用范围**: `PATCH /api/v1/notes/{id}`, `PATCH /api/v1/tags/{id}`, `PATCH /api/v1/books/{id}`。
*   **交互流程**:
    1.  **Read**: Client 获取资源，获得 `etag: W/"1"` (对应 DB `version=1`)。
    2.  **Update**: Client 发送 `PATCH` 请求，带上 `If-Match: W/"1"`。
    3.  **Verify**:
        *   若 DB `version == 1`: 更新成功，DB `version` -> 2，返回 200。
        *   若 DB `version > 1`: 更新失败，抛出 `409 Conflict (version_conflict)`。
    4.  **Resolve**: Client 收到 409 后，应重新拉取最新数据，合并冲突后重试。

### 4.3 文件上传协议 (Direct Upload)
采用 S3 Presigned URL 模式，文件流不经过 API Server。支持 **SHA256 全局去重**（ADR-008）。

*   **流程**:
    1.  **Init**: `POST /api/v1/books/upload_init`
        *   Body: `{ "filename": "book.pdf", "content_type": "application/pdf", "content_sha256": "6f4c24abd60a55d3..." }`
        *   Resp (正常上传): `{ "upload_url": "https://s3...", "key": "raw/...", "dedup_available": false }`
        *   Resp (全局去重命中): `{ "dedup_available": true, "canonical_id": "uuid", "has_ocr": true }`
    2.  **Upload** (仅当 `dedup_available=false`):
        *   Client `PUT` 文件流至 `upload_url`
    3.  **Complete** (正常上传): `POST /api/v1/books/upload_complete`
        *   Body: `{ "key": "raw/...", "title": "..." }`
        *   Resp: `{ "id": "book_uuid", "status": "processing" }`
    4.  **Dedup Reference** (秒传): `POST /api/v1/books/dedup_reference`
        *   Body: `{ "filename": "book.pdf", "content_sha256": "6f4c24abd60a55d3...", "size": 12345678 }`
        *   Resp: `{ "id": "new_book_uuid", "dedup_type": "global", "canonical_book_id": "original_uuid", "has_ocr": true }`
*   **SHA256 全局去重**: 相同文件只存储一份，通过 `content_sha256` 实现全局去重和秒传。
*   **服务端备用计算**: 若客户端未提供 `content_sha256`（移动端可能失败），服务端在 `upload_complete` 时从 S3 读取文件计算。

### 4.4 AI 流式响应 (SSE)
基于 Server-Sent Events 标准。

*   **Endpoint**: `GET /api/v1/ai/stream`
*   **Content-Type**: `text/event-stream`
*   **Message Format**: `data: <content>\n\n`
*   **Event Protocol**:
    1.  **Start**: `data: BEGIN\n\n` (连接建立)
    2.  **Delta**: `data: <token_chunk>\n\n` (持续推送)
    3.  **End**: 连接关闭 (Client 收到 EOF 或后端关闭)
*   **Cache**: 支持 Redis 缓存（基于 Prompt Hash），缓存命中时会以极快速度重放 SSE 流。

### 4.5 实时同步 (WebSocket)
用于笔记与文档的协同编辑。

*   **Endpoint**: `ws://api.athena.app/ws/notes/{note_id}`
*   **Sub-Protocol**: 无（Raw WebSocket）。
*   **Payload Protocol**: **Custom JSON Protocol** (Lite Yjs-like).
    *   **Handshake**: Server 发送 `{"type": "ready", "version": <int>}`。
    *   **Update**: Client 发送 `{"type": "update", "client_version": <int>, "update": "<base64>"}`。
    *   **Conflict**: Server 返回 `{"type": "conflict", "version": <int>}`，Client 需重置。
*   **Auth**: 通过 URL Query Parameter (`?token=...`) 或 Header 传递 Token。

---

## 5. 核心接口索引 (Key Endpoints Index)

> 完整 Schema 请查阅 `contracts/api/v1/` 下的 YAML 文件。

### 5.1 Auth & User (`auth.yaml`)
*   `POST /api/v1/auth/email/send_code`: 发送验证码
*   `POST /api/v1/auth/email/verify_code`: 登录/注册 (获取 Token)
*   `GET /api/v1/auth/me`: 获取当前用户信息

### 5.2 Books (`books.yaml`)
*   `GET /api/v1/books`: 书籍列表 (Cursor Pagination)
*   `POST /api/v1/books/upload_init`: 上传初始化 (支持 SHA256 去重检查)
*   `POST /api/v1/books/upload_complete`: 上传完成 (服务端备用 SHA256 计算)
*   `POST /api/v1/books/dedup_reference`: **秒传接口** (SHA256 全局去重)
*   `GET /api/v1/books/{id}`: 书籍详情
*   `PATCH /api/v1/books/{id}`: 更新书籍元数据 (支持 `If-Match`)
*   `DELETE /api/v1/books/{id}`: 删除书籍 (软删除/硬删除分层策略)

### 5.3 Notes & Highlights (`notes.yaml`, `highlights.yaml`, `tags.yaml`)
*   `GET /api/v1/notes`: 笔记列表
*   `POST /api/v1/notes`: 创建笔记 (支持 `Idempotency-Key`)
*   `PATCH /api/v1/notes/{id}`: 更新笔记 (支持 `If-Match`)
*   `GET /api/v1/highlights`: 高亮列表
*   `GET /api/v1/tags`: 标签列表
*   `POST /api/v1/tags`: 创建标签

### 5.4 AI (`ai.yaml`)
*   `GET /api/v1/ai/stream`: AI 对话流 (SSE) - *注: 目前设计为 GET，未来可能迁移至 POST*
*   `GET /api/v1/ai/conversations`: 对话历史列表

### 5.5 Realtime Docs (`realtime.py`)
*   `WS /ws/notes/{note_id}`: 笔记/文档实时同步通道

### 5.6 Billing (`billing.yaml`) [待完善]
*   `GET /api/v1/billing/plans`: 获取订阅方案
*   `POST /api/v1/billing/checkout`: 创建支付会话

### 5.7 Books Metadata (`books.yaml`)
*   `PATCH /api/v1/books/{id}/metadata`: 更新书籍元数据（书名、作者）
*   `GET /api/v1/books/{id}`: 书籍详情（包含 `metadata_confirmed` 状态）

---

## 6. 智能心跳同步协议 (Smart Heartbeat Sync Protocol) - [DEPRECATED]

> **STATUS**: ❌ **DEPRECATED** (ADR-007)
> 
> **废弃原因**: PowerSync 使用 WebSocket/HTTP 流式协议进行实时同步，无需自定义心跳。
> 
> **替代方案**: PowerSync SDK 自动处理连接保活、断线重连和增量同步。
> 
> **迁移指南**: 删除 `useHeartbeat` hook，改用 `usePowerSync` 即可。原心跳逻辑已由 PowerSync 内置机制接管。

---

## 7. OCR 服务触发接口

> **设计原则**：OCR 是收费/限额服务，由用户主动触发，而非上传后自动执行。

### 7.1 触发 OCR 处理

#### `POST /api/v1/books/{book_id}/ocr`

用户主动请求对图片型 PDF 进行 OCR 处理。支持 **OCR 复用（假 OCR）**（ADR-008）。

**Request Headers**:
```
Authorization: Bearer <access_token>
```

**Path Parameters**:
| 参数 | 类型 | 说明 |
|-----|------|------|
| `book_id` | UUID | 书籍 ID |

**处理逻辑**:
1. 正常配额检查和扣费（阶梯计费）
2. 检查是否可复用（相同 SHA256 已有 OCR 结果）
   - 可复用 → 假 OCR，秒级完成
   - 不可复用 → 真实 OCR，提交 Celery 任务

**Response 200** (OCR 复用 - 假 OCR):
```typescript
{
  "status": "instant_completed",
  "ocrResultKey": "ocr-result-xxx.json",
  "message": "OCR 结果已复用，处理完成。"
}
```

**Response 200** (成功加入队列 - 真实 OCR):
```typescript
{
  "status": "queued",
  "queuePosition": number,        // 队列位置
  "estimatedMinutes": number,     // 预计处理时间（分钟）
  "message": "OCR 任务已进入排队，预计 15 分钟后完成。您现在可以继续阅读该书，但暂时无法使用笔记和 AI 服务。"
}
```

**Response 400** (书籍已是文字型):
```typescript
{
  "error": "already_digitalized",
  "message": "该书籍已经是文字型，无需进行 OCR 处理。"
}
```

**Response 400** (超过页数限制):
```typescript
{
  "error": "ocr_max_pages_exceeded",
  "message": "该书籍页数超过 2000 页，暂不支持 OCR 处理。"
}
```

**Response 403** (OCR 配额不足):
```typescript
{
  "error": "ocr_quota_exceeded",
  "message": "您的 OCR 配额已用尽。免费用户每月可处理 3 本书籍，升级会员可获得更多配额。",
  "quota": {
    "used": 3,
    "limit": 3,
    "resetAt": "2025-01-01T00:00:00Z"
  }
}
```

**Response 409** (OCR 已在处理中):
```typescript
{
  "error": "ocr_in_progress",
  "message": "该书籍的 OCR 任务正在处理中，请稍候。",
  "queuePosition": 2,
  "estimatedMinutes": 10
}
```

> **商业逻辑（⚠️ 重要）**:
> - 用户**必须**点击 OCR 按钮才能看到 OCR 结果（商业闭环）
> - 即使是复用（假 OCR），也**必须**扣除配额（维护商业公平性）
> - 但不消耗 GPU 算力（降低运营成本）

### 6.2 查询 OCR 状态

#### `GET /api/v1/books/{book_id}/ocr/status`

查询书籍的 OCR 处理状态。

**Response 200**:
```typescript
{
  "bookId": string,
  "isDigitalized": boolean,       // 是否已是文字型
  "ocrStatus": "pending" | "processing" | "completed" | "failed" | null,
  "queuePosition"?: number,       // 仅当 status=pending 时返回
  "estimatedMinutes"?: number,
  "completedAt"?: string,         // 仅当 status=completed 时返回
  "errorMessage"?: string         // 仅当 status=failed 时返回
}
```

### 6.3 前端集成示例

```typescript
// 检测到图片型 PDF 后显示的对话框
function OcrPromptDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  
  const handleOcrNow = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/books/${book.id}/ocr`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      
      if (res.ok) {
        const data = await res.json();
        toast.success(`OCR 已进入排队，预计 ${data.estimatedMinutes} 分钟后完成`);
        onClose();
      } else if (res.status === 403) {
        const data = await res.json();
        toast.error(data.message);
        // 显示升级会员弹窗
      }
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Dialog open onClose={onClose}>
      <DialogTitle>📖 书籍初检完成</DialogTitle>
      <DialogContent>
        <p>
          您上传的《{book.title}》经过雅典娜初步检查，此书为图片形式的 PDF 电子书。
          为了获得更好的阅读、笔记以及 AI 提问体验，我们建议您对此书进行图片转文本（OCR）服务。
        </p>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>稍后再处理</Button>
        <Button variant="primary" onClick={handleOcrNow} loading={loading}>
          🚀 马上转换
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

---

## 8. 笔记/高亮冲突处理接口

### 7.1 获取冲突副本列表

#### `GET /api/v1/notes/conflicts`

获取当前用户所有存在冲突的笔记。

**Response 200**:
```typescript
{
  "conflicts": Array<{
    "originalId": string,         // 原始笔记 ID
    "originalContent": string,
    "originalUpdatedAt": string,
    "originalDeviceId": string,
    "conflictCopyId": string,     // 冲突副本 ID
    "conflictContent": string,
    "conflictUpdatedAt": string,
    "conflictDeviceId": string,
    "bookId": string,
    "bookTitle": string
  }>
}
```

### 7.2 解决冲突

#### `POST /api/v1/notes/{note_id}/resolve-conflict`

用户选择保留哪个版本或手动合并。

**Request Body**:
```typescript
{
  "resolution": "keep_original" | "keep_conflict" | "merge",
  "mergedContent"?: string  // 仅当 resolution=merge 时需要
}
```

**Response 200**:
```typescript
{
  "noteId": string,
  "content": string,
  "message": "冲突已解决"
}
```

---

## 9. 书籍元数据管理接口

### 8.1 更新书籍元数据

#### `PATCH /api/v1/books/{book_id}/metadata`

用户确认或修改书籍的元数据（书名、作者）。

**Request Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
If-Match: W/"<version>"  // 乐观锁（可选）
```

**Request Body**:
```typescript
{
  "title"?: string,           // 书籍名称
  "author"?: string,          // 作者
  "confirmed": boolean        // 是否标记为已确认（即使不修改也可确认）
}
```

**Response 200**:
```typescript
{
  "id": string,
  "title": string,
  "author": string | null,
  "metadataConfirmed": boolean,
  "metadataConfirmedAt": string | null,
  "metadataVersion": string,  // 版本指纹，用于心跳同步
  "version": number           // 乐观锁版本号
}
```

**Response 409** (版本冲突):
```typescript
{
  "error": "version_conflict",
  "message": "书籍信息已被其他设备修改，请刷新后重试",
  "currentVersion": number
}
```

### 8.2 元数据版本与心跳同步

元数据（`title`, `author`）的变更会影响心跳同步的版本对比。

**`metadataVersion` 生成规则**：
```typescript
// 基于 title + author 生成哈希
const metadataVersion = sha256(`${title}|${author}`).substring(0, 16);
// 例如: "sha256:a1b2c3d4e5f67890"
```

**心跳协议中的元数据同步**：

在 `POST /api/v1/sync/heartbeat` 的请求和响应中：

```typescript
// Request - clientVersions
{
  "clientVersions": {
    "ocr": "sha256:...",
    "metadata": "sha256:a1b2c3d4",  // ← 包含元数据版本
    "vectorIndex": "sha256:..."
  }
}

// Response - serverVersions
{
  "serverVersions": {
    "ocr": "sha256:...",
    "metadata": "sha256:b2c3d4e5",  // ← 如果不一致，客户端需拉取最新
    "vectorIndex": "sha256:..."
  },
  "pullRequired": {
    "metadata": {
      "url": "/api/v1/books/{id}",
      "fields": ["title", "author"],  // 指示需要更新哪些字段
      "priority": "normal"
    }
  }
}
```

**客户端处理逻辑**：
```typescript
// 当 serverVersions.metadata !== clientVersions.metadata 时
if (response.pullRequired?.metadata) {
  // 拉取最新书籍信息
  const bookData = await fetch(`/api/v1/books/${bookId}`);
  // 更新本地缓存
  await updateLocalBookCache(bookId, {
    title: bookData.title,
    author: bookData.author,
    metadataVersion: response.serverVersions.metadata
  });
  // 刷新 UI
  refreshBookDisplay();
}
```

### 8.3 元数据确认状态事件

当后台完成元数据提取后，通过 WebSocket 或心跳响应通知前端：

**事件类型**: `metadata_extracted`

```typescript
// sync_events 或 WebSocket 消息
{
  "type": "metadata_extracted",
  "bookId": "uuid",
  "payload": {
    "title": "经济学原理",       // 提取到的标题（可能为空）
    "author": "曼昆",            // 提取到的作者（可能为空）
    "extracted": true,          // 是否成功提取到任何元数据
    "needsConfirmation": true   // 是否需要用户确认
  }
}
```

**前端响应**：
- 收到事件后弹出元数据确认对话框
- 用户确认后调用 `PATCH /api/v1/books/{id}/metadata`
- 如果用户选择「跳过」，可调用 `PATCH` 仅设置 `confirmed: true`

### 8.4 AI 对话中的元数据使用

> **⚠️ 重要设计决策**

书籍的 `title` 和 `author` 字段会作为上下文信息发送给上游 AI 模型，以提高回答的精准度。

**系统提示词模板** (参见 `api/app/ai.py`):
```python
BOOK_CONTEXT_PROMPT = """
用户正在阅读的文档信息：
- 书籍/文档名称：{title}
- 作者：{author if author else "未知"}

请基于以上背景信息，结合文档内容回答用户的问题。
"""
```

**影响说明**：
| 元数据状态 | AI 对话表现 |
|-----------|------------|
| 有书名+作者 | AI 能准确理解上下文，引用时使用正确书名 |
| 仅有书名 | AI 能识别文档，但可能无法关联作者信息 |
| 均为空/文件名 | AI 仅基于内容回答，可能缺乏背景理解 |

**私人资料场景**：
- 用户上传的可能不是书籍，而是个人文档、笔记、资料等
- 此时用户可跳过元数据确认
- AI 对话仍可正常使用，仅基于文档内容本身回答

---

## 10. SHA256 全局去重接口 (ADR-008)

### 9.1 秒传接口

#### `POST /api/v1/books/dedup_reference`

当 `upload_init` 返回 `dedup_available: true` 时，客户端调用此接口创建引用书籍，无需实际上传文件。

**Request Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request Body**:
```typescript
{
  "filename": string,           // 文件名
  "content_sha256": string,     // SHA256 哈希
  "size": number                // 文件大小 (bytes)
}
```

**Response 201** (成功创建引用书籍):
```typescript
{
  "id": string,                 // 新书籍 UUID
  "title": string,              // 继承自原书
  "author": string | null,
  "dedupType": "global",        // 去重类型
  "canonicalBookId": string,    // 原始书籍 ID
  "hasOcr": boolean,            // 原书是否已完成 OCR
  "coverImageKey": string | null,
  "downloadUrl": string         // 预签名下载 URL
}
```

**Response 404** (原书不存在):
```typescript
{
  "error": "canonical_not_found",
  "message": "去重引用的原始书籍不存在或已被删除"
}
```

**Response 403** (配额不足):
```typescript
{
  "error": "quota_exceeded",
  "message": "书籍配额已满，请升级会员或删除部分书籍"
}
```

### 9.2 书籍删除接口

#### `DELETE /api/v1/books/{book_id}`

删除书籍，采用**软删除/硬删除分层策略**（ADR-008）。

**Request Headers**:
```
Authorization: Bearer <access_token>
```

**Path Parameters**:
| 参数 | 类型 | 说明 |
|-----|------|------|
| `book_id` | UUID | 书籍 ID |

**处理逻辑**:
1. **私人数据**：始终立即删除（笔记、高亮、阅读进度、书架关联）
2. **引用书**（`canonical_book_id IS NOT NULL`）：
   - 物理删除书籍记录
   - 减少原书 `storage_ref_count`
   - 检查原书是否需要清理
3. **原书**（`canonical_book_id IS NULL`）：
   - 有引用（`ref_count > 1`）→ 软删除（设置 `deleted_at`）
   - 无引用（`ref_count <= 1`）→ 硬删除（清理所有公共数据）

**Response 200** (删除成功):
```typescript
{
  "message": "书籍已删除",
  "deleteType": "soft" | "hard",  // 删除类型
  "cleanedResources"?: {          // 仅硬删除时返回
    "file": boolean,
    "cover": boolean,
    "ocrResult": boolean,
    "vectorIndex": boolean
  }
}
```

**Response 404** (书籍不存在):
```typescript
{
  "error": "book_not_found",
  "message": "书籍不存在或已被删除"
}
```

### 9.3 公共数据 vs 私人数据

| 数据类型 | 所有者 | 软删除时 | 硬删除时 |
|---------|-------|---------|---------|
| S3 文件 (PDF/EPUB) | 共享 | ✅ 保留 | ❌ 删除 |
| 封面图片 | 共享 | ✅ 保留 | ❌ 删除 |
| OCR 结果 JSON | 共享 | ✅ 保留 | ❌ 删除 |
| 向量索引 (OpenSearch) | 共享 | ✅ 保留 | ❌ 删除 |
| 笔记/高亮 | 用户私有 | ❌ 立即删除 | ❌ 立即删除 |
| 阅读进度 | 用户私有 | ❌ 立即删除 | ❌ 立即删除 |
| 书架关联 | 用户私有 | ❌ 立即删除 | ❌ 立即删除 |

> **设计原理**：
> - 当多个用户共享同一文件时，删除不应影响其他用户
> - 只有最后一个用户删除时，才物理清理公共数据
> - 私人数据始终立即删除，保护用户隐私
## 11. 数据同步协议 (Data Sync Protocol)

> **⚠️ DEPRECATED**: 本节内容已废弃。
> 
> 雅典娜采用 **App-First 架构 (ADR-007)**，数据同步由 **PowerSync Service** 透明处理。
> 
> **不再使用**：
> - ~~`POST /api/v1/sync/pull`~~ - 已废弃
> - ~~`POST /api/v1/sync/push`~~ - 已废弃
> - ~~`POST /api/v1/sync/initial`~~ - 已废弃
> 
> **现行方案**：参见 Section 3.A - 3.C（PowerSync 访问协议与数据操作规范）。
> 
> 冲突解决机制由 PowerSync 自动处理，详见 03 系统架构 - ADR-007。

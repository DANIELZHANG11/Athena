# 05 - API 契约与协议 (API Contracts & Protocols)

> **版本**: v1.0
> **最后更新**: 2025-11-28
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
| `missing_if_match` | 428 | 缺少 `If-Match` 头（针对乐观锁资源） |
| `invalid_if_match` | 400 | `If-Match` 格式错误（需为 `W/"<version>"`） |
| `version_conflict` | 409 | 资源版本冲突（乐观锁检查失败） |
| `readonly_mode_quota_exceeded` | 403 | **Trap (软锁)**: 存储或书籍配额超限，账户进入只读模式 |
| `upload_forbidden_quota_exceeded` | 403 | **Hook (硬锁)**: 上传动作因配额超限被拒绝 |
| `missing_filename` | 400 | 上传初始化时缺少文件名 |
| `missing_key` | 400 | 上传完成时缺少 S3 Object Key |
| `http_error` | Varies | 未知 HTTP 错误（Wrapper） |
| `internal_error` | 500 | 服务器内部错误 |

---

## 3. 特殊交互协议 (Special Protocols)

### 3.1 幂等性设计 (Idempotency)
防止网络重试导致的数据重复创建。

*   **Header**: `Idempotency-Key: <UUID>`
*   **适用范围**: 所有非安全方法 (`POST`, `PATCH`, `DELETE`)，特别是 `POST /api/v1/books` 和 `POST /api/v1/notes`。
*   **后端机制**:
    1.  Redis 缓存 Key: `idem:{resource}:{action}:{user_id}:{key}`。
    2.  TTL: 24 小时。
    3.  **Hit**: 直接返回缓存的 Response Body (HTTP 200)。
    4.  **Miss**: 执行业务逻辑 -> 缓存结果 -> 返回。

### 3.2 乐观并发控制 (Optimistic Concurrency)
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

### 3.3 文件上传协议 (Direct Upload)
采用 S3 Presigned URL 模式，文件流不经过 API Server。

*   **流程**:
    1.  **Init**: `POST /api/v1/books/upload_init`
        *   Body: `{ "filename": "book.pdf", "content_type": "application/pdf" }`
        *   Resp: `{ "upload_url": "https://s3...", "key": "raw/..." }`
    2.  **Upload**: Client `PUT` 文件流至 `upload_url`。
    3.  **Complete**: `POST /api/v1/books/upload_complete`
        *   Body: `{ "key": "raw/...", "title": "..." }`
        *   Resp: `{ "id": "book_uuid", "status": "processing" }`
*   **关键字段**: `file_fingerprint` (SHA256) 用于秒传检测（部分实现）。

### 3.4 AI 流式响应 (SSE)
基于 Server-Sent Events 标准。

*   **Endpoint**: `GET /api/v1/ai/stream`
*   **Content-Type**: `text/event-stream`
*   **Message Format**: `data: <content>\n\n`
*   **Event Protocol**:
    1.  **Start**: `data: BEGIN\n\n` (连接建立)
    2.  **Delta**: `data: <token_chunk>\n\n` (持续推送)
    3.  **End**: 连接关闭 (Client 收到 EOF 或后端关闭)
*   **Cache**: 支持 Redis 缓存（基于 Prompt Hash），缓存命中时会以极快速度重放 SSE 流。

### 3.5 实时同步 (WebSocket)
用于笔记与文档的协同编辑。

*   **Endpoint**: `ws://api.athena.app/ws/notes/{note_id}`
*   **Sub-Protocol**: 无（Raw WebSocket）。
*   **Payload Protocol**: **Custom JSON Protocol** (Lite Yjs-like).
    *   **Handshake**: Server 发送 `{"type": "ready", "version": <int>}`。
    *   **Update**: Client 发送 `{"type": "update", "client_version": <int>, "update": "<base64>"}`。
    *   **Conflict**: Server 返回 `{"type": "conflict", "version": <int>}`，Client 需重置。
*   **Auth**: 通过 URL Query Parameter (`?token=...`) 或 Header 传递 Token。

---

## 4. 核心接口索引 (Key Endpoints Index)

> 完整 Schema 请查阅 `contracts/api/v1/` 下的 YAML 文件。

### 4.1 Auth & User (`auth.yaml`)
*   `POST /api/v1/auth/email/send_code`: 发送验证码
*   `POST /api/v1/auth/email/verify_code`: 登录/注册 (获取 Token)
*   `GET /api/v1/auth/me`: 获取当前用户信息

### 4.2 Books (`books.yaml`)
*   `GET /api/v1/books`: 书籍列表 (Cursor Pagination)
*   `POST /api/v1/books/upload_init`: 上传初始化
*   `POST /api/v1/books/upload_complete`: 上传完成
*   `GET /api/v1/books/{id}`: 书籍详情
*   `PATCH /api/v1/books/{id}`: 更新书籍元数据 (支持 `If-Match`)

### 4.3 Notes & Highlights (`notes.yaml`, `highlights.yaml`, `tags.yaml`)
*   `GET /api/v1/notes`: 笔记列表
*   `POST /api/v1/notes`: 创建笔记 (支持 `Idempotency-Key`)
*   `PATCH /api/v1/notes/{id}`: 更新笔记 (支持 `If-Match`)
*   `GET /api/v1/highlights`: 高亮列表
*   `GET /api/v1/tags`: 标签列表
*   `POST /api/v1/tags`: 创建标签

### 4.4 AI (`ai.yaml`)
*   `GET /api/v1/ai/stream`: AI 对话流 (SSE) - *注: 目前设计为 GET，未来可能迁移至 POST*
*   `GET /api/v1/ai/conversations`: 对话历史列表

### 4.5 Realtime Docs (`realtime.py`)
*   `WS /ws/notes/{note_id}`: 笔记/文档实时同步通道

### 4.6 Billing (`billing.yaml`) [待完善]
*   `GET /api/v1/billing/plans`: 获取订阅方案
*   `POST /api/v1/billing/checkout`: 创建支付会话

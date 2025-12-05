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
采用 S3 Presigned URL 模式，文件流不经过 API Server。支持 **SHA256 全局去重**（ADR-007）。

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
*   `POST /api/v1/books/upload_init`: 上传初始化 (支持 SHA256 去重检查)
*   `POST /api/v1/books/upload_complete`: 上传完成 (服务端备用 SHA256 计算)
*   `POST /api/v1/books/dedup_reference`: **秒传接口** (SHA256 全局去重)
*   `GET /api/v1/books/{id}`: 书籍详情
*   `PATCH /api/v1/books/{id}`: 更新书籍元数据 (支持 `If-Match`)
*   `DELETE /api/v1/books/{id}`: 删除书籍 (软删除/硬删除分层策略)

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

### 4.7 Books Metadata (`books.yaml`)
*   `PATCH /api/v1/books/{id}/metadata`: 更新书籍元数据（书名、作者）
*   `GET /api/v1/books/{id}`: 书籍详情（包含 `metadata_confirmed` 状态）

---

## 5. 智能心跳同步协议 (Smart Heartbeat Sync Protocol)

> **状态**: PROPOSED（待实施）
> **关联 ADR**: `03 - 系统架构与ADR` ADR-006

### 5.1 协议概述

智能心跳同步协议用于解决多端数据同步问题，核心设计理念：

1. **版本指纹对比**：客户端携带本地数据版本，服务端比对后告知需要拉取的数据
2. **双向同步**：客户端上传阅读进度等用户数据，服务端返回 OCR 等系统数据更新
3. **按需拉取**：避免每次心跳都传输大量数据，仅在版本变化时触发下载

### 5.2 接口定义

#### `POST /api/v1/sync/heartbeat`

**Request Headers**:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request Body**:
```typescript
{
  // 当前书籍上下文（可选，不传则同步所有书籍）
  "bookId"?: string,
  
  // 设备标识（用于多设备冲突解决）
  "deviceId": string,
  
  // 客户端已有的服务端权威数据版本
  "clientVersions": {
    "ocr"?: string,           // 例如 "sha256:abc12345"
    "metadata"?: string,
    "vectorIndex"?: string
  },
  
  // 客户端权威数据（待上传）
  "clientUpdates": {
    // 阅读进度（客户端权威）
    "readingProgress"?: {
      "bookId": string,
      "position": {
        "page"?: number,
        "cfi"?: string,        // EPUB CFI
        "offset"?: number      // 页内偏移 0-1
      },
      "progress": number,      // 0-100
      "timestamp": string      // ISO 8601
    },
    
    // 离线创建的笔记（待上传）
    "pendingNotes"?: Array<{
      "clientId": string,      // 客户端临时 ID
      "bookId": string,
      "content": string,
      "location": string,
      "createdAt": string
    }>,  // ⚠️ 单次最多 50 条
    
    // 离线创建的高亮（待上传）
    "pendingHighlights"?: Array<{
      "clientId": string,
      "bookId": string,
      "text": string,
      "startLocation": string,
      "endLocation": string,
      "color"?: string,
      "createdAt": string
    }>,  // ⚠️ 单次最多 50 条
    
    // 是否还有更多待同步数据
    "hasMore"?: boolean
  }
}
```

> **⚠️ 大 Payload 防护**
> 
> 为防止用户离线期间创建大量笔记/高亮导致请求体过大（超过 Nginx 默认 1MB 限制），采用分批上传策略：
> - 单次心跳最多携带 50 条 notes + 50 条 highlights
> - 当 `hasMore = true` 时，客户端应在收到响应后立即发起下一次心跳
> - 后端请求体限制设为 512KB

**Response Body**:
```typescript
{
  // 服务端权威数据的最新版本
  "serverVersions": {
    "ocr": string,              // 当前 OCR 数据版本
    "metadata": string,         // 当前元数据版本
    "vectorIndex"?: string      // 向量索引版本（可选）
  },
  
  // 需要客户端拉取的数据清单
  "pullRequired": {
    "ocr"?: {
      "url": string,            // 下载地址
      "size": number,           // 预估大小 (bytes)
      "priority": "high" | "normal" | "low"
    },
    "metadata"?: {
      "url": string,
      "size": number
    }
  },
  
  // 客户端上传数据的处理结果
  "pushResults": {
    // 阅读进度处理结果
    "readingProgress"?: "accepted" | "conflict",
    
    // 笔记创建结果
    "notes"?: Array<{
      "clientId": string,       // 客户端临时 ID
      "serverId"?: string,      // 服务端分配的 UUID
      "status": "created" | "conflict_copy" | "rejected",
      "conflictId"?: string,    // 如果 status=conflict_copy，返回冲突副本 ID
      "message"?: string
    }>,
    
    // 高亮创建结果
    "highlights"?: Array<{
      "clientId": string,
      "serverId"?: string,
      "status": "created" | "conflict" | "merged" | "rejected",
      "message"?: string
    }>
  },
  
  // 服务端建议的下次心跳间隔（毫秒）
  "nextHeartbeatMs": number,    // 默认 30000
  
  // 待处理的服务端事件（可选，用于补偿 WebSocket 断连期间的事件）
  "pendingEvents"?: Array<{
    "type": "ocr_ready" | "metadata_updated" | "vector_ready",
    "bookId": string,
    "version": string,
    "createdAt": string
  }>
}
```

**错误响应**:

| HTTP Status | detail Code | 说明 |
|------------|-------------|------|
| 400 | `invalid_device_id` | 设备 ID 格式错误 |
| 401 | `unauthorized` | Token 无效或过期 |
| 404 | `book_not_found` | 指定的书籍不存在 |
| 429 | `rate_limited` | 心跳频率过高 |

### 5.3 版本指纹格式

版本指纹采用内容哈希的前 16 位：

```
格式: sha256:<hash_prefix>
示例: sha256:a1b2c3d4e5f67890
```

**生成规则**:
- **OCR 版本**: `SHA256(ocr_report_json)` 的前 16 位
- **元数据版本**: `SHA256(title + author + page_count + ...)` 的前 16 位
- **向量索引版本**: `SHA256(embedding_model + dimension + count)` 的前 16 位

### 5.4 心跳间隔动态调整

| 场景 | 建议间隔 | 说明 |
|-----|---------|------|
| 用户活跃阅读中 | 10-15s | 频繁同步进度 |
| 用户空闲（无操作 5 分钟） | 60s | 降低频率 |
| 后台/最小化 | 300s | 极低频率 |
| 刚完成 OCR 处理 | 立即推送 | WebSocket 事件 |

### 5.5 客户端实现示例

```typescript
// web/src/hooks/useHeartbeat.ts

interface HeartbeatState {
  isActive: boolean;
  lastSync: Date | null;
  nextSyncMs: number;
}

export function useHeartbeat(bookId: string) {
  const [state, setState] = useState<HeartbeatState>({
    isActive: false,
    lastSync: null,
    nextSyncMs: 30000
  });
  
  const { downloadOcr, localOcrVersion } = useOcrData(bookId);
  
  const sync = useCallback(async () => {
    const response = await fetch('/api/v1/sync/heartbeat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        bookId,
        deviceId: getDeviceId(),
        clientVersions: {
          ocr: localOcrVersion
        },
        clientUpdates: {
          readingProgress: getCurrentProgress()
        }
      })
    });
    
    const data = await response.json();
    
    // 检查是否需要拉取 OCR
    if (data.pullRequired?.ocr) {
      await downloadOcr(data.pullRequired.ocr.url);
    }
    
    // 更新下次心跳间隔
    setState(prev => ({
      ...prev,
      lastSync: new Date(),
      nextSyncMs: data.nextHeartbeatMs
    }));
  }, [bookId, localOcrVersion]);
  
  // 定时心跳
  useEffect(() => {
    const timer = setInterval(sync, state.nextSyncMs);
    return () => clearInterval(timer);
  }, [sync, state.nextSyncMs]);
  
  return { sync, state };
}
```

### 5.6 与现有接口的关系

| 现有接口 | 变更说明 |
|---------|---------|
| `WS /ws/realtime/heartbeat` | 扩展支持版本指纹 |
| `GET /api/v1/books/{id}/ocr` | 新增 `version` 响应头 |
| `GET /api/v1/books/{id}/ocr/full` | 无变更，仅在版本不匹配时调用 |
| `PATCH /api/v1/reading_progress` | 被心跳协议合并，可废弃 |

---

## 6. OCR 服务触发接口

> **设计原则**：OCR 是收费/限额服务，由用户主动触发，而非上传后自动执行。

### 6.1 触发 OCR 处理

#### `POST /api/v1/books/{book_id}/ocr`

用户主动请求对图片型 PDF 进行 OCR 处理。支持 **OCR 复用（假 OCR）**（ADR-007）。

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

## 7. 笔记/高亮冲突处理接口

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

## 8. 书籍元数据管理接口

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

## 9. SHA256 全局去重接口 (ADR-007)

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

删除书籍，采用**软删除/硬删除分层策略**（ADR-007）。

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
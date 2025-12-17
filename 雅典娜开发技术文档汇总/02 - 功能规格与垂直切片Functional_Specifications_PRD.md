# 02_Functional_Specifications_PRD.md

> **版本**：v2.1 (App-First Edition)
> **定位**：产品功能需求文档（PRD），定义各功能模块的实现规格与 App-First 架构约束。

## 1. 核心功能概览
- User & Auth（登录/注册/JWT）
- Books & Shelves（上传/列表/OCR 触发/书架）
- Reader Core（阅读器与 PowerSync 进度同步）
- Notes & Highlights（笔记/高亮/标签/搜索）
- AI Knowledge Engine（RAG 对话/流式输出）
- Billing & Account（充值/配额/只读锁逻辑）

说明：接口定义以 05 号文档（API 契约）为准；数据库结构以 04 号文档（DB）为准。响应格式以《00_AI_Coding_Constitution_and_Rules.md》的错误码 Schema 为准；成功响应以 05 契约为准（通常为 `{ data: ... }`）。

### 1.1 App-First 实施原则

1. **数据总线**：所有业务数据必须遵循 `UI → SQLite (PowerSync SDK) → PowerSync Service → PostgreSQL` 的闭环。前端组件禁止直接依赖 REST API 渲染。
2. **本地优先写入**：CUD 操作通过 PowerSync Repository 写入本地 SQLite 并由 SDK 自动上传，REST API 仅保留鉴权、计费、AI SSE、上传初始化等场景。
3. **Feature Flag**：`APP_FIRST_ENABLED` 控制 PowerSync Provider 注入（已启用）。
4. **冲突策略**：阅读进度使用 LWW，笔记/高亮采用 Conflict Copy，书架/设置字段按列合并。
5. **端差异化**：
  * Mobile：通过 `capacitor-community/sqlite` 调用原生 SQLite 引擎。
  * Web：通过 `sqlite-wasm` + OPFS 提供一致体验。
6. **观测**：PowerSync Service 必须接入 Prometheus/Grafana 监控。

## 2. 垂直切片详情（Vertical Slices）

### 2.1 User & Auth

#### A. 数据库模型（Database Schema）
- `users`：
  - 字段：`id (UUID, PK)`、`email (LOWERCASE, UNIQUE)`、`display_name (TEXT)`、`is_active (BOOL)`、`language (TEXT)`、`timezone (TEXT)`、`membership_expire_at (TIMESTAMPTZ)`、`monthly_gift_reset_at (TIMESTAMPTZ)`、`free_ocr_usage (INT DEFAULT 0)`、`updated_at (TIMESTAMPTZ)`。
  - 权限字段：`user_id` 不适用（用户主表）；RLS 依赖会话变量 `app.user_id`。
- `user_sessions`：
  - 字段：`id (UUID, PK)`、`user_id (UUID, FK users.id)`、`revoked (BOOL)`、`created_at (TIMESTAMPTZ)`。
  - 关系：`users (1) — (N) user_sessions`。

#### B. 后端逻辑与 API 契约（Backend & Contract）
- 端点：`POST /auth/email/send-code`、`POST /auth/email/verify-code`、`POST /auth/refresh`、`POST /auth/logout`、`GET /auth/sessions`、`GET /auth/me`。
- 规则：成功登录后创建 `user_sessions` 并签发 `access_token/refresh_token`；受保护端点需 `Authorization: Bearer`。

#### C. 前端组件契约（Frontend Contract）
- 组件：`AuthForm`
  - Props：
    ```ts
    interface AuthFormProps {
      onSuccess: (tokens: { accessToken: string; refreshToken: string }) => void
      onError: (message: string) => void
    }
    ```
  - 交互：输入邮箱→发送验证码→输入验证码→验证→成功回调并跳转；失败展示错误。

#### D. 业务规则（Business Rules）
- 所有 POST 必须携带 `Idempotency-Key`。
- 所有 PATCH 必须携带 `If-Match`。
- 所有 GET 建议携带 `If-None-Match`（弱缓存）。

### ✔ Definition of Done (DoD)
- [ ] API 契约已更新并通过合规校验
- [ ] RLS 测试覆盖登录态与多租户隔离
- [ ] ETag/Idempotency 规范在前后端一致
- [ ] 前端组件契约与错误码映射对齐
- [ ] 数据库迁移脚本（如会话表变更）齐备
- [ ] 单元/集成测试覆盖登录/刷新/注销

---

### 2.2 Books & Shelves

#### A. 数据库模型（Database Schema）
- `books`：
  - 字段：`id (UUID, PK)`、`user_id (UUID, FK)`、`title (TEXT)`、`author (TEXT)`、`language (TEXT)`、`original_format (TEXT)`、`minio_key (TEXT)`、`size (BIGINT)`、`is_digitalized (BOOL)`、`initial_digitalization_confidence (FLOAT)`、`source_etag (TEXT)`、`meta (JSONB)`、`digitalize_report_key (TEXT)`、`cover_image_key (TEXT)`、`converted_epub_key (TEXT)`、`updated_at (TIMESTAMPTZ)`。
  - 权限字段：`user_id`（RLS）。
  - **新增字段（SHA256 去重 ADR-008）**：
    - `content_sha256 (VARCHAR(64))`：文件内容 SHA256 哈希，用于全局去重
    - `storage_ref_count (INTEGER, DEFAULT 1)`：存储引用计数，初始值 1 代表原书自己
    - `canonical_book_id (UUID, FK books.id)`：去重引用指向的原始书籍 ID，非空表示是引用书
    - `deleted_at (TIMESTAMPTZ)`：软删除时间戳，非空表示已软删除
  - **新增字段（OCR 相关）**：
    - `ocr_status (VARCHAR(20))`：OCR 状态 (NULL/pending/processing/completed/failed)
    - `ocr_requested_at (TIMESTAMPTZ)`：用户请求 OCR 的时间
    - `ocr_result_key (TEXT)`：OCR 结果 JSON 文件的 S3 Key
    - `vector_indexed_at (TIMESTAMPTZ)`：向量索引完成时间
  - **新增字段（元数据确认）**：
    - `metadata_confirmed (BOOLEAN, DEFAULT FALSE)`：用户是否已确认元数据
    - `metadata_confirmed_at (TIMESTAMPTZ)`：元数据确认时间
  - 其他字段说明：
    - `cover_image_key`：封面图片在 S3 中的存储路径（WebP 格式，400×600）
    - `converted_epub_key`：Calibre 转换后的 EPUB 路径（标记已转换）
- `shelves`：
  - 字段：`id (UUID, PK)`、`user_id (UUID, FK users.id)`、`name (TEXT)`、`parent_shelf_id (UUID, NULLABLE, FK shelves.id)`、`updated_at (TIMESTAMPTZ)`、`version (INT)`。
  - 关系：`users (1) — (N) shelves`；支持层级结构（父子架）。
- `shelf_books`（关联表）：
  - 字段：`id (UUID, PK)`、`book_id (UUID, FK books.id)`、`shelf_id (UUID, FK shelves.id)`、`user_id (UUID, FK users.id)`、`sort_order (INT)`、`added_at (TIMESTAMPTZ)`。
  - 约束：唯一约束（`book_id`, `shelf_id`）；`ON CONFLICT DO NOTHING` 用于去重。
> Status: Backend Implemented（Books 上传、转换、封面提取、元数据提取）；Shelves = Implemented。

#### B. 后端逻辑与 API 契约（Backend & Contract）
- 端点：`POST /books/upload_init`、`POST /books/upload_complete`、`GET /books`、`GET /books/{id}`、`DELETE /books/{id}`。
- 规则：
  - 上传前校验配额；完成后落库与索引同步；支持 `Idempotency-Key`。
  - @if (`user_stats.is_readonly`)：
    - `POST /books/upload_init` → 403 `quota_exceeded`
    - Shelves 全量 CRUD 禁止（`POST/PUT/PATCH/DELETE` 返回 403）

#### B.1 书籍上传与处理流水线（Upload & Processing Pipeline）

**完整流程图**：
```
前端选择文件
    ↓
计算 SHA256 指纹 (content_sha256)
    ↓
POST /books/upload_init { content_sha256, filename, size }
    ↓
PUT 直传 S3 (If distinct)
    ↓
POST /books/upload_complete
    ↓
Server Processing (Calibre, etc.)
    ↓
Server Updates `books` table (PostgreSQL)
    ↓
PowerSync Pushes update to Client `books` table (SQLite)
    ↓
UI Reacts to SQLite change (Book appears in Library)
```

#### B.1.1 SHA256 全局去重机制（ADR-008）

**核心原则**：
1. **存储去重**：相同文件只存储一份，通过引用计数管理
2. **OCR 复用**：相同文件只需一次真实 OCR，后续用户秒级复用
3. **智能删除**：区分公共数据和私人数据，实现软删除/硬删除分层

**数据库字段**：
```sql
-- books 表新增字段
content_sha256 VARCHAR(64)     -- 文件内容 SHA256 哈希
storage_ref_count INTEGER      -- 存储引用计数（初始值 1）
canonical_book_id UUID         -- 去重引用指向的原始书籍 ID
deleted_at TIMESTAMPTZ         -- 软删除时间戳

-- 部分索引
CREATE INDEX idx_books_content_sha256 ON books(content_sha256) 
    WHERE content_sha256 IS NOT NULL;
```

**去重检查流程**：
```
POST /books/upload_init
    ↓
检查 content_sha256 是否存在
    ↓
┌─────────────────────────────┬──────────────────────────────────┐
│ 无命中                       │ 有命中                            │
├─────────────────────────────┼──────────────────────────────────┤
│ dedup_available: false      │ 检查是否是当前用户的书             │
│ 返回 presigned URL          │ ├─ 是 → dedup_hit: "own"          │
│ 继续正常上传流程              │ │     返回已有书籍 ID             │
│                             │ └─ 否 → dedup_available: true     │
│                             │         canonical_id: 原书 ID     │
└─────────────────────────────┴──────────────────────────────────┘
```

**秒传接口**：
```
POST /api/v1/books/dedup_reference
├─ 请求体：
│   {
│     "filename": "小说的艺术.pdf",
│     "content_sha256": "6f4c24abd60a55d3...",
│     "size": 12345678
│   }
├─ 处理逻辑：
│   1. 查找 canonical_book（原始书籍）
│   2. 增加原书 storage_ref_count
│   3. 创建新书籍记录，设置 canonical_book_id
│   4. 复制原书的：minio_key, cover_image_key, meta
│   5. 如果原书已 OCR：
│      - 设置 is_digitalized = true, confidence = 0.1
│      - 用户可点击 OCR 触发"假 OCR"复用
├─ 响应 201：
│   {
│     "id": "new-book-uuid",
│     "dedup_type": "global",
│     "canonical_book_id": "original-book-uuid",
│     "has_ocr": true
│   }
└─ 响应 404：CANONICAL_NOT_FOUND (原书不存在)
```

**引用计数规则**：
| 操作 | storage_ref_count 变化 |
|-----|----------------------|
| 原书上传完成 | 初始值 = 1（代表自己） |
| 秒传创建引用书 | 原书 +1 |
| 引用书删除 | 原书 -1 |
| 判断是否有引用 | `> 1` 表示有其他用户共享 |

#### B.1.2 书籍删除策略（Soft Delete & Hard Delete）

**删除决策流程**：
```
用户删除书籍
    ↓
判断书籍类型
    ├─ 引用书 (canonical_book_id IS NOT NULL)
    │   ├─ 删除用户私有数据（笔记/进度/书架）
    │   ├─ 物理删除书籍记录
    │   ├─ 减少原书 storage_ref_count
    │   └─ 检查原书是否需要清理
    │       └─ 如果原书已软删除 + ref_count ≤ 1 → 物理删除原书
    │
    └─ 原书 (canonical_book_id IS NULL)
        ├─ 删除用户私有数据
        └─ 检查引用计数
            ├─ ref_count > 1 → 软删除
            │   └─ 设置 deleted_at，保留公共数据
            └─ ref_count ≤ 1 → 硬删除
                ├─ 删除 S3 文件（PDF/封面/OCR结果）
                ├─ 删除向量索引
                └─ 物理删除数据库记录
```

**公共数据 vs 私人数据**：
| 数据类型 | 所有者 | 软删除时 | 硬删除时 |
|---------|-------|---------|---------|
| PDF/EPUB 文件 | 共享 | ✅ 保留 | ❌ 删除 |
| 封面图片 | 共享 | ✅ 保留 | ❌ 删除 |
| OCR 结果 JSON | 共享 | ✅ 保留 | ❌ 删除 |
| 向量索引 | 共享 | ✅ 保留 | ❌ 删除 |
| 笔记/高亮 | 用户私有 | ❌ 立即删除 | ❌ 立即删除 |
| 阅读进度 | 用户私有 | ❌ 立即删除 | ❌ 立即删除 |
| 书架关联 | 用户私有 | ❌ 立即删除 | ❌ 立即删除 |

#### B.1.3 最近删除功能（Recently Deleted）

**功能概述**：
- 用户删除书籍后，书籍进入"最近删除"状态（软删除）
- 书籍保留 30 天，期间可恢复
- 超过 30 天后由后台任务自动清理

**页面入口**：侧边栏 → 最近删除

**页面功能**：
| 功能 | 操作 | 业务逻辑 |
|-----|------|---------|
| 查看已删除书籍 | 显示列表 | 查询 `deleted_at IS NOT NULL` |
| 恢复书籍 | 单选/批量 | 设置 `deleted_at = NULL` |
| 永久删除 | 单选/批量 | 见下方详细逻辑 |
| 清空全部 | 批量 | 对所有书籍执行永久删除 |

**⚠️ 永久删除业务逻辑（仅删除私人数据）**：

> **重要决策**：永久删除**不会**删除共享资源（MinIO 文件、OCR 结果、向量索引），  
> 因为其他用户可能通过秒传引用了相同文件。只删除当前用户的私人数据。

```
用户点击"永久删除"
    ↓
1. 删除私人数据（立即执行）
    ├─ notes: DELETE WHERE book_id = :id AND user_id = :uid
    ├─ highlights: DELETE WHERE book_id = :id AND user_id = :uid
    ├─ bookmarks: DELETE WHERE book_id = :id AND user_id = :uid
    ├─ reading_progress: DELETE WHERE book_id = :id AND user_id = :uid
    ├─ reading_sessions: DELETE WHERE book_id = :id AND user_id = :uid
    └─ shelf_books: DELETE WHERE book_id = :id AND user_id = :uid
    ↓
2. 更新书籍记录
    └─ books: 物理删除记录 (DELETE WHERE id = :id)
    ↓
3. 更新引用计数（如果是引用书）
    └─ 原书 storage_ref_count -= 1
    ↓
4. 不执行的操作（共享资源保护）
    ├─ ❌ 不删除 MinIO 文件 (minio_key)
    ├─ ❌ 不删除封面 (cover_image_key)
    ├─ ❌ 不删除 OCR 结果 (ocr_result_key)
    └─ ❌ 不删除向量索引 (OpenSearch)
```

**共享资源清理规则**（由后台定时任务执行）：
```sql
-- 每日凌晨执行，清理孤立的共享资源
DELETE FROM books_storage_cleanup_queue
WHERE content_sha256 IN (
    SELECT content_sha256 
    FROM books 
    WHERE deleted_at < NOW() - INTERVAL '30 days'
    GROUP BY content_sha256
    HAVING COUNT(*) = SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END)
);
-- 即：只有当该 SHA256 的所有书籍都已软删除超过30天，才清理存储
```

**API 端点**：
| 端点 | 方法 | 说明 |
|-----|------|------|
| `/api/v1/books/deleted` | GET | 获取已删除书籍列表 |
| `/api/v1/books/{id}/restore` | POST | 恢复单本书籍 |
| `/api/v1/books/restore` | POST | 批量恢复 `{ids: []}` |
| `/api/v1/books/{id}/permanent` | DELETE | 永久删除单本 |
| `/api/v1/books/permanent` | DELETE | 批量永久删除 `{ids: []}` |

**前端实现要点**：
1. 通过 PowerSync 查询 `SELECT * FROM books WHERE deleted_at IS NOT NULL`
2. 恢复操作：PowerSync UPDATE `deleted_at = NULL`
3. 永久删除：**必须调用 REST API**（非 PowerSync），因为需要处理私人数据和引用计数

#### B.2 OCR 与向量索引触发机制（⚠️ 重要架构决策）

**核心原则**：
1. **向量索引是免费服务**，对所有书籍自动执行
2. **OCR 是收费/限额服务**，由用户主动触发
3. 图片型 PDF 未经 OCR 前，无法生成向量索引
4. **OCR 结果可复用**：相同文件只需一次真实 OCR（ADR-008）

**书籍类型判断**：
| 类型 | 判断条件 | 后续处理 |
|-----|---------|---------|
| 文字型 EPUB | `original_format = 'epub'` | 直接向量索引 |
| 文字型 PDF | 初检有文字层 (`is_digitalized = true, confidence >= 0.8`) | 直接向量索引 |
| 图片型 PDF | 初检无文字层 (`is_digitalized = true, confidence < 0.8`) | 等待用户触发 OCR |
| 转换后 EPUB | MOBI/AZW3/FB2 转换而来 | 直接向量索引 |
| 秒传引用书 | `canonical_book_id IS NOT NULL` | 继承原书状态，可触发假 OCR |

**is_image_based 判断逻辑**（前端用于显示 OCR 按钮）：
```python
# 需要显示 OCR 按钮的条件
is_image_based = (
    (is_digitalized == True AND confidence < 0.8)  # 图片型 PDF
    OR ocr_status == 'completed'  # 已完成 OCR 的书籍（可能需要重做）
)
```

**图片型 PDF 处理流程**：
```
初检发现图片型 PDF (is_digitalized = true, confidence < 0.8)
    ↓
PowerSync Service 推送 `ocr_detection` 事件到客户端
    ↓
前端弹出提示对话框：
┌──────────────────────────────────────────────────────────────┐
│  📖 书籍初检完成                                              │
│                                                              │
│  您上传的《经济学原理》经过雅典娜初步检查，此书为图片形式的      │
│  PDF 电子书。为了获得更好的阅读、笔记以及 AI 提问体验，        │
│  我们建议您对此书进行图片转文本（OCR）服务。                   │
│                                                              │
│  [稍后再处理]                            [🚀 马上转换]        │
└──────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────┬───────────────────────────────────────┐
│ 用户点击"马上转换"   │ 用户点击"稍后再处理"                    │
├─────────────────────┼───────────────────────────────────────┤
│ POST /books/{id}/ocr│ 关闭对话框                             │
│       ↓             │       ↓                               │
│ 检查用户 OCR 配额    │ 书籍卡片 ⋮ 菜单显示 "OCR 服务" 选项    │
│       ↓             │       ↓                               │
│ 任务进入队列         │ 用户随时可从菜单触发 OCR               │
│       ↓             │                                       │
│ 前端提示：           │                                       │
│ "OCR 已进入排队，    │                                       │
│  预计 XX 分钟完成，  │                                       │
│  现在可继续阅读，    │                                       │
│  但暂无法做笔记和    │                                       │
│  使用 AI 服务"      │                                       │
│       ↓             │                                       │
│ OCR 完成后自动触发   │                                       │
│ 向量索引             │                                       │
└─────────────────────┴───────────────────────────────────────┘
```

**API 端点**：
```
POST /api/v1/books/{book_id}/ocr
├─ 权限：用户已登录
├─ 前置检查：
│   ├─ 书籍存在且属于当前用户
│   ├─ 书籍是图片型 (is_digitalized = true AND confidence < 0.8)
│   │   或 is_digitalized = false (未检测)
│   └─ 用户 OCR 配额充足 (阶梯计费规则)
├─ OCR 复用检查：
│   SELECT id, ocr_result_key FROM books 
│   WHERE content_sha256 = :sha256 
│   AND ocr_status = 'completed' LIMIT 1
│   ├─ 找到 → 假 OCR，秒级完成
│   └─ 未找到 → 真实 OCR，提交 Celery 任务
├─ 响应 200 (假 OCR)：
│   {
│     "status": "instant_completed",
│     "ocr_result_key": "ocr-result-xxx.json",
│     "message": "OCR 结果已复用"
│   }
├─ 响应 200 (真实 OCR)：
│   {
│     "status": "queued",
│     "queue_position": 3,
│     "estimated_minutes": 15
│   }
├─ 响应 403：quota_exceeded (OCR 配额不足)
├─ 响应 400：already_digitalized (confidence >= 0.8，已是文字型)
└─ 响应 400：ocr_max_pages_exceeded (超过 2000 页)
```

**OCR 复用机制（假 OCR）**：
> **商业逻辑（⚠️ 重要）**：
> - 用户**必须**点击 OCR 按钮才能看到 OCR 结果（商业闭环）
> - 即使是复用，也**必须**扣除配额（维护商业公平性）
> - 但不消耗 GPU 算力（降低运营成本）

```
用户点击 OCR 按钮
    ↓
正常配额检查和扣费
    ↓
检查是否可复用（相同 SHA256 已有 OCR 结果）
    ├─ 可复用 → 直接复制 ocr_result_key，返回 instant_completed
    └─ 不可复用 → 提交 Celery 任务，返回 queued
```

**books 表新增字段（OCR 相关）**：
```sql
-- OCR 状态字段
ALTER TABLE books ADD COLUMN ocr_status VARCHAR(20) DEFAULT NULL;
-- 可选值: NULL (未检测/文字型), 'pending' (待处理), 'processing' (处理中), 'completed' (已完成), 'failed' (失败)

ALTER TABLE books ADD COLUMN ocr_requested_at TIMESTAMPTZ;
ALTER TABLE books ADD COLUMN ocr_result_key TEXT;  -- OCR 结果 JSON 的 S3 Key
ALTER TABLE books ADD COLUMN vector_indexed_at TIMESTAMPTZ;

-- SHA256 去重相关字段（ADR-008）
ALTER TABLE books ADD COLUMN content_sha256 VARCHAR(64);
ALTER TABLE books ADD COLUMN storage_ref_count INTEGER DEFAULT 1;
ALTER TABLE books ADD COLUMN canonical_book_id UUID REFERENCES books(id);
ALTER TABLE books ADD COLUMN deleted_at TIMESTAMPTZ;

-- 索引
CREATE INDEX idx_books_content_sha256 ON books(content_sha256) WHERE content_sha256 IS NOT NULL;
CREATE INDEX idx_books_canonical_book_id ON books(canonical_book_id) WHERE canonical_book_id IS NOT NULL;
```

**任务链触发规则**：
| 触发条件 | 执行任务 |
|---------|---------|
| 文字型书籍上传完成 | `tasks.index_book_vectors` |
| OCR 任务完成 | `tasks.index_book_vectors` (链式调用) |
| 用户手动重建索引 | `tasks.reindex_book_vectors` (管理员功能) |

#### B.3 元数据确认机制（Metadata Confirmation）

**核心原则**：
1. **所有书籍上传后都需要用户确认元数据**
2. 元数据（书名、作者）会影响 AI 对话的准确性
3. 用户可以选择不填写（私人资料场景），但需明确告知影响

**触发时机**：
- 后台任务 `extract_book_metadata` 完成后
- 无论是否成功提取到元数据，都通知前端弹出确认对话框

**前端交互流程**：
```
元数据提取任务完成
    ↓
PowerSync Service 推送 `metadata_extracted` 事件
    ↓
前端弹出元数据确认对话框（根据提取结果显示不同内容）

┌─────────────────────────────────────────────────────────────────┐
│  📚 请确认书籍信息                                               │
│                                                                 │
│  [情况 A: 成功提取到元数据]                                       │
│  雅典娜已从您上传的文件中提取到以下信息，请确认是否正确：           │
│                                                                 │
│  书籍名称: [经济学原理________________] ← 可编辑                  │
│  作者:     [曼昆____________________] ← 可编辑                   │
│                                                                 │
│  [情况 B: 未提取到元数据]                                         │
│  雅典娜未能从您上传的文件中提取到书籍信息。                        │
│  为了获得更好的 AI 对话体验，建议您填写以下信息：                   │
│                                                                 │
│  书籍名称: [________________________] ← 空，建议填写              │
│  作者:     [________________________] ← 空，可选                  │
│                                                                 │
│  ℹ️ 提示：书籍名称和作者信息将帮助 AI 提供更精准的回答。           │
│      如果这是私人资料而非书籍，可跳过此步骤。                       │
│                                                                 │
│  [跳过]                                          [✓ 确认]        │
└─────────────────────────────────────────────────────────────────┘
```

**API 端点**：
```
PATCH /api/v1/books/{book_id}/metadata
├─ 权限：用户已登录，书籍属于当前用户
├─ 请求体：
│   {
│     "title": "经济学原理",       // 可选
│     "author": "曼昆",            // 可选
│     "confirmed": true            // 标记用户已确认
│   }
├─ 响应 200：
│   {
│     "id": "uuid",
│     "title": "经济学原理",
│     "author": "曼昆",
│     "metadata_confirmed": true,
│     "metadata_version": "sha256:abc123"
│   }
└─ 支持 If-Match 乐观锁
```

**books 表新增字段**：
```sql
ALTER TABLE books ADD COLUMN metadata_confirmed BOOLEAN DEFAULT FALSE;
ALTER TABLE books ADD COLUMN metadata_confirmed_at TIMESTAMPTZ;
```

**书籍卡片菜单逻辑**：
```typescript
// BookCard 组件的 ⋮ 下拉菜单
const menuItems = [
  { label: '查看详情', action: 'view' },
  { label: '添加到书架', action: 'shelf' },
  // ✨ 新增：编辑元数据选项（始终显示）
  {
    label: '✏️ 编辑书籍信息',
    action: 'edit_metadata',
    description: '修改书籍名称和作者'
  },
  // 仅当 is_digitalized = false 且 ocr_status != 'processing' 时显示
  book.is_digitalized === false && book.ocr_status !== 'processing' && {
    label: '🔤 OCR 服务',
    action: 'ocr',
    description: '将图片转换为可选择文本'
  },
  // 仅当 ocr_status = 'processing' 时显示
  book.ocr_status === 'processing' && {
    label: '⏳ OCR 处理中...',
    disabled: true
  },
  { label: '删除', action: 'delete', danger: true },
].filter(Boolean);
```

**与 AI 对话的关系**：
> ⚠️ **重要**：书籍的 `title` 和 `author` 字段会作为上下文发送给上游 AI 模型。
> 
> 在 AI 对话的系统提示词中，我们会包含：
> ```
> 用户正在阅读的书籍：《{book.title}》，作者：{book.author}
> ```
> 
> 这有助于 AI 模型：
> 1. 理解用户问题的背景上下文
> 2. 提供与书籍内容相关的精准回答
> 3. 避免混淆同名但不同版本的书籍
>
> 如果用户上传的是私人资料（非书籍），可以跳过元数据确认，此时 AI 对话将仅基于文档内容本身。

**元数据提取规则**：
- 标题更新判断条件（满足任一则覆盖）：
  1. 当前标题为空
  2. 当前标题包含下划线 (`_`)
  3. 当前标题以扩展名结尾 (`.epub`, `.pdf`, `.mobi`, `.azw3`)
  4. 当前标题为 `书名-作者名` 格式，而提取的标题更短且不含连字符
- 作者仅在当前为空时更新

**存储策略**：
- 最终 S3 中只保留 EPUB 和 PDF 格式
- 非 EPUB/PDF 在 Calibre 转换成功后自动删除原始文件
- `minio_key` 始终指向可阅读文件

**支持格式**：
| 格式 | 处理方式 |
|:---|:---|
| EPUB | 直接存储，提取封面和元数据 |
| PDF | 直接存储，提取封面和元数据 |
| MOBI | Calibre 转换为 EPUB，删除原始文件 |
| AZW3 | Calibre 转换为 EPUB，删除原始文件 |
| FB2 | Calibre 转换为 EPUB，删除原始文件 |

#### C. 前端组件契约（Frontend Contract）
- 组件：`UploadManager`
  - Props：
    ```ts
    interface UploadManagerProps {
      onUploaded?: (book: { id: string; downloadUrl: string }) => void
      onError?: (code: 'quota_exceeded' | 'init_failed' | 'put_failed' | 'complete_failed' | 'unknown') => void
    }
    ```
  - 交互：选择文件→计算指纹→初始化→PUT 上传→完成→回调；403 超限映射到文案键。
  - 状态：`idle | hashing | initializing | uploading | completing | done | error`
- 组件：`ShelfList` / `ShelfEditor`（已实现）。

### ✔ Definition of Done (DoD)
- [x] API 契约覆盖上传 init/complete 与 Shelves CRUD
- [x] 上传幂等与分片重试用例通过
- [x] Calibre 转换流水线实现与测试
- [x] 封面提取与 WebP 优化实现
- [x] 元数据智能提取与标题更新逻辑
- [x] RLS 策略与只读锁拦截测试通过
- [x] 前端上传组件与状态管理对齐
- [x] **SHA256 全局去重机制实现与测试（ADR-008）**
- [x] **秒传接口 dedup_reference 实现**
- [x] **OCR 复用（假 OCR）机制实现**
- [x] **软删除/硬删除分层策略实现**
- [x] **引用计数与删除联动测试通过**
- [ ] Shelves 树形结构前端完善（待实现）

---

### 2.3 Reader Core

#### A. 数据库模型（Database Schema）
- **Core Principle**: **App-First & Local-First**. 
- **Server Database**: `reading_sessions` (PostgreSQL) - Source of Truth for "Last Read Position" across devices.
- **Local Database**: `reading_progress` (SQLite) - The only DB the UI interacts with directly.
- **Sync**: PowerSync syncs `reading_sessions` (Server) <--> `reading_progress` (Local).

#### B. 后端逻辑与 API 契约（Backend & Contract）
- **Sync Architecture (PowerSync)**:
  - 后端不提供直接的 Restful API 给阅读器 UI。
  - **Reading Progress** 通过 PowerSync 流式写入 PostgreSQL `reading_sessions` 表。
  - **Heartbeat**: 传统的 RESTful 心跳 API (`POST /heartbeat`) **被废弃**，改为本地写入 SQLite，由 PowerSync 后台自动同步。
  
#### C. 前端组件契约（Frontend Contract）
- 组件：`Reader`
  - Props:
    ```ts
    interface ReaderProps {
      bookId: string
      initialLocation?: string // From SQLite
    }
    ```
  - **Interaction**:
    - **Page Turn**: Writes `cfi` to SQLite `reading_progress` table immediately.
    - **Sync**: PowerSync SDK watches SQLite changes and pushes to server automatically.
    - **Offline**: No extra logic needed; SQLite is always available.
  
### ✔ Definition of Done (DoD)
- [ ] SQLite Schema defined for `reading_progress`
- [ ] PowerSync Sync Rules configured for `reading_sessions`
- [ ] Reader component reading/writing from/to SQLite
- [ ] Conflict resolution (LWW) verified via PowerSync configuration

---

### 2.4 Notes & Highlights

#### A. 数据库模型（Database Schema）
- `notes`：`id`、`user_id`、`book_id`、`content`、`chapter`、`location`、`pos_offset`、`tsv`、`updated_at`、`version`、`deleted_at`。
- `tags`：`id`、`user_id`、`name`、`updated_at`、`version`、`deleted_at`。
- `note_tags`：连接表，`note_id`、`tag_id`；`ON CONFLICT DO NOTHING`。
- 权限字段：`user_id`；并发字段：`version`。

#### B. 后端逻辑与 API 契约（Backend & Contract）
- **PowerSync Surface**：`download_config` 同步 `notes`, `highlights`, `tags`, `note_tags`, `highlight_tags`；`upload_config` 允许携带 `device_id`, `updated_at`, `is_deleted` 字段的 UPSERT。
- **REST 端点**：`/api/v1/notes/*`, `/api/v1/highlights/*`, `/api/v1/tags/*` 仅保留下列用途：管理员工具、外部集成、PowerSync 失效时的应急回退。
- **一致性规则**：
  - 只读锁依旧通过 RLS/触发器阻断写入；PowerSync 上传失败会返回对应的 4xx 代码。
  - 软删除依赖 `_deleted` + `_deleted_at` 字段；服务端接收删除后通过 PowerSync 下发。
  - 冲突：笔记/高亮采用 Conflict Copy（由触发器写 `conflict_of`）。

#### C. 前端组件契约（Frontend Contract）
- 组件：`NoteEditor`
  - Props 同上。
  - 交互：保存→写 SQLite (`notes` 表)→PowerSync 自动同步；在 `onError` 中只处理本地验证或 PowerSync 失败事件。
- 组件：`TagPicker`
  - Props：
    ```ts
    interface TagPickerProps {
      tags: Array<{ id: string; name: string; etag: string }>
      onCreate: (name: string) => void
      onUpdate: (id: string, name: string, etag: string) => void
    }
    ```

### ✔ Definition of Done (DoD)
- [ ] PowerSync 下载/上传规则涵盖 Notes/Tags CRUD 与搜索所需字段
- [ ] 软删除与 `_deleted` 投递及前端处理用例
- [ ] `tsv` 索引生成与检索测试覆盖
- [ ] ETag/Idempotency 一致性校验
- [ ] RLS 与多租户隔离测试
- [ ] 迁移脚本与回滚计划齐备
---

### 2.5 AI Knowledge Engine

#### A. 数据库模型（Database Schema）
- [待确认/待实现] 对话与上下文表结构将随后续迁移补齐（参考 05 契约）。

#### B. 后端逻辑与 API 契约（Backend & Contract）
- 端点：`POST /ai/chat`、`GET /ai/history`、`POST /ai/context`（参考 05 契约）。
- 规则：
  - AI Chat 不受只读锁影响。
  - Credits 不足 → 返回 `INSUFFICIENT_CREDITS`。
  - 计费顺序：月度赠礼 → 加油包 → Wallet → 拒绝。
  - 会话版本冲突：使用 `ETag/If-Match` 或 Session Version，冲突返回 409。
- RAG 流程：
  1) Query Rewrite：基于 Prompt 结合用户上下文（选中文本/笔记）重写查询。
  2) Vector Search：使用嵌入模型生成向量，在 OpenSearch/向量索引中检索 Top-K 片段。
  3) Re-rank：对 Top-K 进行重排序（Cross-Encoder 或 LLM 评分）。
  4) LLM 生成：以重排后的证据生成回答，包含引用与跳转锚点。
  5) 流式输出：使用 SSE/WebSocket 推送；支持“停止/继续”。
  6) 预算与节流：计费消耗 Credits；达到配额阈值时提示降级为检索或摘要模式。
> Status: Contract Available；Backend = To Implement（按此管线实现）。

#### C. 前端组件契约（Frontend Contract）
- 组件：`AIConversationsPanel`
  - Props：
    ```ts
    interface AIConversationsPanelProps {
      sessionId?: string
      onMessage?: (msg: { id: string; role: 'user' | 'assistant'; content: string }) => void
      onStop?: () => void
    }
    ```

### ✔ Definition of Done (DoD)
- [ ] API 契约与 SSE/WebSocket 行为对齐
- [ ] Credits 扣费顺序与不足错误用例
- [ ] RAG 各阶段可替换/Mock 的测试策略
- [ ] ETag/Session Version 冲突处理测试
- [ ] 前端消息流与停止/继续契约实现
- [ ] 账单联动与台账记录验证
---

### 2.6 Billing & Account

#### A. 数据库模型（Database Schema）
- `credit_accounts`、`credit_ledger`、`payment_sessions`、`payment_webhook_events`、`user_stats`（字段详见 04 号文档）。

#### B. 后端逻辑与 API 契约（Backend & Contract）
- 端点：`GET /billing/balance`、`GET /billing/ledger`、`POST /billing/sessions`、`POST /billing/webhook/{gateway}`。
- 规则：只读锁由 `user_stats` 与 `system_settings` 计算；OCR 阶梯扣费与台账记载；Webhook 入账与签名校验。

#### C. 前端组件契约（Frontend Contract）
- 组件：`BalanceCard`
  - Props：
    ```ts
    interface BalanceCardProps {
      balance: number
      currency: string
      walletAmount?: number
      walletCurrency?: string
    }
    ```
- 组件：`CheckoutPanel`
  - Props：
    ```ts
    interface CheckoutPanelProps {
      gateway: 'stripe' | 'wechat' | 'alipay' | string
      amountMinor: number
      currency: string
      onSessionCreated: (session: { id: string; paymentUrl: string }) => void
    }
    ```
  - 交互：创建会话→跳转第三方→Webhook 入账→刷新余额与台账。
- 只读锁 UI 表现（与 01 文档一致）：
  - `BookCard`：上传入口置灰；显示锁图标；点击弹出 Toast 提示“空间已满，无法上传新书”。
  - `NoteEditor`：保存按钮置灰或改为“本地保存”；尝试云端保存时显示 Toast “笔记仅保存在本地”；在列表中以“未同步”状态展示并提供引导升级入口。
  - 全局 Banner：在只读状态下顶部显示警示 Banner，文案与颜色遵循设计系统；操作按钮禁用或变更为引导。

### ✔ Definition of Done (DoD)
- [ ] 支付会话创建与 Webhook 入账联动用例
- [ ] 事务一致性：扣费与业务写入同交易测试
- [ ] RLS 与账本隔离校验
- [ ] 错误码映射与文案一致性
- [ ] 前端余额/台账组件契约对齐
- [ ] Alembic 迁移与回滚计划齐备

---

## 3. 统一约束与实现备注
- [MUST] 禁止硬编码数值与价格；所有阈值与定价从配置与定价表读取（见 04）。
- [MUST] 前端契约统一：
  - 所有 POST 必须带 `Idempotency-Key`
  - 所有 PATCH 必须带 `If-Match`
  - 所有 GET 建议带 `If-None-Match`（弱缓存可选）
- [MUST] RLS：每次数据库操作设置会话变量实现行级隔离。
- [待确认/待实现] Reader/AI 流式细节、Shelves 完整 CRUD 与前端适配将随后续迭代补齐，并与 05 契约保持一致。


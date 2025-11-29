# 02_Functional_Specifications_PRD.md

## 1. 核心功能概览
- User & Auth（登录/注册/JWT）
- Books & Shelves（上传/列表/OCR 触发/书架）
- Reader Core（阅读器与进度同步/心跳）
- Notes & Highlights（笔记/高亮/标签/搜索）
- AI Knowledge Engine（RAG 对话/流式输出）
- Billing & Account（充值/配额/只读锁逻辑）

说明：接口定义以 05 号文档（API 契约）为准；数据库结构以 04 号文档（DB）为准。响应格式以《00_AI_Coding_Constitution_and_Rules.md》的错误码 Schema 为准；成功响应以 05 契约为准（通常为 `{ data: ... }`）。

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
  - 字段：`id (UUID, PK)`、`user_id (UUID, FK)`、`title (TEXT)`、`author (TEXT)`、`language (TEXT)`、`original_format (TEXT)`、`minio_key (TEXT)`、`size (BIGINT)`、`is_digitalized (BOOL)`、`initial_digitalization_confidence (FLOAT)`、`source_etag (TEXT)`、`meta (JSONB)`、`digitalize_report_key (TEXT)`、`updated_at (TIMESTAMPTZ)`。
  - 权限字段：`user_id`（RLS）。
- `shelves`：
  - 字段：`id (UUID, PK)`、`user_id (UUID, FK users.id)`、`name (TEXT)`、`parent_shelf_id (UUID, NULLABLE, FK shelves.id)`、`updated_at (TIMESTAMPTZ)`、`version (INT)`。
  - 关系：`users (1) — (N) shelves`；支持层级结构（父子架）。
- `book_shelves`（关联表）：
  - 字段：`book_id (UUID, FK books.id)`、`shelf_id (UUID, FK shelves.id)`、`created_at (TIMESTAMPTZ)`。
  - 约束：主键（`book_id`, `shelf_id`）；`ON CONFLICT DO NOTHING` 用于去重。
> Status: Backend Implemented（Books 上传与索引）；Shelves = To Implement（按此结构落库与 CRUD）。

#### B. 后端逻辑与 API 契约（Backend & Contract）
- 端点：`POST /books/upload_init`、`POST /books/upload_complete`。
- 规则：
  - 上传前校验配额；完成后落库与索引同步；支持 `Idempotency-Key`。
  - @if (`user_stats.is_readonly`)：
    - `POST /books/upload_init` → 403 `QUOTA_EXCEEDED`
    - Shelves 全量 CRUD 禁止（`POST/PUT/PATCH/DELETE` 返回 403）

#### C. 前端组件契约（Frontend Contract）
- 组件：`UploadManager`
  - Props：
    ```ts
    interface UploadManagerProps {
      onUploaded?: (book: { id: string; downloadUrl: string }) => void
      onError?: (code: 'quota_exceeded' | 'init_failed' | 'put_failed' | 'complete_failed' | 'unknown') => void
    }
    ```
  - 交互：选择文件→初始化→PUT 上传→完成→回调；403 超限映射到文案键。
- 组件：`ShelfList` / `ShelfEditor`（[待实现]）。

### ✔ Definition of Done (DoD)
- [ ] API 契约覆盖上传 init/complete 与 Shelves CRUD
- [ ] 上传幂等与分片重试用例通过
- [ ] Shelves/Book_Shelves 迁移脚本与索引到位
- [ ] RLS 策略与只读锁拦截测试通过
- [ ] 前端上传与 Shelves 组件契约对齐
- [ ] 成功/错误码与文案映射一致

---

### 2.3 Reader Core

#### A. 数据库模型（Database Schema）
- 依赖：`books` 内容与对象存储。
- `reading_sessions`：
  - 字段：`id (UUID, PK)`、`user_id (UUID, FK users.id)`、`book_id (UUID, FK books.id)`、`last_position (TEXT)`、`progress (FLOAT)`、`updated_at (TIMESTAMPTZ)`、`version (INT)`。
  - 权限字段：`user_id`；并发字段：`version`（乐观锁）。

#### B. 后端逻辑与 API 契约（Backend & Contract）
- 端点：
  - `POST /reading-sessions`（创建或查找当前书籍的阅读会话）
  - `POST /reading-sessions/{id}/heartbeat`（心跳：上报位置与进度）
- 心跳 Payload：`{ position: string, progress: number, timestamp: string }`
- 规则：
  - 心跳更新 `reading_sessions.last_position/progress/updated_at`，返回最新版本（弱 ETag 可选）。
  - 离线心跳缓存允许，服务端按时间序处理并去重；超频上报进行节流。
  - ReaderHeartBeat 不受只读锁影响，允许继续更新 `last_position` 与 `progress`。
> Status: Contract Available；Backend = To Implement（按此流程对齐）。

#### C. 前端组件契约（Frontend Contract）
- 组件：`Reader`
  - Props：
    ```ts
    interface ReaderProps {
      bookId: string
      initialLocation?: string
      onLocationChange?: (loc: string) => void
      onHighlightCreate?: (hl: { cfi: string; text: string; color: string }) => void
    }
    ```
  - 心跳交互：
    - 在线：优先使用 `navigator.sendBeacon('/api/v1/reading-sessions/{id}/heartbeat', payload)`；无 `sendBeacon` 时使用 `fetch`（`keepalive: true`）。
    - 离线：写入 IndexedDB `reading_heartbeats` 队列；恢复网络后按时间序批量上报并清理。
  - 并发：遇到 409（版本冲突）拉取最新版本并重放未提交心跳；UI 显示轻量提示不打断阅读。
> Status: Frontend = To Implement（按此契约实现心跳与缓存）。

### ✔ Definition of Done (DoD)
- [ ] API 契约与心跳 Payload 对齐
- [ ] 版本并发与 409 重放逻辑测试覆盖
- [ ] 离线 IndexedDB 队列与批量上报用例
- [ ] ETag/弱缓存策略校验
- [ ] RLS 与多租户隔离测试
- [ ] 无视只读锁的心跳规则验证

---

### 2.4 Notes & Highlights

#### A. 数据库模型（Database Schema）
- `notes`：`id`、`user_id`、`book_id`、`content`、`chapter`、`location`、`pos_offset`、`tsv`、`updated_at`、`version`、`deleted_at`。
- `tags`：`id`、`user_id`、`name`、`updated_at`、`version`、`deleted_at`。
- `note_tags`：连接表，`note_id`、`tag_id`；`ON CONFLICT DO NOTHING`。
- 权限字段：`user_id`；并发字段：`version`。

#### B. 后端逻辑与 API 契约（Backend & Contract）
- 端点：`POST /notes`、`GET /notes`、`POST /tags`、`GET /tags`、`PATCH /tags/{id}`。
- 规则：
  - 只读锁阻断写入；创建携带 `Idempotency-Key`；更新携带 `If-Match` 弱 ETag`；索引联动。
  - 软删除：仅标记 `deleted_at`，不物理删除；默认查询过滤 `deleted_at IS NULL`。
  - 同步与前端处理：当服务端返回 410/404 表示条目不可用时，前端移除本地缓存并标记“已删除”。

#### C. 前端组件契约（Frontend Contract）
- 组件：`NoteEditor`
  - Props：
    ```ts
    interface NoteEditorProps {
      bookId: string
      initialContent?: string
      initialTags?: string[]
      onSaved: (note: { id: string; content: string; tags: string[] }) => void
      onError: (code: 'readonly' | 'invalid' | 'conflict' | 'unknown') => void
    }
    ```
  - 交互：保存→API→成功更新列表；409 冲突提示并拉取最新 ETag。
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
- [ ] API 契约覆盖 Notes/Tags CRUD 与搜索
- [ ] 软删除与 410/404 前端处理用例
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


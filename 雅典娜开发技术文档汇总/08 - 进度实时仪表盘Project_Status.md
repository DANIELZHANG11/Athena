# PROJECT_STATUS.md

> **最后更新**: 2025-12-05 23:30
> **当前阶段**: Phase 5 - SHA256 全局去重与 OCR 复用机制 ✅ 已完成

## 1. 总体进度 (Overall)

| 模块 | 状态 | 说明 |
| :--- | :--- | :--- |
| Backend API | ✅ 100% | 核心逻辑与 DB 已就绪，**SHA256 去重 + OCR 复用 + 软删除/硬删除机制已完成** |
| Frontend Web | ✅ 99% | Auth ✅, Upload ✅, **秒传 + 假 OCR + 书籍删除流程已完成** |
| Infrastructure | ✅ 100% | Docker/CI/SRE 手册就绪, OpenSearch 中文插件已安装, Worker GPU 加速已配置 |
| Data Sync | ✅ 100% | **智能心跳同步 ADR-006 前后端均已完成并集成** |
| i18n | 🔧 本地模式 | **Tolgee 暂时禁用，使用本地 JSON 翻译文件** |

---

## 🔥 最新更新 (2025-12-05 23:30)

### ADR-007: SHA256 全局去重与 OCR 复用机制 ✅ 已完成

完整实现了基于 SHA256 的全局去重、OCR 复用（假 OCR）、软删除/硬删除分层策略。

#### 1. SHA256 全局去重 ✅

**功能描述**：相同文件只存储一份，后续用户上传时秒传。

**实现要点**：
- 前端计算 SHA256（移动端可能失败）
- 服务端在 `upload_complete` 时从 S3 读取文件作为备用计算
- `upload_init` 检查全局是否存在相同 SHA256
- 命中时返回 `dedup_available=true`，客户端调用 `dedup_reference`

**代码修改**：
- `api/app/books.py`: `upload_init` 添加去重检查，`upload_complete` 添加服务端 SHA256 计算
- `web/src/hooks/useBookUpload.ts`: `computeSha256` 增强错误处理

#### 2. OCR 复用机制（假 OCR）✅

**功能描述**：相同文件只需一次真实 OCR，后续用户点击 OCR 时秒级完成。

**商业逻辑**：
- 用户仍需点击 OCR 按钮（触发配额扣除）
- 但后端不实际执行 OCR，复用已有结果
- Worker 无工作量，节省 GPU 算力

**实现要点**：
```python
# 查找相同 SHA256 中已完成 OCR 的书籍
existing = SELECT id FROM books 
           WHERE content_sha256 = :sha256 
           AND ocr_status = 'completed' 
           LIMIT 1

if existing:
    # 假 OCR：复用结果，秒完成
    return {"status": "instant_completed"}
else:
    # 真 OCR：提交 Celery 任务
    celery_task.delay(book_id)
```

**代码修改**：
- `api/app/books.py`: `trigger_book_ocr` 添加 OCR 复用逻辑
- `api/app/tasks.py`: OCR 完成后不覆盖 `initial_digitalization_confidence`

#### 3. 软删除/硬删除分层策略 ✅

**功能描述**：区分公共数据（S3 文件、OCR 结果）和私人数据（笔记、进度），实现智能删除。

**删除策略**：
| 场景 | 删除类型 | 行为 |
|-----|---------|------|
| 原书有引用 (`ref_count > 1`) | 软删除 | 设置 `deleted_at`，保留公共数据 |
| 原书无引用 (`ref_count <= 1`) | 硬删除 | 物理删除所有数据 |
| 引用书删除 | 硬删除 | 删除记录，减少原书引用计数 |

**关键修复**：
1. `storage_ref_count` 判断：`> 1` 表示有引用（原为 `> 0`），因为初始值 1 代表原书自身
2. 软删除书籍清理条件：`<= 1` 触发清理（原为 `== 0`）

**代码修改**：
- `api/app/books.py`: `delete_book` 实现分层删除策略

#### 4. is_image_based 判断修复 ✅

**问题**：秒传书籍的 `is_image_based` 误判为 `False`，导致 OCR 按钮不显示。

**根因**：`dedup_reference` 设置 `is_digitalized=False`，导致 `is_image_based=(False AND True)=False`。

**修复**：
```python
if canonical_has_ocr:
    # 原书已 OCR：新书设为"图片型 PDF 但未 OCR"状态
    new_is_digitalized = True  # 改为 True（原为 False）
    new_confidence = 0.1       # 低置信度，确保 is_image_based=True
```

#### 5. etag 软删除恢复逻辑 ✅

**问题**：用户删除书籍后重新上传相同文件，etag 查询返回软删除的书籍记录。

**修复**：
- etag 查询添加 `deleted_at IS NULL` 条件
- 如果找到软删除的书籍，自动恢复（清除 `deleted_at`）

#### 6. 完整流程测试验证 ✅

| 步骤 | 操作 | 结果 |
|------|------|------|
| 1 | WEBMASTER 上传"小说的艺术" | ✅ 创建书籍，服务端计算 SHA256 |
| 2 | WEBMASTER 点击 OCR | ✅ 真实 OCR 处理 (213 页，~45秒) |
| 3 | 126690699 上传同书 | ✅ 全局去重命中，秒传 |
| 4 | 126690699 点击 OCR | ✅ 假 OCR，秒完成（Worker 无工作） |
| 5 | WEBMASTER 删除 | ✅ 软删除（`storage_ref_count=2 > 1`） |
| 6 | 126690699 正常访问 | ✅ 公共数据保留，正常阅读 |
| 7 | 126690699 删除 | ✅ 物理删除所有公共数据 |
| 8 | 数据库验证 | ✅ 所有记录已物理删除 |
| 9 | S3 验证 | ✅ 所有文件已清理 |

#### 📚 技术文档更新

- **03 - 系统架构与ADR**: 新增 ADR-007 完整设计文档
- **04 - 数据库全景**: 更新 `books` 表字段说明和删除策略
- **01 - 商业模型**: 新增 OCR 复用机制商业逻辑说明

---

## 🔥 更早更新 (2025-12-05 10:30)

### OCR 功能 Bug 修复 ✅

用户测试发现的问题：

#### 1. OCR 触发 400 错误修复 ✅

**问题**：点击 OCR 按钮返回 `POST /books/{id}/ocr 400 (Bad Request)`

**根因**：`trigger_book_ocr` API 错误地检查 `if is_digitalized`（表示"已检测"），而应该检查 `confidence >= 0.8`（表示"已数字化，不需要 OCR"）。

**修复 (`api/app/books.py`)**：
```python
# 修复前
if is_digitalized:
    raise HTTPException(status_code=400, detail="already_digitalized")

# 修复后
if is_digitalized and (confidence is not None and confidence >= 0.8):
    raise HTTPException(status_code=400, detail="already_digitalized")
```

#### 2. OCR 完成后前端自动刷新 ✅

**问题**：OCR 处理完成后，书籍卡片上的「正在处理」状态不会自动消失，需要手动刷新浏览器。

**根因**：前端没有轮询机制检测 OCR 状态变化。

**修复 (`web/src/pages/LibraryPage.tsx`)**：
```typescript
// 检查是否有书籍正在 OCR 处理中
const hasOcrProcessing = useMemo(() => 
  items.some(item => item.ocrStatus === 'pending' || item.ocrStatus === 'processing'),
  [items]
)

// OCR 处理中时，每 5 秒轮询一次刷新列表
useEffect(() => {
  if (!hasOcrProcessing) return
  
  const pollInterval = setInterval(() => {
    console.log('[LibraryPage] Polling for OCR status update...')
    fetchList()
  }, 5000)
  
  return () => clearInterval(pollInterval)
}, [hasOcrProcessing, fetchList])
```

#### 3. 后处理完成后刷新列表 ✅

**问题**：用户上传书籍后点击"稍后"关闭对话框，LibraryPage 数据没有刷新，导致 `isImageBased` 为旧值。

**修复**：
- `UploadManager.tsx`：后处理完成后广播 `book_data_updated` 事件
- `LibraryPage.tsx`：监听该事件并刷新书籍列表

#### 4. OCR 首次执行延迟说明 ⚠️ 已知问题

**现象**：首次触发 OCR 时，从提交到开始处理约有 2 分钟延迟。

**原因**：PaddleOCR 模型（PP-OCRv5_mobile_det + PP-OCRv5_mobile_rec）首次执行时需要从网络下载，约 2 分钟。

**解决**：这是一次性的冷启动行为，模型下载后会缓存到 `/root/.paddlex/official_models/`，后续 OCR 任务将直接使用缓存，无延迟。

#### 5. OCR 文字对齐问题 ⚠️ 已知限制

**现象**：OCR 识别的文字层与 PDF 原始图像有轻微偏移。

**原因**：
- OCR 坐标基于渲染图片的像素坐标（如 1018×1425）
- PDF 阅读器显示尺寸基于 PDF 页面尺寸（如 595×842 点）
- 两者的比例和坐标系映射存在差异

**当前状态**：用户确认此问题不需要紧急修复，作为已知限制记录。

---

## 🔥 更早更新 (2025-12-04 14:30)

### 书籍卡片菜单功能增强 ✅

用户需求：在书籍卡片的三点下拉菜单中添加：
1. 书籍元数据编辑（标题、作者）
2. OCR 触发（仅图片型 PDF 显示）

#### 1. 后端 API 增强 ✅

修改 `GET /books` 列表 API 返回更多字段：
```python
# api/app/books.py
{
    "ocr_status": r[16],  # OCR 状态: pending/processing/completed/failed/null
    "is_image_based": bool(r[10]) and float(r[11]) < 0.8,  # 图片型 PDF 判断
}
```

#### 2. 前端组件更新 ✅

**BookCardMenu.tsx 重构**：
- 新增 `ocrStatus`、`isImageBased`、`bookAuthor` 属性
- 新增「编辑信息」菜单项（所有书籍显示）
- 新增「OCR 本书」菜单项（仅图片型 PDF 且未完成 OCR）
- 新增「OCR 处理中」状态显示（带加载图标）
- 集成 `BookMetadataDialog` 和 `OcrTriggerDialog` 组件

**BookCard.tsx 更新**：
- 新增 `ocrStatus`、`isImageBased`、`onMetadataChange`、`onOcrTrigger` 属性
- OCR 处理中时，卡片中央显示 OCR 图标和"OCR 处理中"文字
- Grid 变体：覆盖层居中显示
- List 变体：左下角小标签显示

**BookMetadataDialog.tsx (新建)**：
- 元数据编辑对话框，支持修改书籍标题和作者
- 调用 `PATCH /books/{id}/metadata` API
- 毛玻璃设计风格，符合 UIUX 规范

#### 3. LibraryPage 数据传递 ✅

更新 `LibraryPage.tsx`：
- `BookItem` 接口新增 `ocrStatus`、`isImageBased` 字段
- 解析后端返回的新字段
- 新增 `handleMetadataChange` 回调（更新本地状态）
- 新增 `handleOcrTrigger` 回调（更新 OCR 状态为 pending）

#### 4. 翻译更新 ✅

新增 9 个翻译键（中英文）：
- `book_menu.edit_info` - "编辑信息" / "Edit Info"
- `book_menu.ocr_book` - "OCR 本书" / "OCR This Book"
- `book_menu.ocr_processing` - "OCR 处理中..." / "OCR Processing..."
- `metadata.edit_title` - "编辑书籍信息"
- `metadata.edit_subtitle` - "修改书籍标题和作者"
- `metadata.field_title` - "书籍标题"
- `metadata.field_author` - "作者"
- `metadata.title_placeholder` - "请输入书籍标题"
- `metadata.author_placeholder` - "请输入作者（可选）"
- `metadata.title_required` - "书籍标题不能为空"

---

## 🔥 更早更新 (2025-12-04 11:55)

### 上传后处理流程完善 ✅

用户反馈上传图片型 PDF 后缺少以下提示：
1. 元数据未解析时应提醒用户填写书名和作者
2. 图片型 PDF 应提示需要 OCR

#### 1. 上传后处理 Hook (`useUploadPostProcessing.ts`) ✅

新增 Hook，上传成功后监控后台任务状态：

```typescript
const { status, startMonitoring, stopMonitoring } = useUploadPostProcessing({
  pollInterval: 2000,     // 每 2 秒轮询一次
  maxPollCount: 30,       // 最多轮询 60 秒
  onMetadataReady: (status) => { /* 元数据提取完成 */ },
  onImagePdfDetected: (status) => { /* 检测到图片型 PDF */ },
  onCoverReady: (status) => { /* 封面就绪 */ },
})
```

#### 2. 上传后处理对话框 (`UploadPostProcessDialog.tsx`) ✅

统一的后处理对话框，分步引导用户：
- **步骤 1 - 元数据确认**：若后端未提取到作者信息，弹出对话框让用户填写
- **步骤 2 - OCR 提示**：若是图片型 PDF，提示用户触发 OCR

#### 3. UploadManager 集成 ✅

修改 `UploadManager.tsx`：
- 上传成功后调用 `startMonitoring()` 开始轮询
- 根据状态回调自动弹出后处理对话框
- 后处理完成后才导航到书库页面

#### 4. 后端 API 增强 ✅

修改 `GET /books/{book_id}` 返回更多状态字段：
- `metadata_confirmed`: 用户是否已确认元数据
- `ocr_status`: OCR 状态 (pending/processing/completed/failed)
- `page_count`: 页数
- `is_image_based`: 是否是图片型 PDF
- `cover_image_key`: 封面图片存储键

#### 5. 翻译更新 ✅

新增 18 个翻译键（中英文）：
- `ocr.dialog.*` - OCR 对话框文案
- `ocr.action.*` - OCR 操作按钮
- `upload.post_process.*` - 后处理流程文案

---

## 🔥 更早更新 (2025-12-04 11:30)

### 运行时问题修复 ✅

#### 1. PDF 上传 500 错误修复 ✅

**问题**：用户上传 PDF 时收到 500 错误 `column "content_sha256" does not exist`

**原因**：迁移脚本 0122 未应用到开发环境数据库，导致 `books` 表缺少 `content_sha256`, `storage_ref_count`, `canonical_book_id` 字段。

**解决方案**：
```bash
docker-compose exec api alembic upgrade head
# 已从 0121 升级到 0122 (head)
```

#### 2. Tolgee 禁用 ✅

**问题**：Tolgee 服务未运行导致大量 `socket hang up` 代理错误。

**解决方案**：暂时禁用 Tolgee，使用本地 JSON 翻译文件。

**修改文件**：
- `web/.env.local`: 注释掉 `VITE_APP_TOLGEE_API_KEY` 和 `VITE_APP_TOLGEE_API_URL`
- `web/vite.config.ts`: 注释掉 `/tolgee-api` 代理配置

**恢复方法**：开发完成后取消上述注释即可恢复 Tolgee 功能。

---

## 🔥 更早更新 (2025-12-03 07:00)
```sql
-- books 表新增字段
content_sha256 VARCHAR(64)    -- 文件内容 SHA256 哈希
storage_ref_count INTEGER     -- 存储引用计数
canonical_book_id UUID        -- 去重后指向原始书籍

-- 创建部分索引
CREATE INDEX idx_books_content_sha256 ON books(content_sha256) WHERE content_sha256 IS NOT NULL
```

**API 改进**：
- `POST /books/upload_init`: 接收 `content_sha256` 参数，返回去重状态
  - `dedup_hit: "own"` - 当前用户已有相同文件
  - `dedup_hit: "global"` - 全局已有相同文件，可秒传
  - `dedup_hit: null` - 无去重命中，需上传
- `POST /books/upload_complete`: 保存 `content_sha256` 字段
- `POST /books/dedup_reference` (新增): 全局秒传，创建引用记录共享存储

**存储优化**：
- 相同文件只存一份，通过 `canonical_book_id` 关联
- `storage_ref_count` 追踪引用数，删除时仅减计数
- OCR 结果和封面可直接复用

#### 2. 图片 PDF 页数前端显示 + OCR 触发 UI ✅

**新增组件** (`web/src/components/OcrTriggerDialog.tsx`)：
- 显示书籍页数和阶梯分级（小/中/大型书籍）
- 显示配额消耗（1/2/3 单位）
- 显示剩余配额（免费/Pro 赠送/加油包）
- 不能触发时显示原因和购买入口

**新增 API** (`GET /books/{book_id}/ocr/quota`)：
返回：`pageCount`, `tier`, `cost`, `canTrigger`, `reason`, `freeRemaining`, `proRemaining`, `addonRemaining`, `isPro`, `maxPages`

**新增翻译** (22 键，中英文)：
- `ocr.tier_1/2/3` - 阶梯描述
- `ocr.cost_units` - 消耗单位
- `ocr.free/pro/addon_remaining` - 剩余配额
- `ocr.error_*` - 错误提示

#### 3. 封面本地缓存 ✅

**IndexedDB 升级** (`bookStorage.ts` v3)：
新增 `book_covers` store 存储封面 Blob

**新增函数**：
- `cacheCover(bookId, coverUrl)` - 下载并缓存封面
- `getCachedCover(bookId)` - 获取缓存的封面记录
- `getCoverUrl(bookId, originalUrl)` - 优先返回缓存 URL，同时异步缓存
- `batchCacheCovers(books[])` - 批量缓存
- `cleanOldCoverCache(maxAgeDays)` - 清理过期缓存

**功能特点**：
- 首次访问时异步缓存，后续离线可用
- 支持批量预缓存（书架加载时）
- 30 天自动清理过期缓存

#### 4. AI 对话本地缓存 ✅

**新增服务** (`web/src/lib/aiChatStorage.ts`)：
独立 IndexedDB 数据库 `athena_ai_chat`：
- `conversations` store - 对话列表
- `messages` store - 消息记录

**新增 Hook** (`web/src/hooks/useAIChatCache.ts`)：
```typescript
const {
  conversations,      // 对话列表
  loading, error,     // 状态
  fromCache,          // 是否来自缓存
  refreshConversations,  // 刷新列表
  getMessages,        // 获取消息（缓存优先）
  deleteConversation, // 删除对话
  cacheNewMessage,    // 缓存新消息
} = useAIChatCache()
```

**缓存策略**：
- 优先显示缓存数据，后台同步服务器
- 5 分钟内不重复请求（staleTime）
- 离线时只读显示历史对话
- 登出时清空所有缓存

---

## 🔥 更早更新 (2025-12-03 05:30)

### ADR-006 前端全部完成 ✅

#### 1. 笔记冲突解决 UI (`web/src/components/NoteConflictDialog.tsx`)

实现多设备笔记同步冲突的解决方案：

**组件功能**：
- `NoteConflictDialog`: 单个冲突的详细对话框
  - 并排显示原始版本和冲突副本
  - 显示设备来源图标（Web/iOS/Android）
  - 支持三种解决方案：保留原始 / 保留冲突 / 两者都保留
- `NoteConflictList`: 冲突列表组件
  - 显示所有待解决冲突的摘要
  - 点击展开详细对话框

**设计特点**：
- 清晰的视觉区分（原始版本 vs 冲突副本）
- 设备识别（通过 deviceId 前缀判断设备类型）
- 国际化支持（中英文）

#### 2. 智能心跳集成到阅读器 (`web/src/pages/ReaderPage.tsx`)

将 `useSmartHeartbeat` Hook 集成到阅读器页面：

```typescript
const { state: syncState, updateProgress: updateSyncProgress } = useSmartHeartbeat({
  bookId,
  clientVersions: { ocr: ocrStatus.cached ? `cached_${bookId}` : undefined },
  onPullRequired: (pull) => {
    if (pull.ocr && !ocrStatus.cached) downloadOcrData()
  },
  onNoteSyncResult: (results) => {
    const conflicts = results.filter(r => r.status === 'conflict_copy')
    // 显示冲突解决对话框
  }
})
```

**集成功能**：
- 版本指纹对比（OCR 数据）
- 自动拉取服务端新数据
- 笔记同步冲突检测
- 与现有阅读会话心跳共存

#### 3. 国际化翻译更新

新增 12 个冲突相关翻译键（中英文）：
- `conflict.dialog.*` - 对话框文案
- `conflict.label.*` - 标签文本
- `conflict.action.*` - 操作按钮
- `conflict.device.*` - 设备类型
- `conflict.list.*` - 列表文案

---

## 🔥 更早更新 (2025-12-03 05:00)

按照商业模型 V9.0 规范重新设计 OCR 收费逻辑，实现"按本计费，按页风控"策略。

#### 📐 阶梯计费规则

| 页数范围 | 消耗单位 | 可用免费额度 | 说明 |
|---------|---------|------------|------|
| ≤ 600 页 | 1 单位 | ✅ 是 | 优先扣免费额度，免费用完扣加油包 |
| 600-1000 页 | 2 单位 | ❌ 否 | **强制扣付费额度**（加油包） |
| 1000-2000 页 | 3 单位 | ❌ 否 | **强制扣付费额度**（加油包） |
| > 2000 页 | 拒绝 | - | 返回 `OCR_MAX_PAGES_EXCEEDED` |

#### 🎯 配额管理

**免费用户**：
- 月度免费额度：3 次（仅限 ≤600 页）
- 超出后需升级 Pro 或购买加油包

**Pro 会员**：
- 月度赠送：3 次（仅限 ≤600 页，月底清零）
- 超页书籍：自动扣加油包余额
- 加油包：¥8.8/10 次，永久有效

#### 💾 系统配置（迁移 0120）

添加以下可由 Admin 后台管理的配置：

| 配置项 | 默认值 | 说明 |
|-------|-------|------|
| `ocr_page_thresholds` | `{"standard": 600, "double": 1000, "triple": 2000}` | 页数阶梯定义 |
| `ocr_max_pages` | 2000 | 最大页数限制 |
| `ocr_monthly_free_quota` | 3 | 免费用户月度配额 |
| `monthly_gift_ocr_count` | 3 | Pro 会员月度赠送 |
| `price_addon_ocr` | 880 | 加油包单价（分） |
| `addon_ocr_count` | 10 | 加油包包含次数 |
| `ocr_concurrency_limit` | 1 | 全局并发限制 |
| `ocr_minutes_per_book` | 5 | 预估处理时间 |

#### 🔧 技术实现

**原子性保障**：
- OCR 配额扣除与状态更新在同一事务内
- 分发 Celery 任务失败时回滚状态

**风控逻辑**：
```python
# 页数检查 → 阶梯单位计算 → 配额验证 → 原子扣除 → 状态更新
if page_count <= 600:
    units = 1  # 可用免费额度
elif page_count <= 1000:
    units = 2  # 强制付费
elif page_count <= 2000:
    units = 3  # 强制付费
else:
    reject()  # 超过上限
```

### Celery sync_events TTL 清理 ✅ 已完成

在 `scheduler.py` 中添加定期清理任务：
- 已投递事件：保留 7 天后删除
- 未投递陈旧事件：保留 30 天后删除

---

## 🔥 更早更新 (2025-12-03 02:30)

### ADR-006 数据库迁移 ✅ 已完成

完成了三大功能模块的数据库迁移：**CRDT 同步架构**、**OCR 用户触发逻辑**、**元数据确认机制**。

#### 📦 迁移清单

| 迁移 ID | 文件名 | 描述 | 状态 |
|--------|--------|------|------|
| `0115` | `0115_add_sync_version_fields.py` | `reading_progress` 添加版本追踪字段 | ✅ 已执行 |
| `0116` | `0116_create_sync_events_table.py` | 创建 `sync_events` 服务端推送队列表 | ✅ 已执行 |
| `0117` | `0117_add_conflict_copy_fields.py` | `notes`/`highlights` 添加冲突副本字段 | ✅ 已执行 |
| `0118` | `0118_add_ocr_status_fields.py` | `books` 添加 OCR 状态字段 | ✅ 已执行 |
| `0119` | `0119_add_metadata_confirmed_fields.py` | `books` 添加元数据确认字段 | ✅ 已执行 |

#### 📊 Schema 变更详情

**1. `reading_progress` 表 - 版本追踪字段**
```sql
ocr_version VARCHAR(64)         -- OCR 数据版本 (sha256:xxx)
metadata_version VARCHAR(64)    -- 书籍元数据版本
vector_index_version VARCHAR(64) -- 向量索引版本
last_sync_at TIMESTAMPTZ        -- 最后完整同步时间
```

**2. `sync_events` 表 - 服务端事件队列**
```sql
CREATE TABLE sync_events (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    book_id UUID NOT NULL REFERENCES books(id),
    event_type VARCHAR(32),   -- ocr_ready, metadata_updated, etc.
    payload JSONB,
    created_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ
);
-- 索引：用户未投递事件、已投递事件 TTL、未投递事件 TTL
```

**3. `notes`/`highlights` 表 - 冲突副本字段**
```sql
device_id VARCHAR(64)           -- 创建/修改该条目的设备 ID
conflict_of UUID REFERENCES xxx(id) -- 冲突副本指向原始条目
-- 部分索引：仅索引 conflict_of IS NOT NULL 的记录
```

**4. `books` 表 - OCR 状态字段**
```sql
ocr_status VARCHAR(20)          -- NULL/pending/processing/completed/failed
ocr_requested_at TIMESTAMPTZ    -- 用户请求 OCR 时间
vector_indexed_at TIMESTAMPTZ   -- 向量索引完成时间
-- CHECK 约束确保 ocr_status 值有效
-- 部分索引：仅索引 pending/processing 状态
```

**5. `books` 表 - 元数据确认字段**
```sql
metadata_confirmed BOOLEAN DEFAULT FALSE  -- 用户是否确认
metadata_confirmed_at TIMESTAMPTZ         -- 确认时间
```

#### ✅ 验证结果

- 所有 5 个迁移脚本执行成功（`alembic current` 显示 `0119 (head)`）
- 所有新字段、索引、外键约束验证通过
- CHECK 约束 `chk_books_ocr_status` 确保 OCR 状态值有效

#### 📝 待办事项

数据库迁移完成后，还需实现以下业务代码：

| 模块 | 任务 | 优先级 | 状态 |
|-----|------|-------|------|
| API | 心跳接口增强 `POST /sync/heartbeat` | P0 | ✅ 已完成 |
| API | OCR 触发接口 `POST /books/{id}/ocr` | P0 | ✅ 已完成（阶梯计费） |
| API | 元数据更新接口 `PATCH /books/{id}/metadata` | P0 | ✅ 已完成 |
| API | 冲突列表/解决接口 | P1 | ✅ 已完成 |
| Celery | `sync_events` TTL 清理任务 | P1 | ✅ 已完成 |
| DB | 迁移 0120 OCR 系统配置 | P0 | ✅ 已完成 |
| DB | 迁移 0121 用户加油包余额字段 | P0 | ✅ 已完成 |
| Frontend | 元数据确认对话框 | P1 | ✅ 已完成 |
| Frontend | 智能心跳 Hook `useSmartHeartbeat` | P1 | ✅ 已完成 |
| Frontend | 集成到阅读器页面 | P1 | ✅ 已完成 |
| Frontend | 笔记冲突解决 UI | P2 | ✅ 已完成 |

---

## 🔥 更早更新 (2025-12-03 01:30)

### 元数据确认机制设计 ✅ 已完成

#### 5️⃣ 书籍元数据确认流程（02 - PRD + 05 - API）

**设计背景**：
- 书籍的 `title` 和 `author` 会作为 AI 对话的上下文发送给上游模型
- 准确的元数据能显著提升 AI 回答的精准度
- 用户上传的可能不是书籍（私人资料），需要灵活处理

**交互流程**：
```
后台元数据提取完成
    ↓
服务端发送 metadata_extracted 事件
    ↓
前端弹出元数据确认对话框
┌──────────────────────────────────────────┐
│  📚 请确认书籍信息                        │
│                                          │
│  [提取成功时]                             │
│  书籍名称: [经济学原理______] ← 可编辑    │
│  作者:     [曼昆__________] ← 可编辑     │
│                                          │
│  [未提取到时]                             │
│  书籍名称: [______________] ← 建议填写    │
│  作者:     [______________] ← 可选       │
│                                          │
│  ℹ️ 书籍信息将帮助 AI 提供更精准的回答     │
│                                          │
│  [跳过]                      [✓ 确认]    │
└──────────────────────────────────────────┘
```

**新增 API**：
- `PATCH /api/v1/books/{id}/metadata` - 更新书籍元数据（书名、作者）

**数据库变更**：
```sql
ALTER TABLE books ADD COLUMN metadata_confirmed BOOLEAN DEFAULT FALSE;
ALTER TABLE books ADD COLUMN metadata_confirmed_at TIMESTAMPTZ;
```

**书籍卡片菜单新增选项**：
- ✏️ **编辑书籍信息**：允许用户随时修改书名和作者

**心跳同步**：
- `metadataVersion = sha256(title + author)` 加入版本指纹比对
- 用户在任一设备修改元数据后，其他设备通过心跳同步自动更新

**AI 对话集成**：
```python
# 系统提示词模板
BOOK_CONTEXT_PROMPT = """
用户正在阅读的文档信息：
- 书籍/文档名称：{title}
- 作者：{author if author else "未知"}
"""
```

**私人资料场景**：
- 用户可跳过元数据确认，不影响阅读和 AI 功能
- AI 对话仍可正常使用，仅基于文档内容本身回答

---

## 🔥 更早更新 (2025-12-03 01:00)

### 技术文档架构优化 ✅ 已完成

基于架构评审反馈，对 ADR-006 及相关文档进行了重要修订：

#### 1️⃣ sync_events 表 TTL 清理策略（07 - SRE 文档）

**问题**：`sync_events` 表如果用户长期不登录会迅速膨胀

**解决方案**：
| 事件状态 | 保留时间 | 处理方式 |
|---------|---------|---------|
| 已投递 | 7 天 | 直接删除 |
| 未投递 | 30 天 | 标记用户需强制全量同步后删除 |

- 新增 Celery Beat 定时清理任务 `cleanup.sync_events`
- 每日凌晨 03:00 执行
- 添加 Grafana 表大小监控告警

#### 2️⃣ 笔记/高亮冲突处理优化（03 - ADR + 05 - API）

**问题**：LWW 策略对笔记会导致数据静默丢失

**解决方案**：改用 **Conflict Copy** 策略
- 多设备同时修改同一笔记时，不静默覆盖
- 服务端创建「冲突副本」，前端显示冲突标记
- 用户在 UI 上手动选择保留哪个版本或合并

**数据库变更**：
```sql
ALTER TABLE notes ADD COLUMN device_id VARCHAR(64);
ALTER TABLE notes ADD COLUMN conflict_of UUID REFERENCES notes(id);
```

**新增 API**：
- `GET /api/v1/notes/conflicts` - 获取冲突副本列表
- `POST /api/v1/notes/{id}/resolve-conflict` - 解决冲突

#### 3️⃣ 大 Payload 分批上传（03 - ADR + 05 - API）

**问题**：用户离线创建 1000 条高亮会导致心跳请求超时

**解决方案**：
- 单次心跳最多 50 条 notes + 50 条 highlights
- 请求体包含 `hasMore` 字段指示是否还有更多
- 响应中 `moreToSync: true` 时客户端立即发起下一次心跳
- 后端请求体限制 512KB

#### 4️⃣ OCR 用户主动触发机制（02 - PRD + 05 - API）

**问题**：OCR 是收费服务，不应上传后自动执行

**解决方案**：重构为用户主动触发模式
```
上传图片型 PDF → 初检 → 前端弹窗提示 → 用户选择
                              ├─ "马上转换" → POST /books/{id}/ocr → 进入队列
                              └─ "稍后再处理" → 书籍卡片菜单显示 "OCR 服务" 选项
```

**核心规则**：
- **向量索引是免费服务**，对所有文字型书籍自动执行
- **OCR 是收费服务**，仅对图片型 PDF 提供，由用户主动触发
- 图片型 PDF 未 OCR 前，无法生成向量索引，无法使用笔记/AI 服务

**新增 API**：
- `POST /api/v1/books/{id}/ocr` - 触发 OCR
- `GET /api/v1/books/{id}/ocr/status` - 查询 OCR 状态

**数据库变更**：
```sql
ALTER TABLE books ADD COLUMN ocr_status VARCHAR(20);  -- pending/processing/completed/failed
ALTER TABLE books ADD COLUMN ocr_requested_at TIMESTAMPTZ;
ALTER TABLE books ADD COLUMN vector_indexed_at TIMESTAMPTZ;
```

#### 文档更新清单

| 文档 | 修改内容 |
|:---|:---|
| `02 - 功能规格与垂直切片` | ✨ 新增 B.2 OCR 与向量索引触发机制章节 |
| `03 - 系统架构与ADR` | 🔧 优化数据权威分层表，笔记/高亮改为 Conflict Copy |
| `03 - 系统架构与ADR` | 🔧 心跳协议添加分批上传策略 |
| `04 - 数据库全景与迁移` | ✨ books 表新增 ocr_status 等字段 |
| `04 - 数据库全景与迁移` | ✨ notes/highlights 表新增冲突副本字段 |
| `04 - 数据库全景与迁移` | ✨ 新增迁移 0117, 0118 |
| `05 - API 契约与协议` | 🔧 心跳协议添加分批上传说明 |
| `05 - API 契约与协议` | ✨ 新增 Section 6: OCR 服务触发接口 |
| `05 - API 契约与协议` | ✨ 新增 Section 7: 笔记冲突处理接口 |
| `07 - 部署与 SRE 手册` | ✨ 新增 5.2 数据清理策略章节 |

---

## 🔥 更早更新 (2025-12-03 00:15)

### ADR-006: 智能心跳同步架构设计 ✅ 文档已完成

**背景问题**：
OCR 图片尺寸 Bug 修复过程中发现架构缺陷——服务端数据更新后，客户端无法自动感知和同步。用户需要手动刷新页面或清除 IndexedDB 才能获取新数据。

**设计核心思想**：
1. **数据权威分层**：不同数据类型有不同的权威来源
   - 客户端权威：阅读进度、笔记、高亮、SRS 卡片
   - 服务端权威：OCR 数据、书籍元数据、向量索引
2. **版本指纹机制**：使用内容哈希（`sha256:前16位`）标识数据版本
3. **心跳协议增强**：心跳不仅同步进度，还对比版本并触发按需拉取

**文档更新清单**：

| 文档 | 新增/修改内容 |
|:---|:---|
| `03 - 系统架构与ADR` | ✨ 新增 ADR-006 完整设计（约 400 行） |
| `04 - 数据库全景与迁移` | ✨ 新增 Section 8: 待迁移 Schema 变更（`reading_progress` 版本字段、`sync_events` 表） |
| `05 - API 契约与协议` | ✨ 新增 Section 5: 智能心跳同步协议（完整 Request/Response Schema） |
| `08 - 进度实时仪表盘` | 更新当前条目 |

**ADR-006 关键设计点**：

```
数据权威分层表：
┌──────────────┬────────────┬─────────────────────┐
│ 数据类型     │ 权威来源   │ 冲突策略            │
├──────────────┼────────────┼─────────────────────┤
│ 阅读进度     │ Client     │ Last-Write-Wins     │
│ 笔记/高亮    │ Client     │ LWW + Source Priority│
│ OCR 数据     │ Server     │ Server-Always-Wins  │
│ 书籍元数据   │ Server     │ Server-Always-Wins  │
│ 向量索引     │ Server     │ Server-Always-Wins  │
└──────────────┴────────────┴─────────────────────┘
```

**心跳同步协议核心流程**：
```
Client                                  Server
   │                                      │
   │─── POST /sync/heartbeat ────────────►│
   │    { clientVersions: { ocr: "v1" },  │
   │      clientUpdates: { progress } }   │
   │                                      │
   │◄── { serverVersions: { ocr: "v2" },──│
   │      pullRequired: { ocr: {...} },   │
   │      nextHeartbeatMs: 30000 }        │
   │                                      │
   │ (发现 ocr 版本不一致)                 │
   │                                      │
   │─── GET /books/{id}/ocr/full ────────►│
   │                                      │
   │◄── (gzip compressed OCR data) ───────│
   │                                      │
   └── 更新 IndexedDB，刷新 UI ────────────┘
```

**数据库 Schema 变更（待迁移）**：
- `reading_progress` 表新增：`ocr_version`, `metadata_version`, `vector_index_version`, `last_sync_at`
- 新建 `sync_events` 表：服务端待推送事件队列

**实现路线图**：
| Phase | 内容 | 优先级 |
|:---|:---|:---|
| Phase 1 | 心跳版本指纹对比 + 自动触发 OCR 下载 | P0 |
| Phase 2 | 离线同步队列（笔记/高亮） | P1 |
| Phase 3 | WebSocket 实时推送 | P2 |
| Phase 4 | 多设备冲突解决 UI | P3 |

---

## 🔥 更早更新 (2025-12-02 23:30)

### OCR 文字层一次性下载架构 ✅ 已完成

**背景问题**：
原有架构中，OCR 文字层采用按页请求的方式，每翻一页都要向服务器请求该页的 OCR 数据。对于 600+ 页的书籍：
- 服务器负载高（每页一次请求）
- 网络延迟影响阅读体验
- 离线时无法使用文字选择功能

**架构重构**：
采用「一次性下载 + IndexedDB 本地缓存」模式，与书籍文件存储策略保持一致：

| 组件 | 变更 |
|:---|:---|
| `api/app/books.py` | 新增 `/ocr/full` 端点，返回完整 OCR 数据（gzip 压缩，~2MB） |
| `api/app/tasks.py` | OCR 任务现在记录图片尺寸（`image_width`, `image_height`）到报告中 |
| `web/src/lib/bookStorage.ts` | IndexedDB 升级到 v2，新增 `book_ocr` 对象存储 |
| `web/src/hooks/useOcrData.ts` | 新增 Hook，管理 OCR 数据的下载、缓存和同步读取 |
| `web/src/hooks/useOcrPage.ts` | **已删除**（被 useOcrData 替代） |
| `web/src/components/reader/OcrTextLayer.tsx` | 重构：接收 `regions` prop，不再自行请求数据 |
| `web/src/components/reader/PdfPageWithOcr.tsx` | 重构：从父组件接收 OCR 数据 |
| `web/src/pages/ReaderPage.tsx` | 集成 useOcrData Hook，管理 OCR 生命周期 |

**数据流（新架构）**：
```
用户打开图片式 PDF
        ↓
检查 IndexedDB 是否有 OCR 缓存
    ├─ 有缓存 → 直接加载到内存
    └─ 无缓存 → GET /api/v1/books/{id}/ocr/full
                    ↓
              gzip 解压 → 存入 IndexedDB → 加载到内存
        ↓
翻页时从内存缓存同步读取当前页 OCR 区域
        ↓
渲染透明文字层（支持选择、复制）
```

**性能数据（以 632 页中文经济学书籍为例）**：
| 指标 | 数值 |
|:---|:---|
| 原始 JSON 大小 | ~9.07 MB |
| gzip 压缩后 | ~2.16 MB |
| OCR 区域数 | 22,784 |
| 总字符数 | 606,993 |
| 下载时间（局域网） | < 1s |

**Bug 修复**：
1. Python 变量名冲突：`text = item.get("text", "")` 与 SQLAlchemy 的 `text()` 函数冲突，改为 `item_text`
2. OCR 报告 `is_image_based` 字段错误：手动更新为 True
3. 图片尺寸硬编码问题：API 返回 1240x1754（A4），但实际 PDF 为 1018x1425，导致坐标映射错误

---

### 向量索引触发机制 ✅ 已实现

**功能**：OCR 完成后自动触发 OpenSearch 向量索引

| 文件 | 修改 |
|:---|:---|
| `api/app/tasks.py` | OCR 完成后调用 `index_book_content(book_id, user_id, all_regions)` |
| `api/app/search_sync.py` | 实现 `index_book_content`，将 OCR 文本分块并写入 OpenSearch |

**索引策略**：
- 按页分块，每页作为一个文档
- 使用 BGE-M3 生成 1024 维向量
- 支持全文检索 + 向量检索混合查询

---

### 🚧 待实现：智能心跳同步架构 (CRDT-Lite)

**问题发现**：
OCR 图片尺寸修复暴露了一个架构问题——当服务器端数据更新后，客户端缓存的旧数据无法自动同步。当前心跳只同步阅读进度，不处理其他数据类型。

**设计目标**：
1. 心跳不仅同步进度，还要同步数据版本
2. 自动检测客户端/服务器数据不一致
3. 根据数据类型决定同步方向（谁为准）
4. 支持离线操作和冲突解决

**详细设计见**：`03 - 系统架构与ADR System_Architecture_and_Decisions.md` ADR-006

---

## 🔥 更早更新 (2025-12-02 10:15)

### PaddleOCR v5 + BGE-M3 Embedding 基础设施升级 ✅ 已完成

**目标**: 升级 OCR 和 Embedding 服务，为生产环境 (RTX 3060 12GB) 和开发环境 (RTX 3070 8GB) 优化

**技术选型**:
| 组件 | 版本 | 说明 |
|:---|:---|:---|
| PaddlePaddle | 3.0.0 GPU (CUDA 11.8) | 深度学习框架 |
| PaddleOCR | 3.0.3 | OCR 引擎 |
| PP-OCRv5 | mobile_det + mobile_rec | 平衡精度与速度，支持中英文混合 |
| BGE-M3 | BAAI/bge-m3 (1024 dims) | 多语言 Embedding 模型 |
| OpenSearch | 2.11.1 + IK/Pinyin/STConvert | 中文搜索引擎 |

**修改文件**:
| 文件 | 修改 |
|:---|:---|
| `api/Dockerfile` | 重写 Worker 镜像构建，安装 PaddlePaddle-GPU 3.0.0、PaddleOCR 3.0.3、FlagEmbedding；修复 `libgl1-mesa-glx` 弃用问题 (Debian Trixie 改用 `libgl1-mesa-dri`) |
| `api/app/services/ocr.py` | 增强 `PaddleOCREngine`，配置 PP-OCRv5 mobile 模型路径，GPU 内存限制 3500MB，CPU 线程数 6，置信度评分 |
| `api/app/services/embedder.py` | 更新为 `BGEM3FlagModel`，GPU 优先检测 + CPU 回退，FP16 支持，1024 维输出 |
| `docker-compose.yml` | Worker 服务配置 `SKIP_HEAVY=false`，2 并发 (`-c 2`)，GPU runtime，max-tasks-per-child=50；新增 `hf_cache` 和 `opensearch_data` volumes |

**GPU 内存分配 (开发环境 8GB)**:
- 2 Celery Workers × 3.5GB = 7GB
- 系统预留 1GB

**验证状态**:
- ✅ Worker 镜像构建成功
- ✅ OpenSearch 集群状态 Green
- ✅ 中文插件 (analysis-ik, analysis-pinyin, analysis-stconvert) 已加载
- ✅ Worker 连接 Valkey 成功，6 个任务已注册
- ⏳ 待验证：首次任务执行时 OCR/Embedding 模型懒加载

---

## 🔥 更早更新 (2025-12-01 21:30)

### CONTINUE READING 横向卡片进度显示 & 元数据提取修复 ✅ 已完成

**问题 1: CONTINUE READING Hero 卡片进度显示错误**
- 症状: 实际进度 31% 的书籍在 Hero 卡片上显示为 100%
- 原因: `ContinueReadingHero.tsx` 中 `progressPercent = Math.round(progress * 100)`，但 `progress` 已经是百分比 (0-100)，导致 `31 * 100 = 3100`，被 `Math.min(100, ...)` 截断为 100%

**问题 2: Calibre 转换后书籍标题使用文件名而非元数据**
- 症状: 上传 MOBI 格式书籍后，标题显示为 `无颜的肖像-连城三纪彦`（文件名格式）而非 `无颜的肖像`（元数据中的书名）
- 原因: 元数据提取逻辑只检查下划线和扩展名后缀，未处理 `书名-作者名` 格式的文件名

**修复**:
| 文件 | 修改 |
|:---|:---|
| `web/src/pages/app/home/ContinueReadingHero.tsx` | `progressPercent` 从 `Math.round(progress * 100)` 改为 `Math.round(progress)`，避免二次乘法 |
| `api/app/tasks.py` | 改进 `extract_book_metadata` 标题更新逻辑，检测 `书名-作者名` 格式，当提取的标题更短且不含连字符时自动更新 |
| `api/app/books.py` | 修复书籍删除 SQL，`ai_conversations` 表无 `book_id` 列，改用 `ai_conversation_contexts.book_ids` (JSONB) |

**技术细节**:
- 进度数据流: API (0-1) → Home.tsx 转换为 0-100 → ContinueReadingHero 直接使用
- 标题更新判断条件增强:
  ```python
  should_update = (
      current_title 为空 or
      包含下划线 or 
      以扩展名结尾 or
      当前标题含连字符且提取标题不含且更短  # 新增
  )
  ```

---

### 书籍删除 500 错误修复 ✅ 已完成

**问题**:
- 删除书籍返回 500 错误: `column "book_id" does not exist`

**原因**:
- `ai_conversations` 表没有 `book_id` 列
- 书籍关联存储在 `ai_conversation_contexts.book_ids` (JSONB 数组)

**修复**:
| 文件 | 修改 |
|:---|:---|
| `api/app/books.py` | 重写 AI 对话删除逻辑，使用 `@>` JSONB 操作符匹配 `book_ids` 数组，清理孤立对话和消息 |

---

### 书籍卡片下拉菜单 & 删除确认对话框 Portal 修复 ✅ 已完成

**问题**:
1. 书籍卡片下拉菜单和删除确认对话框在悬停 (hover:scale) 时闪动
2. 根本原因: 父元素 `transform` 属性改变了 `fixed` 定位元素的包含块 (Containing Block)

**修复**:
| 文件 | 修改 |
|:---|:---|
| `web/src/components/BookCardMenu.tsx` | 删除确认对话框使用 `createPortal` 渲染到 `document.body`, 避免父元素 transform 影响 |

**技术细节**:
- CSS 规范: 当父元素具有 `transform` 属性时, 其内部 `fixed` 定位的子元素会相对于该父元素定位, 而不是视口
- 解决方案: 使用 React Portal 将 Modal 渲染到 body 层, 脱离组件树的 CSS 上下文

---

### 横向卡片进度显示修复 ✅ 已完成

**问题**:
- PREVIOUSLY READ 和个人书库列表模式的横向卡片进度显示不正确 (总是 0% 或 100%)

**原因**:
- `Home.tsx` 中 `progress` 字段直接使用 API 返回的小数值 (0-1), 但显示需要百分比 (0-100)

**修复**:
| 文件 | 修改 |
|:---|:---|
| `web/src/pages/app/Home.tsx` | `progress` 字段从 `x.progress` 改为 `Math.round((x.progress || 0) * 100)` |

---

### 滚动文字动效组件 ✅ 已完成

**需求**:
- 超过卡片长度的书籍名需要有从左向右滑动的动效
- 滑动一次后停止, 不要循环滚动

**实现**:
| 文件 | 修改 |
|:---|:---|
| `web/src/components/ui/ScrollText.tsx` | 新增可复用滚动文字组件, 检测文本宽度 > 容器宽度时触发动画 |
| `web/src/components/BookCard.tsx` | 横向卡片标题使用 `ScrollText` 组件 |
| `web/src/index.css` | 新增 `.mask-linear-fade` 工具类, 为滚动文字添加左右渐变遮罩 |

**技术细节**:
- 动画逻辑: 初始停留 → 滚动到末尾 → 停留 → 滚动回开头 → 停止 (不循环)
- 宽度检测: 使用 `useRef` 比较 `scrollWidth` 和 `offsetWidth`
- 响应式: 监听 `resize` 事件重新计算

---

### 横向卡片作者名显示 ✅ 已调整

**需求**:
- 横向卡片需要显示作者名

**实现**:
| 文件 | 修改 |
|:---|:---|
| `web/src/components/BookCard.tsx` | 作者名使用静态 `truncate` 显示 (不滚动), 确保始终可见 |
| `web/src/pages/app/Home.tsx` | 添加调试日志追踪 author 数据流, 确保 API 返回的数据正确传递 |

**说明**:
- 如果作者名仍不显示, 可能是 API 返回的 `author` 字段为空字符串
- 已添加 `console.log` 便于排查

---

### 阅读目标卡片 UI/UX 终极修复 ✅ 已完成

**问题**:
1. 桌面端 Modal 闪动 (Flickering): 由于 Modal 渲染在 `hover:scale` 的父容器内, 导致 `fixed` 定位基准在 Viewport 和 Parent 之间跳变.
2. 移动端 Modal 布局: 宽度过大, 缺乏间隙.

**修复**:
| 文件 | 修改 |
|:---|:---|
| `web/src/components/ui/Modal.tsx` | 使用 `createPortal` 将 Modal 渲染至 `document.body`, 彻底解决 CSS Transform 导致的定位问题; 调整宽度为 `w-[calc(100%-2rem)]` 确保移动端间隙. |
| `web/src/pages/app/home/ReadingGoalCard.tsx` | 移除冗余的 margin 类名, 依赖 Modal 统一布局 |
| `web/src/pages/app/home/YearlyGoalCard.tsx` | 移除冗余的 margin 类名, 依赖 Modal 统一布局 |

**技术细节**:
- **Portal 渲染**: 使用 `createPortal` 将 Modal 移出组件树, 避免受父组件 `transform` 属性影响 (CSS 规范: transform 元素会成为 fixed 子元素的 containing block).
- **布局规范**: Modal 统一使用 `w-[calc(100%-2rem)]` + `max-w-md` + `grid place-items-center`, 确保在任何屏幕尺寸下都有完美的间隙和居中效果.

---

### 阅读目标卡片 UI/UX 深度优化 ✅ 已完成

**问题**:
1. 桌面端 WheelPicker 持续闪动 (Event Listener Thrashing)
2. 移动端弹窗内容未居中, 且宽度过大缺乏间隙

**修复**:
| 文件 | 修改 |
|:---|:---|
| `web/src/pages/app/home/ReadingGoalCard.tsx` | 优化 WheelPicker 事件处理 (使用 useRef 避免重绑); 优化 Modal 布局 (flex 居中 + mx-6 间隙) |
| `web/src/pages/app/home/YearlyGoalCard.tsx` | 同步优化 WheelPicker 与 Modal 布局 |

**技术细节**:
- **性能优化**: WheelPicker 的 `handleWheel` 和 `handleTouchMove` 改用 `useRef` 访问当前值, 避免因 `value` 变化导致 `useEffect` 频繁解绑/重绑事件监听器, 彻底解决闪动问题.
- **移动端适配**: Modal 容器添加 `flex flex-col items-center mx-6`, 确保内容在移动端水平居中且左右留有 24px 呼吸间隙.

---

### 阅读目标卡片 UI/UX 优化 ✅ 已完成

**问题**:
1. 轮盘式目标调节器在桌面端持续闪动, 无法正常点击
2. 移动端弹窗太大, 几乎占满屏幕
3. WeeklyActivity 时区逻辑错误 - 周六显示有数据但实际还没到
4. WeeklyActivity 缺少标题

**修复**:
| 文件 | 修改 |
|:---|:---|
| `web/src/pages/app/home/ReadingGoalCard.tsx` | 重写 WheelPicker 组件, 移除拖拽逻辑避免闪动, 仅保留滚轮和箭头点击; 添加响应式尺寸 (移动端更紧凑) |
| `web/src/pages/app/home/YearlyGoalCard.tsx` | 同步更新 WheelPicker 组件, 移除拖拽逻辑; 添加响应式尺寸 |
| `web/src/pages/app/home/WeeklyActivity.tsx` | 修复时区逻辑 - 通过比较日期字符串 (YYYY-MM-DD) 判断今天/未来/过去, 而非依赖后端 status; 添加 "WEEKLY ACTIVITY" 标题 |
| `web/src/locales/zh-CN/common.json` | 新增 `home.weekly_activity`: "每周阅读情况" |
| `web/src/locales/en-US/common.json` | 新增 `home.weekly_activity`: "Weekly Activity" |

**技术细节**:
- WheelPicker 简化: 移除 `pointerdown/pointermove/pointerup` 拖拽事件, 仅保留 `onWheel` 滚轮和箭头按钮
- 响应式设计: 使用 `md:` 断点区分移动端/桌面端尺寸
- 时区处理: 使用用户本地时区获取今天日期字符串, 与后端返回的 `date` 字段直接比较

---

### 阅读目标卡片功能增强 ✅ 已完成 (2025-12-01 22:00)

**新功能**:
1. WeeklyActivity 重构 - 周日作为第一天, 三种视觉状态 (过去/今天/未来)
2. Streak 逻辑修复 - 在 heartbeat 端点添加 streak 更新
3. 轮盘式目标调节器 - 替换原有滑块, 支持滚轮和拖拽
4. 目标最大值调整 - 每日目标 max=1440min, 年度目标 max=365 books
5. 统一卡片样式 - shadow-lg + hover 缩放效果

| 文件 | 修改 |
|:---|:---|
| `api/app/reader.py` | 在 heartbeat 端点添加 streak 更新逻辑 |
| `web/src/pages/app/home/WeeklyActivity.tsx` | 完全重写, Apple Books 风格 |
| `web/src/pages/app/home/ReadingGoalCard.tsx` | 轮盘式调节器, hover 效果 |
| `web/src/pages/app/home/YearlyGoalCard.tsx` | 轮盘式调节器, hover 效果, 统一阴影 |
| `web/src/pages/app/Home.tsx` | 统一 Reading Goals 区域样式 |

---

## 🔥 更早更新 (2025-12-01)

### 年度目标卡片封面 & 竖向卡片状态刷新修复 ✅ 已完成

**问题**:
1. 年度目标卡片 (YearlyGoalCard) 封面图片不显示
2. 竖向卡片 (BookCard grid/list) 标记已读完后，UI 状态不更新，需要手动刷新页面

**修复**:
| 文件 | 修改 |
|:---|:---|
| `api/app/home_service.py` | `recent_covers` 改为返回 `book_id` 列表，而不是 `cover_image_key`（S3 key 无法直接访问） |
| `web/src/pages/app/Home.tsx` | `YearlyGoalCard.covers` 改为使用 API 代理 URL `/api/v1/books/{id}/cover?token=...` |
| `web/src/components/BookCard.tsx` | `onDeleted` 回调类型改为 `(bookId: string) => void`，`onFinishedChange` 改为 `(bookId: string, finished: boolean) => void` |
| `web/src/components/BookCard.tsx` | `BookCardMenu` 回调包装为传递 `bookId` 参数 |

**技术细节**:
- 封面 URL 统一使用 API 代理，解决移动端无法访问 localhost S3 的问题
- 回调函数签名统一，确保父组件能正确接收 `bookId` 并更新状态

---

### 书籍卡片下拉菜单 Bug 修复 ✅ 已完成

**问题**:
1. 下拉菜单被父容器的 `overflow: hidden` 裁剪，无法正常显示
2. `mark-finished` API 返回 404（Docker 容器未加载最新代码）

**修复**:
| 文件 | 修改 |
|:---|:---|
| `web/src/components/BookCardMenu.tsx` | 使用 React Portal (`createPortal`) 将下拉菜单渲染到 `document.body`，避免被父容器裁剪 |
| `web/src/components/BookCardMenu.tsx` | 添加动态位置计算，支持滚动和窗口大小变化时自动更新位置 |
| Docker 容器 | 重启 API 服务以加载最新的 `mark-finished` 端点代码 |

**技术细节**:
- Portal 渲染：菜单现在渲染到 body 最外层，z-index 设置为 9999
- 位置计算：使用 `getBoundingClientRect()` 计算按钮位置，动态设置菜单的 `top` 和 `left`
- 事件监听：监听 scroll 和 resize 事件，实时更新菜单位置

---

### 书籍卡片下拉菜单功能 ✅ 已完成
| 文件 | 修改 |
|:---|:---|
| `api/app/reader.py` | 新增 `mark-finished` 和 `mark-unfinished` 端点，进度查询返回 `finished_at` 字段 |
| `api/app/books.py` | 删除 API 级联删除所有关联数据 (笔记、高亮、AI对话等)，列表 API 返回 `finished_at` |
| `web/src/components/BookCardMenu.tsx` | 新增可复用的书籍卡片下拉菜单组件 |
| `web/src/pages/app/home/ContinueReadingHero.tsx` | 集成下拉菜单，支持已读完状态显示 |
| `web/src/pages/app/home/ContinueReadingList.tsx` | 集成下拉菜单，支持已读完状态显示 |
| `web/src/components/BookCard.tsx` | 为 grid/list 变体集成下拉菜单 |
| `web/src/pages/app/Home.tsx` | 添加删除和已读完状态变更回调 |
| `web/src/pages/LibraryPage.tsx` | 添加删除和已读完状态变更回调 |
| `web/src/locales/zh-CN/common.json` | 新增 `book_menu.*` 翻译键 |
| `web/src/locales/en-US/common.json` | 新增 `book_menu.*` 翻译键 |

**功能**:
- 移除本书：带警告对话框，级联删除笔记、高亮、AI对话、阅读进度等
- 标记为已读完：更新年度目标展示，显示勾选图标，进度显示改为"已读完"
- 标记为继续阅读：反向操作，恢复为正常阅读状态

---

### 横向卡片 Apple Books 风格实现
| 文件 | 修改 |
|:---|:---|
| `ContinueReadingList.tsx` | 重构为横向卡片：1/4 封面 + 3/4 Ambient Blur 背景 |
| `ContinueReadingHero.tsx` | 同步重构，使用封面主色调动态渲染背景 |
| `06 - UIUX设计系统.md` | 新增 Horizontal Card 规范 |

### 阅读器进度修复
| 文件 | 修改 |
|:---|:---|
| `ReaderPage.tsx` | 修复 EPUB/PDF 阅读位置恢复逻辑 |
| `reader.py` | 修复 `reading_daily` 表 UPSERT 逻辑，确保正确记录阅读时间 |
| `books.py` | 添加 `Access-Control-Allow-Origin` 头，支持 canvas 跨域读取封面 |

### 阅读器组件升级：React Reader + 虚拟滚动 ✅ 已验证
| 文件 | 修改 | 验证状态 |
|:---|:---|:---|
| `web/src/pages/ReaderPage.tsx` | EPUB 阅读器迁移至 `react-reader`（封装 epub.js），通过 Blob URL 防止额外鉴权请求；PDF 阅读器升级为 `react-pdf + react-virtuoso` 虚拟滚动，并默认开启文本层、维护坐标映射工具，便于高亮与批注。 | ✅ TypeScript 编译通过，生产构建成功 |
| `web/package.json` | 新增 `react-reader@2.0.15`、`react-virtuoso@4.15.0` 依赖 | ✅ 依赖已安装 |
| `web/pnpm-lock.yaml` | 同步锁定新依赖版本，保持 CI 环境一致。 | ✅ |

**技术验证**:
- ✅ `pnpm typecheck` 通过（修复了 4 个 TypeScript 类型错误）
- ✅ `pnpm build` 生产构建成功
- ✅ `pnpm test` 单元测试通过
- ✅ Docker 服务全部正常运行（api, postgres, valkey, seaweed, worker, opensearch, calibre）
- ✅ API 健康检查 `/health` 返回 `ok`

---

## 🎯 当前冲刺: 书籍上传与阅读器 (Sprint: Books & Reader)

### 开发计划概览

| 阶段 | 任务 | 状态 | 预计完成 |
|:---|:---|:---|:---|
| **阶段1** | 上传组件重构 (Upload Manager) | ✅ 已完成 | 2025-11-29 |
| **阶段2** | 书籍卡片体系 (Book Card System) | ✅ 已完成 | 2025-11-29 |
| **阶段3** | 书库页面完善 (Library Page) | ✅ 已完成 | 2025-11-29 |
| **阶段4** | 阅读器增强 (Reader Enhancement) | ✅ 已完成 | 2025-11-30 |
| **阶段5** | 横向卡片 (Horizontal Card) | ✅ 已完成 | 2025-11-30 |

### 阶段1: 上传组件重构 ✅ 已完成

| ID | 任务 | 状态 | 文件 |
|:---|:---|:---|:---|
| U-1 | 重构 `useBookUpload` Hook | ✅ | `web/src/hooks/useBookUpload.ts` |
| U-2 | 重构 `UploadManager` 组件 | ✅ | `web/src/components/upload/UploadManager.tsx` |
| U-3 | 新增 `UploadDropzone` 拖拽区域 | ✅ | `web/src/components/upload/UploadDropzone.tsx` |
| U-4 | 新增 `UploadProgress` 进度组件 | ✅ | `web/src/components/upload/UploadProgress.tsx` |
| U-5 | 添加 i18n 翻译键 | ✅ | `web/src/locales/*.json` |
| U-6 | 配额超限 UI 处理 | ✅ | Toast + 升级引导 (集成在 UploadProgress) |

**完成功能**:
- 6阶段上传状态: `idle | hashing | initializing | uploading | completing | done | error`
- 真实进度追踪 (XHR 事件)
- 幂等性 key 生成 (uuid)
- 取消上传支持 (AbortController)
- 多种错误码处理: `quota_exceeded | init_failed | put_failed | complete_failed | file_too_large | invalid_format | network_error | cancelled | unknown`

### 阶段2: 书籍卡片体系 ✅ 已完成

| ID | 任务 | 状态 | 说明 |
|:---|:---|:---|:---|
| B-1 | `BookCard` 基础重构 | ✅ | 封面、标题、作者、进度 |
| B-2 | `BookCardHero` 变体 | ✅ | 继续阅读大卡片 (Ambient Blur) |
| B-3 | `BookCardGrid` 变体 | ✅ | 书架网格卡片 |
| B-4 | `BookCardList` 变体 | ✅ | 列表视图卡片 |
| B-5 | 云状态图标 (智能反色) | ✅ | Cloud/Download/Check |
| B-6 | 处理状态徽章 | ✅ | cloud/downloading/ready/reading/completed |

**完成功能**:
- 4种变体: `default | hero | grid | list`
- 智能颜色适配 (基于封面亮度)
- 云端状态图标
- 进度条显示
- Hero 卡片 Ambient Blur 背景

### 阶段3: 书库页面完善 ✅ 已完成

| ID | 任务 | 状态 |
|:---|:---|:---|
| L-1 | 重构 `LibraryPage` 布局 | ✅ |
| L-2 | 上传 Modal 重构 | ✅ |
| L-3 | 网格/列表视图切换 | ✅ |
| L-4 | 加载/空状态处理 | ✅ |
| L-5 | 书籍上传事件监听 | ✅ |

### 阶段4: 阅读器增强 ✅ 已完成

| ID | 任务 | 状态 |
|:---|:---|:---|
| R-1 | 心跳同步机制 | ✅ |
| R-2 | 进度恢复逻辑 | ✅ |
| R-3 | 离线心跳缓存 (IndexedDB) | ✅ |
| R-4 | `sendBeacon` 页面关闭上报 | ✅ |
| R-5 | EPUB 阅读器切换至 React Reader（封装 epub.js） | ✅ |
| R-6 | PDF 虚拟滚动 + 文本层 + 坐标映射 | ✅ |

**完成功能**:
- `useReaderHeartbeat` Hook: 30秒心跳、进度防抖、离线缓存、页面关闭上报
- `useReadingProgress` Hook: 获取/恢复阅读进度
- EPUB CFI 位置恢复
- PDF 页码位置恢复
- React Reader（EPUB）+ Blob URL 模式，保障鉴权与续读
- PDF 虚拟滚动、文本层渲染与 Client→PDF 坐标转换（为后续高亮/批注做准备）
- 实时进度显示

---

## 2. 垂直切片详细状态 (Detailed Status)

### 2.1 User & Auth ✅ **已完成并验证**
- **后端**: [x] JWT / Login / Register (`api/app/auth.py`)
  - [x] 邮箱验证码登录 (`/auth/email/send-code`, `/auth/email/verify-code`)
  - [x] Token 刷新机制 (`/auth/refresh`)
  - [x] 会话管理 (`/auth/sessions`, `/auth/logout`)
  - [x] 用户信息 (`/auth/me`)
  
- **前端**: [x] 完整的认证流程
  - [x] 登录页面 (`web/src/pages/auth/Login.tsx`)
  - [x] 路由守卫 (`web/src/components/auth/AuthGuard.tsx`)
  - [x] Token 状态管理 (`web/src/stores/auth.ts`)
  - [x] API 拦截器 (`web/src/lib/api.ts`)
  - [x] 自动刷新 Hook (`web/src/hooks/useTokenRefresh.ts`)
  
- **Token 生命周期**:
  - Access Token: 1 小时（环境变量 `ACCESS_EXPIRE`，默认 3600 秒）
  - Refresh Token: 30 天（环境变量 `REFRESH_EXPIRE`，默认 2592000 秒）
  - 自动刷新: Token 过期前 5 分钟自动刷新
  - 持久化: Zustand persist + localStorage
  
- **Status**: ✅ **已完成** - 完整的 token 生命周期管理（方案 B），包含自动刷新和持久化，已验证正常工作

### 2.2 Books & Shelves
- Backend: [x] Upload API / Celery Tasks (`api/app/books.py`, `api/app/tasks.py`)
- Frontend: [x] BookList (`web/src/pages/LibraryPage.tsx`) 
- Frontend: [ ] UploadManager (待完善)

### 2.3 Reader Core
- Backend: [x] Heartbeat API / ReadingProgress (`api/app/reader.py`)
- Frontend: [x] Reader Component (`web/src/pages/ReaderPage.tsx`) / Progress Sync

### 2.4 Notes & Highlights
- Backend: [x] CRUD API / Search (`api/app/notes.py`)
- Frontend: [ ] NoteEditor (未见独立组件) / HighlightOverlay (集成在 Reader 中?)

### 2.5 AI Knowledge
- Backend: [x] RAG Pipeline / Chat API (`api/app/ai.py`)
- Frontend: [x] AIChatPanel (`web/src/pages/AIConversationsPage.tsx`) / Streaming

### 2.6 Billing
- Backend: [x] Ledger / Payment API (`api/app/billing.py`)
- Frontend: [x] PricingTable (`web/src/pages/BillingPage.tsx`) / BillingHistory

## 3. 下一步行动 (Next Actions)

1.  **前端**: 实现 `UploadManager` 组件，完善书籍上传与处理进度的可视化 (Books 切片)。
2.  **前端**: 拆分并完善 `NoteEditor` 与 `HighlightOverlay`，提升阅读标注体验 (Notes 切片)。
3.  **优化**: 考虑生产环境的日志控制（移除或条件化 DEBUG 日志）

## 4. 最近修复 (Latest Fixes)

### 2025-11-28 22:18: Token 字段名不一致导致的 401 错误

**问题**:
- 修改 auth store 时将 `jwt` 字段改为 `accessToken`，但多个页面仍使用旧字段名
- 导致这些页面无法获取 token，所有 API 调用返回 401

**影响范围**:
- `LibraryPage.tsx` - 书籍列表无法加载
- `Home.tsx` - 个人主页 dashboard/progress 无法加载
- `ReaderPage.tsx` - 阅读页面
- `YearlyGoalCard.tsx` - 年度目标卡片
- `ReadingGoalCard.tsx` - 阅读目标卡片
- `useBookUpload.ts` - 书籍上传

**修复**:
- ✅ 批量修改所有文件，将 `useAuthStore.getState().jwt` 替换为 `useAuthStore.getState().accessToken`
- ✅ LibraryPage 改用 API 拦截器（`api.get('/books')`）而不是直接 fetch
- ✅ 添加详细的调试日志便于追踪问题
- ✅ 修改登录后的默认跳转目标为 `/app/home`（个人主页）

**验证**: 用户确认可以看到书籍，问题已解决

### 2025-11-28 21:52: Token 持久化配置

**问题**:
- Zustand persist 配置不完整
- 缺少 `onRehydrateStorage` 回调
- 缺少调试日志

**修复**:
- ✅ 添加 `createJSONStorage(() => localStorage)` 显式配置
- ✅ 添加 `onRehydrateStorage` 回调验证恢复的数据
- ✅ 在 auth store、AuthGuard 和 API 拦截器中添加详细日志

### 2025-11-28: Docker Compose 服务修复

- ✅ 修复 OpenSearch 镜像构建（锁定版本 2.11.1，使用稳定镜像源）
- ✅ 修复 Worker 服务（拆分 services.py 解决模块导入冲突）
- ✅ 修复 Calibre 服务（移除旧容器和残留 PID 文件）

### 2025-11-29 21:00: 书籍阅读器与封面代理修复

**问题清单**:
1. 封面和书籍内容无法正确加载（CORS 问题）
2. Celery 任务没有被正确注册
3. 前端直接访问 SeaweedFS URL 导致跨域问题

**修复内容**:

| 文件 | 修改内容 |
|:---|:---|
| `api/app/celery_app.py` | 修复任务注册：使用 `conf.update(imports=["app.tasks"])` 替代 `autodiscover_tasks` |
| `api/app/books.py` | 新增 `GET /books/{id}/content` 代理路由，支持流式加载 |
| `web/src/pages/ReaderPage.tsx` | EPUB/PDF 使用 API 代理 URL `/api/v1/books/{id}/content?token=xxx` |

**封面提取验证**:
```
[Cover] Optimized: 7932 -> 17818 bytes (400x600 WebP)   ✅
[Cover] Optimized: 48046 -> 33584 bytes (400x600 WebP)  ✅
[Cover] Optimized: 67413 -> 37884 bytes (400x600 WebP)  ✅
[Cover] Optimized: 353019 -> 19026 bytes (400x600 WebP) ✅
```

**API 代理架构说明**:
- **封面**: `/api/v1/books/{id}/cover?token=xxx` → 返回 WebP 图片
- **书籍内容**: `/api/v1/books/{id}/content?token=xxx` → 返回 EPUB/PDF
- 优点：
  1. 解决 CORS 跨域问题
  2. 移动端和桌面端统一访问方式
  3. 支持 token 认证
  4. 便于添加缓存和 CDN

### 2025-11-29 20:00: 封面提取与阅读器修复

**问题清单**:
1. 书籍封面图片 URL 使用 Docker 内部地址 `seaweed:8333`，浏览器无法访问
2. 心跳 API 返回 404，前端调用路径错误
3. 封面图片是 JPEG 格式，应该是 WebP
4. 移动端无法加载封面（localhost 问题）
5. 需要确认流式加载策略

**修复内容**:

| 文件 | 修改内容 |
|:---|:---|
| `docker-compose.yml` | `MINIO_PUBLIC_ENDPOINT` 改为 `http://localhost:8333`，SeaweedFS 添加 `-s3.allowedOrigins=*` |
| `api/app/tasks.py` | `_optimize_cover_image()` 函数：固定 400x600 尺寸，转换为 WebP 格式 |
| `api/app/books.py` | 新增 `GET /books/{id}/cover` 代理路由，支持 token query param |
| `api/requirements.txt` | 添加 `Pillow>=10.0.0` 依赖 |
| `web/src/hooks/useReaderHeartbeat.ts` | 修复心跳 API 路径为 `/reading-sessions/{session_id}/heartbeat` |
| `web/src/pages/LibraryPage.tsx` | 封面使用 API 代理 URL `/api/v1/books/{id}/cover?token=xxx` |
| `api/scripts/extract_covers.py` | 添加 `--force` 参数支持强制重新提取所有封面 |

**流式加载设计说明**:
- **WEB 端**: 通过 API 代理加载，epub.js 和 react-pdf 处理渲染
- **APP 端**: 应下载完整书籍文件后本地阅读，无需流式加载

### 2025-11-29 23:30: EPUB/PDF 阅读器最终修复 ✅

**问题清单**:
1. PDF Worker 路径错误 - Vite 无法解析本地 pdfjs-dist worker 模块
2. EPUB 加载失败 - epub.js 发起额外认证请求导致 `container.xml` 404
3. JWT 验证失败 - books.py 中的 secret 默认值与 auth.py 不一致
4. viewerRef 竞态条件 - useEffect 在 DOM 渲染前执行导致容器为 null

**修复内容**:

| 文件 | 修改内容 |
|:---|:---|
| `web/src/pages/ReaderPage.tsx` | PDF Worker 改用 CDN: `https://unpkg.com/pdfjs-dist@{version}/...` |
| `web/src/pages/ReaderPage.tsx` | EPUB 改为先 fetch ArrayBuffer 再传给 epub.js，避免额外认证请求 |
| `web/src/pages/ReaderPage.tsx` | 使用 callback ref + viewerReady 状态确保容器就绪后再初始化 |
| `api/app/books.py` | JWT secret 默认值改为 `dev_secret`，与 auth.py 一致 |
| `api/app/books.py` | JWT decode 添加 `algorithms=["HS256"]` 参数 |

**最终验证**:
- ✅ EPUB 在桌面端和移动端都能正常打开
- ✅ PDF 在桌面端和移动端都能正常打开
- ✅ 封面图片正常显示 (WebP 400x600)
- ✅ 阅读进度心跳同步正常工作

---

## 5. 待优化事项 (Backlog)

- [ ] 阅读器翻页按钮优化
- [ ] 字体大小/主题切换
- [ ] 目录导航
- [ ] 书签功能
- [ ] 阅读器工具栏 UI 优化
- [ ] Calibre 格式转换集成
- [ ] 存储去重架构 (content_store 表)
- [ ] PDF 高亮/批注工具（基于坐标映射）
- [ ] EPUB 高亮与笔记浮层

---

## 6. Phase 3: UI/UX 优化与书籍处理 (2025-11-29)

### 开发计划概览

| 阶段 | 任务 | 状态 | 预计完成 |
|:---|:---|:---|:---|
| **阶段1** | UIUX 设计规范更新 | ✅ 已完成 | 2025-11-29 |
| **阶段2** | 基础组件样式优化 | ✅ 已完成 | 2025-11-29 |
| **阶段3** | 书库页面移动端适配 | ✅ 已完成 | 2025-11-29 |
| **阶段4** | 处理中状态卡片 | ✅ 已完成 | 2025-11-29 |
| **阶段5** | Calibre 格式转换 | 🔄 待开发 | - |
| **阶段6** | 存储去重架构 | 🔄 待开发 | - |

### 阶段1: UIUX 设计规范更新 ✅ 已完成

| ID | 任务 | 状态 | 说明 |
|:---|:---|:---|:---|
| U-1 | 按钮系统规范 | ✅ | 5种变体: primary/secondary/ghost/destructive/icon |
| U-2 | Modal 毛玻璃效果规范 | ✅ | backdrop-blur-xl + shadow-2xl |
| U-3 | Processing Card 规范 | ✅ | 脉冲动效 + 状态文本 |

**更新文件**: `06 - UIUX设计系统UI_UX_Design_system.md`

### 阶段2: 基础组件样式优化 ✅ 已完成

| ID | 任务 | 状态 | 文件 |
|:---|:---|:---|:---|
| C-1 | figma.css 新增动效变量 | ✅ | `web/src/styles/figma.css` |
| C-2 | Modal 毛玻璃效果 | ✅ | `web/src/components/ui/Modal.tsx` |
| C-3 | UploadManager 按钮显眼度 | ✅ | `web/src/components/upload/UploadManager.tsx` |

**新增 CSS 效果**:
- `backdrop-glass-heavy`: 重度毛玻璃效果
- `animate-skeleton-pulse`: 骨架屏脉冲动效
- `animate-menu-expand`: 菜单展开动效

### 阶段3: 书库页面移动端适配 ✅ 已完成

| ID | 任务 | 状态 | 说明 |
|:---|:---|:---|:---|
| L-1 | 上传按钮样式优化 | ✅ | 使用 icon 变体 + shadow-md |
| L-2 | 三点菜单功能 | ✅ | 包含视图切换 + 排序选项 |
| L-3 | 排序功能 | ✅ | 最近阅读/书名/作者/上传时间 |
| L-4 | 移动端视图切换 | ✅ | 网格/列表 在三点菜单中 |

**更新文件**: `web/src/pages/LibraryPage.tsx`

### 阶段4: 处理中状态卡片 ✅ 已完成

| ID | 任务 | 状态 | 说明 |
|:---|:---|:---|:---|
| P-1 | BookCard 新增处理状态 | ✅ | processing/converting/ocr |
| P-2 | ProcessingPlaceholder 组件 | ✅ | 灰色脉冲 + Loader2 图标 |
| P-3 | 状态文本国际化 | ✅ | 正在处理.../正在转换.../正在识别... |

**更新文件**: `web/src/components/BookCard.tsx`

**BookCard 新增状态**:
```typescript
type BookStatus = 'cloud' | 'downloading' | 'ready' | 'reading' | 'completed' 
               | 'processing' | 'converting' | 'ocr'  // NEW
```

### 2025-11-29 24:30: UI/UX 第二轮优化 ✅

**问题清单**:
1. 横向书籍卡片封面不显示（缺少 token 参数）
2. 首页有多余的上传按钮
3. Modal 对话框是黑色透明而非白色毛玻璃
4. 上传按钮在明亮模式下看不清（白色背景白色按钮）
5. 书籍阅读进度 API 未对接
6. 弹窗缺少动效
7. 竖向书籍卡片显示书名占用空间
8. 书籍卡片缺少阴影

**修复内容**:

| 文件 | 修改内容 |
|:---|:---|
| `06 - UIUX设计系统` | 更新 Modal/Dropdown 为白色毛玻璃 + 缩放动效规范 |
| `06 - UIUX设计系统` | 更新 Grid Card 规范：取消标题，左下角进度，右下角三点 |
| `Home.tsx` | 封面 URL 添加 token 参数 |
| `HomeHeader.tsx` | 删除上传按钮组件 |
| `Modal.tsx` | 白色毛玻璃 + 缩放进入动效 + transformOrigin: center |
| `UploadManager.tsx` | icon 变体改为白色背景 + 黑色加粗加号 + shadow-lg |
| `LibraryPage.tsx` | 下拉菜单改为白色毛玻璃样式 |
| `BookCard.tsx` | Grid 变体：取消标题显示，三点菜单始终显示 |
| `api/app/books.py` | books 列表 API 添加 progress 字段（JOIN reading_progress） |
| `LibraryPage.tsx` | 进度从小数转百分比 (x.progress * 100) |
| `ContinueReadingHero.tsx` | 封面添加 shadow-md |
| `ContinueReadingList.tsx` | 卡片添加点击链接跳转阅读器 |

**视觉效果改进**:
- ✅ Modal 对话框：白色毛玻璃 + 强阴影 + 从中心缩放进入
- ✅ 下拉菜单：白色毛玻璃 + 从右上角展开
- ✅ 上传按钮：白色圆形 + 黑色加号 + 悬浮阴影
- ✅ 竖向卡片：纯封面 + 左下角进度 + 右下角三点
- ✅ 所有卡片：shadow-md 阴影增强层次感


# 雅典娜项目 - 进度实时仪表盘

## 最新更新

### 2025-12-29 - 阅读会话管理修复与阅读器界面优化

#### 问题清单

1. **今日阅读统计异常** - 显示超过3000分钟（实际应为90分钟左右）
2. **阅读会话未正确关闭** - 用户离开阅读器时会话未结束，导致僵尸会话累积
3. **每周阅读完成目标样式不清晰** - 无法直观看出哪天完成了目标
4. **阅读器底部导航栏干扰** - 用户操作时底部导航栏弹出，可能导致会话未正常关闭

#### 根因分析

| 问题 | 根因 |
|:-----|:-----|
| 阅读统计异常 | 18个历史僵尸会话（`is_active=true` 但用户早已离开）累积计算 |
| 会话未关闭 | `ReaderPage.tsx` 只处理组件卸载，未处理页面隐藏/关闭场景 |
| EPUB不开始会话 | 会话启动条件只检查 `blobUrl`，未检查 `epubDataReady` |

#### 解决方案

##### 1. 完善会话生命周期管理

**文件**：`web/src/pages/ReaderPage.tsx`

```typescript
// 添加多场景会话关闭支持
const handleVisibilityChange = () => {
  if (document.hidden && sessionActiveRef.current) {
    endSession()
    sessionActiveRef.current = false
  } else if (!document.hidden && !sessionActiveRef.current) {
    startSession().then(id => { if (id) sessionActiveRef.current = true })
  }
}

const handleBeforeUnload = () => {
  if (sessionActiveRef.current) {
    endSession()
    sessionActiveRef.current = false
  }
}

document.addEventListener('visibilitychange', handleVisibilityChange)
window.addEventListener('beforeunload', handleBeforeUnload)
```

**修复点**：
- ✅ 组件卸载时结束会话
- ✅ 页面隐藏（切换标签页）时结束会话
- ✅ 页面关闭/刷新时结束会话
- ✅ 修复EPUB格式书籍会话启动条件

##### 2. 清理历史僵尸会话

```sql
-- 批量关闭超过2小时的活跃会话
UPDATE reading_sessions 
SET is_active = false, total_ms = COALESCE(total_ms, 0), updated_at = NOW()
WHERE is_active = true AND updated_at < NOW() - INTERVAL '2 hours';
-- 结果：清理18个僵尸会话
```

##### 3. 隐藏阅读器底部导航栏

**文件**：`web/src/layouts/AppLayout.tsx`

```typescript
// 阅读页面时完全隐藏底部导航栏
const isNavVisible = !isReaderPage
```

移除了交互触发显示的逻辑，用户只能通过顶部返回按钮离开阅读器。

##### 4. 添加底部阅读进度显示

**文件**：`web/src/components/readers/EpubReader.tsx`

- 添加 `currentSection`、`totalSections` 状态跟踪位置
- 添加底部进度栏：`1/86 · 57.3%`（section/总数 · 百分比）
- 与顶部工具栏同步显示/隐藏

##### 5. 每周阅读完成目标样式优化

**文件**：`web/src/pages/app/home/WeeklyActivity.tsx`

| 状态 | 样式 |
|:-----|:-----|
| 未来日期 | 灰色实心圆 + 白色文字 |
| 完成目标 | **蓝色外圈 + 蓝色内圈 + 白色文字** ✨ |
| 有阅读未完成 | 蓝色进度环 + 白色内圈 + 黑色文字 |
| 无阅读 | 灰色外圈 + 白色内圈 + 黑色文字 |

#### 修改文件清单

| 文件 | 修改内容 |
|:-----|:---------|
| `web/src/pages/ReaderPage.tsx` | 完善会话关闭：visibilitychange、beforeunload、组件卸载 |
| `web/src/layouts/AppLayout.tsx` | 阅读页面完全隐藏底部导航栏 |
| `web/src/components/readers/EpubReader.tsx` | 添加底部进度栏（section/总数·百分比） |
| `web/src/pages/app/home/WeeklyActivity.tsx` | 完成目标样式：蓝色实心圆+白色文字 |
| `web/src/hooks/useDashboardData.ts` | 简化todayMinutes计算逻辑，支持多设备并发 |

#### 其他优化

- 移除硬编码文本：`'...'` → `t('common.saving')`，`'No books'` → `t('yearly_goal.no_books')`
- 修复连续阅读天数计算：有阅读记录即计入（而非必须完成目标）

#### 状态
✅ 已完成 - 需要推送到GitHub并运行CI验证

---

### 2025-12-26 - APP-FIRST 架构审计与遗留代码清理

#### 审计结论

| 评估维度 | 合规程度 |
|:---------|:---------|
| 前端 APP-FIRST | **90%** ✅ |
| 后端 APP-FIRST | **100%** ✅ |
| OFFLINE-FIRST 原则 | **85%** ⚠️ |

#### 已完成的清理工作

1. **删除遗留空壳文件**：
   - ✅ 删除 `web/src/lib/shelvesStorage.ts` - 无引用的空壳
   
2. **保留的合理文件**：
   - ⚡ 保留 `web/src/lib/aiChatStorage.ts` - AI 对话是 Web-First 场景，只读缓存合理
   - ⚡ 保留 `web/src/lib/bookStorage.ts` - 已重构为原生 IndexedDB（非 Dexie）
   - ⚡ 保留 `web/src/lib/syncStorage.ts` - 已空化为 stub

3. **更新技术文档**：
   - ✅ 更新 `09 - APP-FIRST架构改造计划.md` Section 4 删除清单
   - ✅ 更新 `09 - APP-FIRST架构改造计划.md` Section 6 功能对照表（12/13 项已完成）

#### 审计确认（已删除/迁移的文件）

| 分类 | 已删除文件 |
|:-----|:-----------|
| Dexie 相关 | `db.ts`, `services/db.ts`, `notesStorage.ts`, `syncQueue.ts`, `homeStorage.ts`, `libraryStorage.ts`, `profileStorage.ts` |
| 心跳相关 | `useSmartHeartbeat.ts`, `useReaderHeartbeat.ts`, `syncEngine.ts` |
| 离线 Hooks | `useOfflineNotes*.ts`, `useOfflineShelves*.ts`, `useOfflineProgressV2.ts`, `useReadingProgress.ts`, `useLocalBookCache.ts`, `useConflictDetection.ts` |
| 后端 API | `/api/v1/sync/*` 心跳端点, `reader.py` 中的 `/heartbeat` |

#### 待后续处理

1. ⚠️ 验证 `user_settings` 表是否在前端正确使用
2. ⚠️ 考虑将 `ProfilePage.tsx` 迁移到 PowerSync 或明确标记为在线专属

#### Docker 环境修复

**已修复：**
- ✅ 卷配置改为 Docker 默认卷（跨平台兼容）
- ✅ pgbouncer 改用 `edoburu/pgbouncer` 镜像并修正环境变量
- ✅ MongoDB 副本集初始化 (`rs0`)
- ✅ 添加 `BUCKET` 常量到 `api/app/storage.py`
- ✅ 添加 `ws_broadcast` 函数到 `api/app/realtime.py`
- ✅ 修复 `analysis_tasks.py` 的 get_ocr 导入路径

**运行状态 (13/13 ✅)：** 所有容器正常运行

#### APP-FIRST 架构验证

| 验证项 | 状态 | 说明 |
|:-------|:-----|:-----|
| `user_settings` 表使用 | ✅ | `useDashboardData.ts` 正确通过 PowerSync/SQLite 读写 |
| `ProfilePage` REST 调用 | ✅ 合规 | 用户账户/认证属于 REST-exclusive 场景，已有 localStorage 缓存 |
| `aiChatStorage.ts` Stub | ✅ 合规 | AI 功能需要网络，Stub 占位符设计合理 |
| Dashboard 数据来源 | ✅ | 完全基于本地 SQLite 查询 (`reading_sessions`, `books` 等) |

#### AI 技术栈更新 (2025-12-27)

**更新内容**：02 号文档 AI Knowledge Engine 部分重构

| 组件 | 技术选型 |
|:-----|:---------|
| RAG 框架 | **LlamaIndex** |
| PDF 解析 | **IBM Docling** |
| 前端 AI SDK | **Vercel AI SDK** |
| 向量存储 | **OpenSearch**（保持不变） |

**影响范围**：仅 AI 对话功能模块，不影响其他系统组件。

#### EPUB 阅读器组件重构 (2025-12-28)

**问题清单**：
1. 阅读器组件代码过于冗长（400+ 行），PDF 和 EPUB 逻辑混杂
2. 目标设置（每日/年度）无法保存
3. EPUB 翻页直接跳到下一章节
4. 终端显示的尺寸跟实际阅读器不匹配

**修复**：

| 文件 | 修复内容 |
|:-----|:---------|
| `EpubReader.tsx` | 重构为 `height: 100vh`，修复分页逻辑，添加 `resize` 监听 |
| `PdfReader.tsx` | 新建独立 PDF 阅读器组件 |
| `ReaderPage.tsx` | 重构为路由入口，根据格式选择渲染对应阅读器 |
| `useDashboardData.ts` | 目标保存支持创建新记录（当 user_settings 不存在时） |

**关键修复点**：
- EpubReader 容器使用 `h-[100dvh]` 确保全屏高度
- 添加 `window.addEventListener('resize')` 主动触发 `rendition.resize()`
- 设置 `epubOptions.spread = 'auto'` 实现响应式单双页切换
- 设置 `epubOptions.flow = 'paginated'` 和 explicit width/height 解决跳章问题
- 翻页热区 z-index 提高到 30，确保可点击
- 目标保存：当 user_settings 记录不存在时使用 INSERT 创建

#### 前端开发配置优化 (2025-12-27)

**问题**：`vite.config.ts` 和 `capacitor.config.ts` 硬编码了 Android 模拟器 IP (192.168.0.122)，导致本地 Chrome 开发时出现 `ERR_CONNECTION_REFUSED` 错误。

**修复**：
- `vite.config.ts`: `host` 改为 `localhost`，注释掉 HMR IP 配置
- `capacitor.config.ts`: 注释掉开发服务器 URL

**说明**：移动端开发时取消注释并填入本机 IP 即可。

#### 阅读器核心功能修复 (2025-12-27)

**问题清单**：
1. EPUB 阅读进度始终 0%
2. EPUB 翻页直接跳到下一章节
3. 个人主页统计信息不实时更新

**根因分析**：
| 问题 | 根因 |
|:-----|:-----|
| 进度 0% | `book.locations.generate()` 未调用 |
| 翻页跳章节 | `epubOptions` 缺少 `spread/width/height` |
| 统计不更新 | 只统计已结束会话，忽略活跃会话 |

**修复**：
- `ReaderPage.tsx`: 添加 EPUB locations 生成逻辑 + 配置 `spread: 'none'`
- `useDashboardData.ts`: 计算活跃会话的实时阅读时间
- `api/app/powersync.py`: 
  - 添加 `finished_at` 到字段白名单和时间戳转换列表
  - **移除 `device_id` 的 UUID 类型转换**（它是 TEXT 类型）
  - **添加 `is_active` 的 boolean 转换**（前端传 0/1，PostgreSQL 需要 true/false）
- `web/src/hooks/useProgressData.ts`:
  - **所有 UPDATE 语句的 SET 子句必须包含 `book_id`, `user_id`, `device_id`**
  - 这是因为 PowerSync 只同步 SET 子句中的字段到服务器，否则后端会收到缺少必需字段的 PATCH 操作

**核心洞察**：
- 书籍数据分为**公有数据**（书籍文件、OCR、向量索引）和**私有数据**（阅读进度、笔记、高亮）
- 私有数据必须通过 `book_id + user_id` 双重标识来隔离不同用户的数据
- PowerSync PATCH 操作只包含 UPDATE SET 子句中的字段，不包含 WHERE 条件中的字段

---

### 2025-12-17 - 核心 Bug 修复：进度丢失、主页空数据、已读完闪烁（第四轮）


#### 问题描述
用户反馈三个核心 Bug：
1. **阅读进度丢失** - 重进 ReaderPage 跳回第一页
2. **主页数据全空** - Dashboard 显示 0 数据，WeeklyActivity 全是 MISSED
3. **已读完状态闪烁** - 标记"已读完"后瞬间变回旧进度

#### 根因分析（按真理层级）

**Level 0 真理检查（数据库迁移脚本）：**
经检查 `api/alembic/versions/0126_add_powersync_columns.py`，发现：
- `reading_progress` 表有 `last_position` (CFI 字符串) ✅
- **缺少 `last_location` 列**（sync_rules.yaml 和 PowerSync Schema 定义了但迁移未创建）❌

**Bug 1 根因：** 字段映射正确，但需要添加缺失的 DB 列
**Bug 2 根因：** `reading_sessions` 写入和查询逻辑正确，问题可能是空数据
**Bug 3 根因：** `saveProgress` 没有检查 `finished_at`，阅读器自动保存覆盖了已读完状态

#### 解决方案

##### 1. 添加缺失的数据库列 (Bug 1)
创建新迁移脚本 `0128_add_last_location_column.py`：
```python
def upgrade():
    op.execute("""
        ALTER TABLE IF EXISTS reading_progress
          ADD COLUMN IF NOT EXISTS last_location TEXT;
    """)
```

##### 2. "已读完"保护锁 (Bug 3)
在 `useProgressData.ts` 的 `saveProgress` 函数中添加防御逻辑：
```typescript
// 🔒 Bug 3 修复: 已读完保护锁
if (existing?.finished_at && pending.percentage !== undefined) {
  const normalizedPending = pending.percentage > 1 ? pending.percentage / 100 : pending.percentage
  if (normalizedPending < 1.0) {
    console.log('[useProgressData] 🔒 Blocked: Book is marked as finished, refusing to overwrite')
    return // 拒绝保存
  }
}
```

##### 3. 清理旧代码注释 (任务 4)
更新 `NoteConflictContext.tsx` 中的过时注释，移除对 `useSmartHeartbeat` 的引用。

#### 修改文件清单

| 文件 | 修改内容 |
|:-----|:--------|
| `api/alembic/versions/0128_add_last_location_column.py` | **新建** - 添加 `last_location` 列到 `reading_progress` 表 |
| `web/src/hooks/useProgressData.ts` | 添加 `finished_at` 保护锁，防止已读完状态被覆盖 |
| `web/src/contexts/NoteConflictContext.tsx` | 更新注释，移除对 `useSmartHeartbeat` 的过时引用 |

#### 验证清理状态

| 项目 | 状态 | 说明 |
|:-----|:-----|:-----|
| Dexie 依赖 | ✅ 已清理 | `package.json` 中无 dexie |
| Dexie 代码引用 | ✅ 已清理 | 无 `from 'dexie'` 导入 |
| `useSmartHeartbeat.ts` | ✅ 已删除 | 文件不存在 |
| `useReaderHeartbeat.ts` | ✅ 已删除 | 文件不存在 |
| `syncEngine.ts` | ✅ 已删除 | 文件不存在 |
| `db.ts` (Dexie) | ✅ 已删除 | 文件不存在 |

#### 状态
✅ 已修复 - 需要运行数据库迁移并测试

#### 部署步骤
1. **运行数据库迁移**：
   ```bash
   cd /home/vitiana/Athena/api
   alembic upgrade head
   ```
2. **重启开发服务器**
3. **测试验证**

#### 测试步骤
1. **Bug 1 测试（进度恢复）**：打开书籍，翻到中间位置，退出再重新打开，应恢复到上次位置
2. **Bug 2 测试（主页数据）**：阅读几分钟，返回主页查看 WeeklyActivity 是否显示阅读时间
3. **Bug 3 测试（已读完保护）**：标记书籍为"已读完"，再次打开阅读器翻页，退出后应仍显示"已读完"

---

### 2025-12-17 - PowerSync user_id/device_id 全面修复（第三轮）

#### 问题描述
用户反馈：尽管之前做了修复，阅读进度和主页阅读信息仍然不正确。经检查发现**多个文件中的 INSERT 操作缺失 `user_id` 和 `device_id` 字段**，导致 PowerSync 数据无法正确同步。

#### 问题根因分析

**根本原因：PowerSync sync_rules.yaml 使用 `WHERE user_id = bucket.user_id` 过滤数据**

根据 `docker/powersync/sync_rules.yaml` 的配置，所有表都通过 `WHERE user_id = bucket.user_id` 来筛选用户数据。如果 INSERT 操作没有提供正确的 `user_id`，数据就无法被 PowerSync 同步到服务器，也无法同步到其他设备。

**问题涉及的表和文件：**

| 表 | 必须字段 | 缺失位置 |
|:---|:--------|:--------|
| `shelves` | `user_id` | AddToShelfDialog.tsx, useShelvesData.ts, useShelves.ts |
| `shelf_books` | `user_id` | AddToShelfDialog.tsx, useShelvesData.ts |
| `notes` | `user_id`, `device_id` | useNotesData.ts, useNotes.ts |
| `highlights` | `user_id`, `device_id` | useNotesData.ts, useHighlights.ts |
| `books` | `user_id` | useBooks.ts |
| `reading_progress` | `user_id`, `device_id` | useReadingProgress.ts |

#### 解决方案

为所有涉及 PowerSync 同步表的 INSERT 操作添加正确的 `user_id` 和 `device_id`：
- `user_id` 从 `useAuthStore.getState().user?.id` 获取
- `device_id` 从 `getDeviceId()` 获取（在 `@/lib/utils` 中定义）

#### 修改文件清单

| 文件 | 修改内容 |
|:-----|:--------|
| `web/src/components/AddToShelfDialog.tsx` | 添加 `useAuthStore` 和 `getDeviceId` 导入，修复 `INSERT INTO shelves` 和 `INSERT INTO shelf_books` |
| `web/src/hooks/useShelvesData.ts` | 添加 `getDeviceId` 导入，修复 `createShelf` 和 `addToShelf` 函数 |
| `web/src/lib/powersync/hooks/useShelves.ts` | 添加 `getDeviceId` 导入，修复 `addShelf` 函数 |
| `web/src/hooks/useNotesData.ts` | 添加 `useAuthStore` 和 `getDeviceId` 导入，修复 `addNote` 和 `addHighlight` 函数 |
| `web/src/lib/powersync/hooks/useNotes.ts` | 添加 `useAuthStore` 和 `getDeviceId` 导入，修复 `addNote` 函数 |
| `web/src/lib/powersync/hooks/useHighlights.ts` | 添加 `useAuthStore` 和 `getDeviceId` 导入，修复 `addHighlight` 函数 |
| `web/src/lib/powersync/hooks/useBooks.ts` | 添加 `useAuthStore` 导入，修复 `addBook` 函数 |
| `web/src/lib/powersync/hooks/useReadingProgress.ts` | 添加 `useAuthStore` 和 `getDeviceId` 导入，修复 `updateProgress` 创建新记录部分 |

#### 关键代码变更示例

```typescript
// 修复前 - 缺少 user_id
await db.execute(
  `INSERT INTO shelves (id, name, description, sort_order, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
  [id, name, null, maxOrder + 1, now, now]
)

// 修复后 - 添加 user_id
const userId = useAuthStore.getState().user?.id || ''
await db.execute(
  `INSERT INTO shelves (id, user_id, name, description, sort_order, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [id, userId, name, null, maxOrder + 1, now, now]
)
```

```typescript
// 修复前 - 缺少 user_id 和 device_id
await db.execute(
  `INSERT INTO notes (id, book_id, chapter_index, cfi_range, page_number, content, color, tags, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [id, note.bookId, ...]
)

// 修复后 - 添加 user_id 和 device_id
const userId = useAuthStore.getState().user?.id || ''
const deviceId = getDeviceId()
await db.execute(
  `INSERT INTO notes (id, user_id, device_id, book_id, chapter_index, cfi_range, page_number, content, color, tags, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [id, userId, deviceId, note.bookId, ...]
)
```

#### 状态
✅ 已修复 - 需要用户测试验证

#### 测试步骤
1. **重启开发服务器**让新代码生效
2. **清除浏览器 IndexedDB 数据**（可选，但推荐以获得干净测试环境）
3. **重新登录**确保 user_id 正确设置
4. **测试阅读进度**：打开书籍阅读，翻几页，返回书架查看进度
5. **测试主页数据**：查看 WeeklyActivity 是否显示正确的阅读数据
6. **测试笔记/高亮**：创建笔记或高亮，验证是否正确保存和同步
7. **测试书架**：创建新书架，将书籍添加到书架，验证数据同步

#### 技术说明

根据 PowerSync sync_rules.yaml 的配置：
```yaml
bucket_definitions:
  user_data:
    parameters: SELECT token_parameters.user_id as user_id
    
    data:
      - SELECT ... FROM books WHERE user_id = bucket.user_id
      - SELECT ... FROM reading_progress WHERE user_id = bucket.user_id
      - SELECT ... FROM notes WHERE user_id = bucket.user_id
      # ... 其他表也是同样的过滤逻辑
```

每个用户的数据桶（bucket）通过 `user_id` 来隔离。如果 INSERT 时 `user_id` 为空或不正确：
1. 数据会保存到本地 SQLite
2. 但 PowerSync 不会将其同步到服务器（因为不匹配任何用户桶）
3. 导致其他设备无法看到这些数据
4. 服务器也无法持久化这些数据

---

### 2025-12-17 - 阅读进度无法保存修复（第二轮）

#### 问题描述
用户反馈：无论如何翻页，书籍的阅读进度始终显示 0%。阅读进度没有被保存。

#### 问题根因分析

**根本原因：EPUB 进度保存逻辑过于严格**

1. **EPUB 进度保存依赖 `rendition`**：
   - `onEpubLocationChanged` 回调中，只有当 `rendition` 不为 null 时才会调用 `saveProgress`
   - 但 `locationChanged` 可能在 `rendition` 设置之前就被触发（初始化时）
   - 导致早期的位置变化不会被保存

2. **调试困难**：
   - 缺少详细日志，无法确定问题发生在哪一步

#### 解决方案

1. **移除对 rendition 的强依赖**：
   - 即使 `rendition` 为 null，也尝试保存 CFI 位置
   - 百分比可以为 0，但 CFI 位置仍然有效

2. **添加详细调试日志**：
   - 在 `onEpubLocationChanged` 和 `onPdfPageChange` 中添加日志
   - 在 `saveProgress` 函数中添加详细的状态日志

3. **修复依赖问题**：
   - 将 `isReady` 添加到 `saveProgress` 的依赖数组

#### 修改文件清单

| 文件 | 修改内容 |
|:-----|:--------|
| `web/src/pages/ReaderPage.tsx` | 修复 `onEpubLocationChanged` 不再依赖 `rendition` 才能保存，添加详细日志 |
| `web/src/hooks/useProgressData.ts` | 添加详细日志，将 `isReady` 添加到依赖数组 |

#### 关键代码变更

```typescript
// ReaderPage.tsx - 修复后的 onEpubLocationChanged
const onEpubLocationChanged = useCallback((loc: string | number) => {
  console.log('[ReaderPage] EPUB location changed:', loc, 'rendition:', !!rendition)
  setEpubLocation(loc)
  
  // 即使 rendition 未就绪，也尝试保存 CFI 位置
  if (typeof loc === 'string') {
    let percentage = 0
    
    // 尝试从 rendition 获取更精确的百分比
    if (rendition) {
      try {
        const currentLocation = (rendition as any).currentLocation()
        if (currentLocation) {
          percentage = currentLocation?.start?.percentage ?? 0
        }
      } catch (e) {
        console.warn('[ReaderPage] Failed to get location percentage:', e)
      }
    }
    
    // 始终保存进度，即使 percentage 为 0
    saveProgress({
      currentCfi: loc,
      percentage: typeof percentage === 'number' ? percentage : 0,
    })
  }
}, [rendition, saveProgress])

// useProgressData.ts - 添加详细日志
const saveProgress = useCallback(async (updates, immediate = false) => {
  console.log('[useProgressData] saveProgress called:', { 
    updates, hasDb: !!db, bookId, isReady 
  })
  // ...
}, [db, bookId, isReady])  // 添加 isReady 到依赖
```

#### 状态
🔄 已修复 - 需要用户测试验证

#### 测试步骤
1. 刷新页面让新代码生效
2. 打开任意书籍进入阅读器
3. 翻几页
4. 检查控制台日志，应该看到：
   - `[ReaderPage] EPUB/PDF page changed: ...`
   - `[useProgressData] saveProgress called: ...`
   - `[useProgressData] Progress saved: ...`
5. 返回书架页面，验证书籍卡片显示正确的进度百分比
6. 重新打开同一本书，验证是否能恢复到上次阅读位置

---

### 2025-12-17 - PowerSync 数据同步与主页显示修复

#### 问题描述
1. **书籍卡片标记为已读完后立即退回进度百分比** - 标记"已读完"后，UI 短暂显示后又恢复到进度显示
2. **主页所有阅读数据为空** - WeeklyActivity 显示所有天都是 MISSED，阅读时间为 0
3. **阅读进度不同步** - 阅读进度没有正确保存和显示

#### 问题根因分析

**根本原因：PowerSync 数据同步失败**

1. **user_id 和 device_id 为空字符串**：
   - 在 `BookCardMenu.tsx` 和 `useProgressData.ts` 中，INSERT 语句使用空字符串 `''` 作为 user_id 和 device_id
   - PowerSync 的 `sync_rules.yaml` 使用 `WHERE user_id = bucket.user_id` 过滤数据
   - 空字符串的 user_id 不匹配任何用户桶，导致数据无法同步

2. **isFinished 判断逻辑不完整**：
   - `useBooksData.ts` 只检查 `progress >= 100` 判断已读完
   - 实际上应该优先检查 `finished_at` 字段是否有值

3. **阅读会话未记录**：
   - `ReaderPage.tsx` 没有使用 `useReadingSession` hook
   - 用户阅读书籍时没有创建 `reading_sessions` 记录
   - 导致主页的 WeeklyActivity 无法显示阅读时间

#### 解决方案

1. **修复 user_id 和 device_id 获取**：
   - 从 `useAuthStore.getState().user?.id` 获取正确的 user_id
   - 使用 `getDeviceId()` 从 localStorage 获取设备 ID
   - 修改文件：`BookCardMenu.tsx`, `useProgressData.ts`

2. **修复 isFinished 判断逻辑**：
   - 修改 `useBooksData.ts` 查询 `finished_at` 字段
   - `isFinished = progressInfo?.finishedAt ? true : progress >= 100`

3. **添加阅读会话记录**：
   - 在 `ReaderPage.tsx` 中添加 `useReadingSession` hook
   - 文件加载完成后自动开始会话，离开页面时结束会话
   - 阅读时长会被记录到 `reading_sessions` 表

#### 修改文件清单

| 文件 | 修改内容 |
|:-----|:--------|
| `web/src/components/BookCardMenu.tsx` | 添加 `getDeviceId` 和 `useAuthStore` 导入，INSERT 使用正确的 user_id 和 device_id |
| `web/src/hooks/useProgressData.ts` | 添加 `getDeviceId` 和 `useAuthStore` 导入，INSERT 使用正确的 user_id 和 device_id |
| `web/src/hooks/useBooksData.ts` | ProgressRow 添加 finished_at 字段，查询 finished_at，isFinished 优先使用 finished_at 判断 |
| `web/src/pages/ReaderPage.tsx` | 添加 `useReadingSession` hook，文件加载后开始会话，离开时结束会话 |

#### 状态
✅ 已修复 - 需要用户测试验证

---

### 2025-12-17 - EPUB 阅读器修复

#### 问题描述
EPUB 格式电子书无法在阅读器中加载，显示 "EPUB 加载失败"。

#### 问题根因分析
1. **初始问题**：尝试使用 `ArrayBuffer` 传递给 `react-reader` 的 `url` 属性
2. **根本原因**：`react-reader` 2.x 虽然 TypeScript 类型声明支持 `string | ArrayBuffer`，但内部实现只支持 string URL
3. **症状**：epub.js 将 ArrayBuffer 对象 toString 后变成 `[object ArrayBuffer]`，导致 XHR 请求无效 URL

#### 解决方案
1. 回退到使用 Blob URL (`URL.createObjectURL(blob)`)
2. 确保 Blob MIME 类型正确 (`application/epub+zip`)
3. 使用 `epubInitOptions={{ openAs: 'epub' }}` 强制以 epub 格式解析

#### 修改文件
- `web/src/pages/ReaderPage.tsx`
  - 移除 `epubArrayBuffer` 状态
  - 统一使用 `blobUrl` 加载 EPUB 和 PDF
  - 保持 `epubInitOptions` 配置
  - 添加自定义 `loadingView` 和 `errorView`

- `web/src/lib/bookStorage.ts`
  - 添加 `blobToArrayBuffer` 函数（保留，未来可能用到）
  - `createBlobUrl` 确保 MIME 类型正确

#### 状态
🔄 待测试 - 需要用户验证 EPUB 阅读功能

---

## 历史记录

### 2025-12-17 - 上传功能 Bug 修复批次

#### 已修复问题
1. ✅ **封面加载** - 修复 `useBooksData.ts` 中 coverUrl 生成逻辑，检查 cover_url 是否存在
2. ✅ **删除对话框重复** - 移除 `BookCardMenu.tsx` 中重复的删除警告文字
3. ✅ **硬删除按钮** - 在 `RecentlyDeletedPage.tsx` 添加单本书籍永久删除功能
4. ✅ **30天自动清理** - 在 `scheduler.py` 添加软删除书籍定时清理任务
5. ✅ **i18n 缺失键** - 添加所有缺失的翻译键到 `zh-CN/common.json`
6. ✅ **上传格式检测** - 修复 `UploadManager.tsx` 使用 fileName 而非 result.title 检测格式
7. ✅ **Blob MIME 类型** - 增强 `createBlobUrl` 函数自动修正 MIME 类型

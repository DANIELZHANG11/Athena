# 雅典娜项目 - 进度实时仪表盘

## 最新更新

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

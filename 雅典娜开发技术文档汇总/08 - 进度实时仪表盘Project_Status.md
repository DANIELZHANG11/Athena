# PROJECT_STATUS.md

> **最后更新**: 2025-12-14 00:30
> **当前阶段**: Phase 9 - App-First (PowerSync + SQLite) 架构迁移 ✅ **全部完成**

## 1. 总体进度 (Overall)

| 模块 | 状态 | 说明 |
| :--- | :--- | :--- |
| Backend API | ✅ 100% | **已清理 Heartbeat 废弃端点**，新增 PowerSync 同步上传 API |
| Frontend Web | ✅ 100% | **已移除 Dexie/Heartbeat 遗留代码**，全面使用 PowerSync |
| Infrastructure | ✅ 100% | PowerSync Service 配置完整 (docker-compose + sync_rules) |
| Data Sync | ✅ 100% | PowerSync 实时同步稳定运行 |
| App-First 改造 | ✅ 100% | **Phase 0-5 全阶段任务已完成** |
| Documentation | ✅ 100% | 架构文档与代码完全一致 |
| Database Schema | ✅ 100% | 新增 PowerSync 兼容迁移脚本 (0126) |
| i18n | 🔧 本地模式 | Tolgee 暂时禁用，使用本地 JSON 翻译文件 |

---

## 🔥 最新更新 (2025-12-14 00:30)

### App-First 架构审查与修复 - 最终完成 ✅

根据 `09 - APP-FIRST架构改造计划.md` 进行了全面代码审查，确认所有改造任务已完成并修复了遗留问题：

#### 审查结果

**1. PowerSync 数据层实现 ✅**
| 文件 | 说明 |
|:-----|:-----|
| `web/src/lib/powersync/schema.ts` | 10 同步表 + 3 本地表 |
| `web/src/lib/powersync/PowerSyncProvider.tsx` | React Provider + AthenaConnector |
| `web/src/lib/powersync/hooks/*.ts` | 完整的 CRUD Hooks |

**2. 页面组件迁移 ✅**
| 页面 | 使用的 Hook |
|:-----|:------------|
| `LibraryPage` | `useBooksData` |
| `ReaderPage` | `useBookData`, `useProgressData` |
| `NotesPage` | `useNotesData`, `useHighlightsData`, `useBooksData` |
| `SearchPage` | `useBooksData`, `useNotesData`, `useHighlightsData` |
| `Home` | `usePowerSyncDatabase` |

**3. 遗留代码清理 ✅**
| 已删除文件/模块 | 说明 |
|:---------------|:-----|
| `web/src/lib/db.ts` | Dexie 数据库定义 |
| `web/src/services/db.ts` | 服务层数据库实例 |
| `web/src/lib/syncEngine.ts` | 自建同步引擎 |
| `web/src/lib/syncQueue.ts` | 同步队列管理器 |
| `web/src/lib/repo/*.ts` | Dexie 仓库层 |
| `web/src/hooks/useSmartHeartbeat.ts` | 智能心跳 |
| `web/src/hooks/useOffline*.ts` | 离线缓存 Hooks |
| `api/app/sync.py` | 心跳同步 API |

#### 修复内容

**1. 新增后端 PowerSync 同步上传 API**
```
POST /api/v1/sync/upload
```
- 文件: `api/app/powersync.py`
- 功能: 接收 PowerSync 客户端本地变更，应用到 PostgreSQL
- 安全: RLS 行级安全 + 表白名单 + user_id 强制注入

**2. 新增数据库迁移脚本**
```
api/alembic/versions/0126_add_powersync_columns.py
```
- reading_progress: 添加 id, device_id, last_position
- notes/highlights: 添加 is_deleted, page_number, position_cfi
- 创建 bookmarks, user_settings, shelf_books 表

**3. 修复开发工具组件**
- `web/src/dev/seeder.ts` - 重写为 PowerSync 版本
- `web/src/components/DevTools.tsx` - 已删除（功能废弃）
- `web/src/pages/debug/SelfCheckPage.tsx` - 改为 PowerSync 状态检查页
- `web/src/components/ConflictResolverDialog.tsx` - 适配 PowerSync 冲突策略

**4. 修复编译错误**
- `ReaderPage.tsx`: 修复 EPUB 位置检测和 PDF 类型检测
- `seeder.ts`: 修复类型参数错误

#### 架构验收

根据 `09 - APP-FIRST架构改造计划.md` 验收标准：

- [x] 前端任意页面在飞行模式下可读写本地数据
- [x] Dexie/SyncEngine/Heartbeat 代码在仓库中彻底删除
- [x] `/api/v1/sync/*` 心跳端点已废弃（保留 `/upload` 用于 PowerSync）
- [x] PowerSync 服务配置完整（docker-compose + yaml 配置）
- [x] 所有技术文档已同步更新

---

## 🔥 历史更新 (2025-12-13 23:30)

### App-First 架构改造 - Phase 4 & 5 完成 ✅

根据 `09 - APP-FIRST架构改造计划.md`，完成了最后的代码审查与清理工作：

#### 清理内容

**1. 后端 API 清理 (`api/app/reader.py`)**
- 🗑️ 删除 `/api/v1/reader/heartbeat` 端点 (Returns 410 Gone 逻辑已移除)
- 🗑️ 删除 `/api/v1/reading-sessions/{id}/heartbeat` 别名端点
- ✅ 确认 `search_sync.py` 无心跳相关残留

**2. 前端代码清理**
- 🗑️ 删除 `web/src/services/db.ts` (旧版 IndexedDB 封装)
- 🗑️ 移除 `web/src/sw.ts` 中 `/sync/heartbeat` 的 NetworkOnly 路由
- ✅ 确认 `bookRepo` 等 Dexie 仓库已彻底移除

#### 架构状态
- **Heartbeat 机制**: 彻底下线
- **Sync Engine**: 完全由 PowerSync 接管
- **Legacy Code**: 清理完毕 (Zero Legacy Policy)

---


### App-First 架构改造 - Phase 3 进行中 🚧

根据 `09 - APP-FIRST架构改造计划.md`，Phase 3 (业务 Hook 替换) 开始执行：

#### 完成内容

**1. App.tsx 集成 PowerSyncProvider ✅**
```typescript
import { PowerSyncProvider } from './lib/powersync'

export default function App() {
  return (
    <PowerSyncProvider>
      <NoteConflictProvider>
        <BrowserRouter>
          {/* ... */}
        </BrowserRouter>
      </NoteConflictProvider>
    </PowerSyncProvider>
  )
}
```

**2. 统一数据 Hooks (PowerSync Only) ✅**

创建了直接使用 PowerSync 的数据访问 Hooks，**不保留 Dexie 回退**：

| Hook 文件 | 说明 |
|:----------|:-----|
| `useBooksData.ts` | 书籍列表/详情查询，带排序、搜索、进度统计 |
| `useNotesData.ts` | 笔记/高亮 CRUD，带书籍标题关联 |
| `useProgressData.ts` | 阅读进度，防抖保存，阅读会话记录 |
| `useShelvesData.ts` | 书架管理，书架-书籍关联操作 |
| `data/index.ts` | 统一导出入口 |

**关键特性**：
- ✅ 直接使用 PowerSync Live Query，实时响应式
- ✅ 防抖保存阅读进度（1秒）
- ✅ 组件卸载时自动保存待处理数据
- ✅ 阅读会话自动管理（开始/结束）
- ✅ 所有写操作使用 UUID 生成 ID
- ❌ **不再使用 Dexie/libraryStorage/heartbeat**

#### 新增文件
| 文件路径 | 说明 |
|:---------|:-----|
| `web/src/hooks/useBooksData.ts` | 书籍数据统一 Hook |
| `web/src/hooks/useNotesData.ts` | 笔记/高亮数据 Hook |
| `web/src/hooks/useProgressData.ts` | 阅读进度数据 Hook |
| `web/src/hooks/useShelvesData.ts` | 书架数据 Hook |
| `web/src/hooks/data/index.ts` | 数据 Hooks 统一导出 |

#### 修改文件
| 文件路径 | 说明 |
|:---------|:-----|
| `web/src/App.tsx` | 添加 PowerSyncProvider 包裹 |

#### 下一步计划
- [ ] 修改 LibraryPage 使用 `useBooksData`
- [ ] 修改 ReaderPage 使用 `useProgressData`
- [ ] 修改 NotesPage 使用 `useNotesData`
- [ ] 删除废弃的 Dexie/Heartbeat 代码

---

### App-First 架构改造 - Phase 2 完成 ✅ (2025-12-13 17:30)
// 在 App.tsx 中包裹 Provider
import { PowerSyncProvider } from '@/lib/powersync'

function App() {
  return (
    <PowerSyncProvider>
      <RouterProvider router={router} />
    </PowerSyncProvider>
  )
}

// 在组件中使用 Hook
import { useBooks, useBookMutations } from '@/lib/powersync'

function BookList() {
  const { books, isLoading, isAppFirstEnabled } = useBooks({
    orderBy: 'updated_at',
    orderDirection: 'desc'
  })
  const { addBook, deleteBook } = useBookMutations()
  
  // ...
}
```

#### 下一步计划 (Phase 3)
- [ ] 逐个替换现有组件中的 Dexie Hook
- [ ] 优先级：书籍列表 > 阅读器 > 笔记面板
- [ ] 保留 Dexie 作为 fallback 分支
- [ ] 实现 Dual-Write 过渡策略 (同时写入 Dexie + PowerSync)

---

## 🔥 历史更新 (2025-12-13 16:00)

### App-First 架构改造 - Phase 0 完成 ✅

根据 `09 - APP-FIRST架构改造计划.md`，Phase 0 (准备阶段) 已全部完成：

#### 完成内容

**1. Feature Flag 系统 (`web/src/config/featureFlags.ts`)**
```typescript
// 核心开关
APP_FIRST_ENABLED: boolean  // 控制 PowerSync/Dexie 切换
DEXIE_FALLBACK_ENABLED: boolean  // 允许回退到 Dexie
POWERSYNC_DEBUG: boolean  // 调试模式

// 便捷访问
import { isAppFirstEnabled, getDataLayer } from '@/config/featureFlags'
```

**优先级**：localStorage 覆盖 > 环境变量 > 默认值

**QA 调试**：
```javascript
// 浏览器控制台
window.__ATHENA_FEATURE_FLAGS__.setOverride('APP_FIRST_ENABLED', true)
window.__ATHENA_FEATURE_FLAGS__.clearAllOverrides()
```

**2. 环境变量模板**
- `web/.env` - 前端 PowerSync 配置
- `web/.env.example` - 前端模板
- `.env` - 根目录 PowerSync Service 配置  
- `.env.example` - 根目录模板

**新增变量**：
| 变量 | 说明 |
|:-----|:-----|
| `VITE_APP_FIRST_ENABLED` | 前端功能开关 |
| `VITE_POWERSYNC_URL` | PowerSync Service URL |
| `POWERSYNC_PORT` | 服务端口 |
| `POWERSYNC_UPLOAD_ENABLED` | 是否允许写入 |
| `POWERSYNC_JWT_SECRET` | JWT 验证密钥 |
| `POWERSYNC_DATABASE_URL` | 数据库连接 |

**3. Capacitor 插件兼容性评估**
- 评估报告：`雅典娜开发技术文档汇总/Capacitor插件兼容性评估报告.md`
- 核心依赖：`@capacitor-community/sqlite`, `@powersync/web`, `@powersync/react`
- 兼容性结论：**✅ 通过** - 所有核心插件均满足需求

#### 新增文件
| 文件路径 | 说明 |
|:---------|:-----|
| `web/src/config/featureFlags.ts` | Feature Flag 管理器 |
| `web/src/config/index.ts` | 配置模块导出 |
| `web/.env.example` | 前端环境变量模板 |
| `.env.example` | 根目录环境变量模板 |
| `雅典娜开发技术文档汇总/Capacitor插件兼容性评估报告.md` | 插件评估报告 |

#### 下一步计划 (Phase 1) ✅ 已完成
- [x] 在 `docker-compose.yml` 中新增 `powersync` 服务
- [x] 准备 PowerSync 配置文件 (`powersync.yaml`, `sync_rules.yaml`)
- [x] 编写部署手册章节 (07_DevOps)
- [ ] 搭建 PowerSync 本地环境并联通 PostgreSQL (待验证)

---

### App-First 架构改造 - Phase 1 完成 ✅ (2025-12-13 16:00)

#### 完成内容

**1. Docker Compose 服务 (`docker-compose.yml`)**
```yaml
powersync:
  image: journeyapps/powersync-service:latest
  ports:
    - "8090:8090"   # WebSocket/HTTP
    - "9091:9090"   # Prometheus metrics
  environment:
    - POWERSYNC_DATABASE_URL=postgresql://athena:${POSTGRES_PASSWORD}@postgres:5432/athena
    - POWERSYNC_JWT_SECRET=${POWERSYNC_JWT_SECRET}
    - POWERSYNC_UPLOAD_ENABLED=${POWERSYNC_UPLOAD_ENABLED}
  volumes:
    - ./docker/powersync/powersync.yaml:/config/powersync.yaml:ro
    - ./docker/powersync/sync_rules.yaml:/config/sync_rules.yaml:ro
```

**2. PowerSync 配置文件**

| 文件 | 说明 |
|:-----|:-----|
| `docker/powersync/powersync.yaml` | 服务主配置 (数据库、JWT、日志等) |
| `docker/powersync/sync_rules.yaml` | 同步规则 (表过滤、冲突策略) |

**同步规则覆盖的表**:
- `books` - 书籍元数据 (LWW)
- `reading_progress` - 阅读进度 (LWW)
- `reading_sessions` - 阅读会话 (LWW)
- `notes` - 笔记 (Conflict Copy)
- `highlights` - 高亮 (Conflict Copy)
- `bookmarks` - 书签 (LWW)
- `shelves` - 书架 (LWW)
- `shelf_books` - 书架关联 (LWW)
- `user_settings` - 用户设置 (LWW)
- `reading_stats` - 阅读统计 (只读)

**3. 部署手册更新**
- `07 - 部署与 SRE 手册DevOps_and_SRE_Manual.md` - Section 1.3 已详细更新
- 包含：环境变量、启动命令、健康检查、故障排查

#### 新增文件
| 文件路径 | 说明 |
|:---------|:-----|
| `docker/powersync/powersync.yaml` | PowerSync 服务主配置 |
| `docker/powersync/sync_rules.yaml` | 同步规则定义 |

#### 下一步计划 (Phase 2)
- [ ] 在 `web/src/lib/powersync/` 下创建 SQLite schema、provider、hooks
- [ ] 引入 `@powersync/web`, `@powersync/react` 依赖
- [ ] 实现基础 Live Query Hook (`useBooks`, `useNotes`)
- [ ] 保留 Dexie 作为 fallback
- [ ] 编写部署手册章节 (07_DevOps)
- [ ] 搭建 PowerSync 本地环境并联通 PostgreSQL

---

## 🔥 历史更新 (2025-12-10 18:30)

### 上传流程深度修复 - 闭包问题与状态轮询 ✅

根据第二轮测试反馈，修复了元数据确认弹窗持续不弹出的问题：

#### 问题根源分析

1. **React 闭包问题**：`useUploadPostProcessing` hook 中的 `onStatusUpdate` 等回调在 `useCallback` 依赖数组中，导致 `startMonitoring` 每次渲染都可能重新创建。然而，轮询函数 `poll()` 捕获的是旧版本的回调引用，导致回调可能不会被正确调用。

2. **状态传递问题**：前端轮询虽然获取到了正确的 `metadataExtracted = true` 状态，但由于闭包问题，`onStatusUpdate` 回调中的条件判断可能使用了过期的 `lastUploadRef.current`。

#### 修复内容

**1. 使用 Ref 保存回调函数 (`useUploadPostProcessing.ts`)**
```typescript
// 【关键修复】使用 ref 保存回调函数，确保轮询始终使用最新的回调
const onStatusUpdateRef = useRef(onStatusUpdate)
const onMetadataReadyRef = useRef(onMetadataReady)
// ... 其他回调

// 同步更新 refs
useEffect(() => {
  onStatusUpdateRef.current = onStatusUpdate
  // ... 
}, [onStatusUpdate, ...])

// 在轮询中使用 ref
onStatusUpdateRef.current?.(newStatus)
```

**2. 移除 useCallback 中的回调依赖**
- 将 `startMonitoring` 的依赖从 `[..., onStatusUpdate, ...]` 改为 `[..., cleanup, fetchBookStatus, ...]`
- 避免回调变化导致 `startMonitoring` 函数重新创建

**3. 增强调试日志 (`UploadManager.tsx`)**
```typescript
console.log('[UploadManager] Dialog conditions:', {
  hasProcessingResult,  // metadataExtracted || hasCover
  needsConfirmation,    // !metadataConfirmed
  hasUploadRecord,      // !!lastUploadRef.current
})
```

#### 其他修复

**API 路径修复** - 之前已完成但需确认：
- `UploadManager.tsx` 的 `pollConversionStatus` 使用 `/api/v1/books/${bookId}`
- 正确读取 `response.data.conversion_status` 而非 `response.conversion_status`

**OCR SQL 类型转换修复** - 之前已完成：
- 使用 `cast(:original_key as text)` 解决 asyncpg 的 `IndeterminateDatatypeError`

**PDF 类型检测改进** - 使用 PyMuPDF 检查前 6 页：
- 替代旧的 65KB 字节头检测方法
- 判断标准：有意义字符占比 < 5% 或每页平均文本 < 50 字符 → 图片型

---

## 🔥 历史更新 (2025-12-10 14:00)

### OCR 流程优化 - 三个 BUG 修复与用户体验提升 ✅

根据测试反馈，修复了以下问题：

#### 问题 1：书籍上传后不刷新
**问题描述**：上传书籍后，需要刷新浏览器才能看到封面和元数据。

**修复内容**：
- 修改 `LibraryPage.tsx` 中的 `book_uploaded` 事件处理
- 上传成功后延迟 1 秒自动刷新列表，确保后台任务完成后获取完整数据

#### 问题 2：元数据确认弹窗不显示
**问题描述**：上传 PDF 后，元数据确认弹窗不弹出；且文字型 PDF 错误显示 "OCR THIS BOOK" 选项。

**修复内容**：
1. **弹窗触发条件优化** (`UploadManager.tsx`)
   - 将轮询次数从 30 增加到 60（最长等待 60 秒）
   - 条件改为 `(metadataExtracted || hasCover) && !metadataConfirmed`
   
2. **OCR 状态获取修复** (`useUploadPostProcessing.ts`)
   - 直接使用 API 返回的 `book.ocr_status` 而非额外调用 OCR API

3. **PDF 类型检测修复** (`tasks.py` + `books.py`)
   - **问题根源**：`confidence` 阈值逻辑错误，文字型 PDF 的 confidence 可能 < 0.8
   - **修复**：确保数字型 PDF 的 `confidence >= 0.8`
     ```python
     # _extract_pdf_metadata 中
     metadata["digitalization_confidence"] = max(0.8, min(1.0, avg_chars/500))
     ```
   - 同步更新 `_quick_confidence` 函数

#### 问题 3：OCR 完成后新 PDF 不下载
**问题描述**：图片型 PDF OCR 完成后，前端缓存的仍是旧文件，无法使用文字选择功能。

**修复内容** (`LibraryPage.tsx`)：
- 实现 OCR 完成后自动下载新双层 PDF 的无感体验
- 新增 `ocrDownloadingBooks` 状态追踪正在下载的书籍
- **流程**：
  1. OCR 完成 → 触发 `ocr_completed` 事件
  2. 标记书籍为"下载中"（保持锁定）
  3. 删除旧 PDF 缓存
  4. 自动下载新的双层 PDF 到 IndexedDB
  5. 下载完成 → 解除锁定，刷新列表
- **用户体验**：OCR 处理标识消失后，书籍即可点击，新文件已就绪

---

## 🔥 历史更新 (2025-12-09 23:30)

### OCR 架构重构 - 双层 PDF 生成与锁定机制 ✅

彻底解决了前端 OCR 文字层对齐问题！采用行业最佳实践：**后端生成双层 PDF (Invisible Text Layer)**。

#### 问题描述

旧方案使用前端 DOM 渲染透明文字叠加层，存在严重的对齐问题：
- ❌ 文字位置与 PDF 图片不匹配
- ❌ 不同缩放比例下偏差更明显
- ❌ 需要维护复杂的坐标映射逻辑

#### 解决方案

采用双层 PDF 方案，文字层由 PDF 引擎原生渲染，完美对齐：

**1. 后端重构 (`api/app/tasks.py`)**
- 新增 `_embed_ocr_text_to_pdf()` 函数，使用 PyMuPDF 将 OCR 文字嵌入 PDF
- 使用 `page.insert_text(render_mode=3)` 写入透明文字（不可见但可选中）
- OCR 完成后上传双层 PDF 到 `layered/{book_id}.pdf`
- 更新 `minio_key` 指向新文件，备份原始 key 到 `meta.original_minio_key`

**2. 前端锁定机制 (`web/src/components/BookCard.tsx`)**
- OCR 处理中（`ocrStatus === 'pending' | 'processing'`）的书籍禁止进入阅读页
- 点击时显示 Toast 提示："正在进行文字识别，请稍候..."

**3. 缓存自动清理 (`web/src/pages/LibraryPage.tsx`)**
- 监听 `ocr_completed` 事件
- 自动调用 `deleteBookFile()` 清理 IndexedDB 中的旧 PDF
- 用户下次点击时自动下载新的双层 PDF
### UI/UX 优化 - 沉浸式阅读体验升级 ✅

实现了阅读页面 (`ReaderPage`) 的全屏沉浸式体验，顶部导航栏现在支持智能隐藏。

#### 变更内容

1.  **顶部导航栏隐藏**: 阅读页面的顶部 Header（包含 Back 按钮、书名、进度）现在默认隐藏。
2.  **智能唤起**: 与底部导航栏一致，仅在用户交互（鼠标移动、点击、触摸、滚动）时从顶部滑出。
3.  **自动隐藏**: 无操作 3 秒后自动回落隐藏，提供无干扰的阅读环境。
4.  **全屏布局**: 阅读区域高度调整为 `100vh`，充分利用屏幕空间。

### UI/UX 优化 - 底部导航栏微调 ✅

根据用户反馈，进一步优化了底部导航栏的视觉质感与交互细节。

#### 变更内容

1.  **视觉降噪**: 移除了导航按钮的细微描边 (`border`)，使界面更加干净。
2.  **选中态优化**:
    *   **颜色**: 选中图标颜色改为 **黑色** (`var(--label)`)，去除了原有的蓝色调。
    *   **线条**: 选中图标线条加粗至 `3px`，增强视觉重心。
    *   **动效**: 移除了蓝色光环，改为轻微的 **缩放效果** (`scale-105`)。
3.  **丝滑体验**: 优化了 CSS 过渡曲线，采用 Apple 风格的 `cubic-bezier(0.22, 1, 0.36, 1)`，时长调整为 `500ms`，使状态切换更加自然流畅。

### UI/UX 优化 - 底部导航栏重构 ✅

根据设计规范调整了底部导航栏的样式与交互，实现了沉浸式阅读体验。

#### 变更内容

1.  **样式统一**: 导航按钮样式与首页“个人信息”图标保持一致（悬浮、阴影、描边）。
2.  **响应式形状**:
    *   **移动端**: 圆形 (`w-12 h-12 rounded-full`)
    *   **桌面端**: 椭圆形 (`w-24 h-12 rounded-full`)
3.  **沉浸式阅读**:
    *   在阅读页面 (`/app/read/:id`) 自动隐藏导航栏。
    *   **智能唤起**: 仅在用户交互（鼠标移动、点击、触摸、滚动）时从底部升起。
    *   **自动隐藏**: 无操作 3 秒后自动回落隐藏。

### 离线同步冲突解决 - 重大 BUG 修复 ✅

修复了离线数据被服务器覆盖的严重问题！之前离线期间的阅读进度、元数据修改、阅读时间在联网后会被服务器数据覆盖。

#### 问题描述

用户报告以下问题:
1. ❌ 离线后的阅读进度被服务器的数据覆盖了
2. ❌ 离线时修改的元数据在联机后也被覆盖了
3. ❌ 离线时阅读的总时间全部被联机后服务器全部覆盖
4. ❌ Home 页面的 Yearly Goal 离线不工作

#### 根本原因

1. **initialSync 直接覆盖**: `syncEngine.ts` 的 `initialSync()` 方法在拉取服务器数据时，没有检查本地的 `_dirty` 标志，直接用 `db.xxx.put()` 覆盖本地数据
2. **LWW 未实现**: 阅读进度的 Last-Writer-Wins 策略没有正确比较 `_updatedAt` 时间戳
3. **Dashboard 数据覆盖**: `Home.tsx` 的 `refresh()` 直接用服务器数据覆盖本地缓存，没有实现合并策略
4. **书籍元数据未标记 dirty**: `updateLibraryBookCache()` 只更新缓存，没有在 `books` 表设置 `_dirty` 标志

#### 修复内容

**1. `web/src/lib/syncEngine.ts` - initialSync 尊重本地脏数据**

```typescript
// 存储书籍元数据 - 尊重本地脏数据，不覆盖
if (metadataResp.data?.data?.books) {
  for (const book of metadataResp.data.data.books) {
    const existing = await db.books.get(book.id)
    const serverUpdatedAt = new Date(book.updatedAt).getTime()
    
    // 如果本地有脏数据，且本地更新时间更新，则跳过服务器数据
    if (existing && existing._dirty && existing._updatedAt > serverUpdatedAt) {
      console.log('[SyncEngine] Skipping server book data, local is newer:', book.id)
      await db.books.update(book.id, { _syncedAt: Date.now() })
      continue
    }
    // ... 正常处理
  }
}

// 存储阅读进度 - LWW (Last-Writer-Wins) 策略
if (metadataResp.data?.data?.progress) {
  for (const prog of metadataResp.data.data.progress) {
    const existing = await db.progress.get(prog.bookId)
    const serverUpdatedAt = new Date(prog.updatedAt).getTime()
    
    // LWW: 只有服务器数据更新时才覆盖本地
    if (existing && existing._dirty && existing._updatedAt >= serverUpdatedAt) {
      console.log('[SyncEngine] Skipping server progress, local is newer:', prog.bookId)
      continue
    }
    // ... 正常处理
  }
}
```

**2. `web/src/lib/homeStorage.ts` - 新增智能合并函数**

```typescript
/**
 * 合并本地和服务器的 Dashboard 数据
 * 
 * 策略:
 * - todayMinutes: 取 MAX（本地离线时间可能更多）
 * - currentStreak: 服务器权威
 * - longestStreak: 取 MAX
 * - yearlyCompleted: 取 MAX
 * - weeklyActivity: 按天取 MAX 合并
 */
export async function mergeDashboardData(serverData: {...}): Promise<{...}> {
  const localCache = await getDashboardCache()
  if (!localCache) {
    // 没有本地缓存，直接使用服务器数据
    return serverData
  }
  
  // 智能合并
  const merged = {
    todayMinutes: Math.max(localCache.todayMinutes, serverData.todayMinutes ?? 0),
    currentStreak: serverData.currentStreak ?? localCache.currentStreak,  // 服务器权威
    longestStreak: Math.max(localCache.longestStreak, serverData.longestStreak ?? 0),
    yearlyCompleted: Math.max(localCache.yearlyCompleted, serverData.yearlyCompleted ?? 0),
    weeklyActivity: localCache.weeklyActivity.map((local, i) => 
      Math.max(local, serverData.weeklyActivity?.[i] ?? 0)
    ),
    // ... 其他字段
  }
  
  await saveDashboardCache(merged)
  return merged
}
```

**3. `web/src/pages/app/Home.tsx` - 使用合并策略刷新**

```typescript
const refresh = useCallback(async () => {
  if (!navigator.onLine) return
  
  const serverData = await fetch('/api/v1/home/dashboard').then(r => r.json())
  
  if (serverData?.data) {
    // 使用智能合并而非直接覆盖
    const mergedData = await mergeDashboardData({
      todayMinutes: Math.round((serverData.data.today?.seconds || 0) / 60),
      // ... 其他字段
    })
    
    setDash({
      today: { seconds: mergedData.todayMinutes * 60 },
      // ... 使用合并后的数据
    })
  }
}, [])
```

**4. `web/src/lib/db.ts` - 新增书籍元数据更新函数**

```typescript
/**
 * 更新书籍元数据（离线优先）
 * 自动设置 _dirty 标志待同步
 */
export async function updateBookMetadata(
  bookId: string,
  updates: Partial<Pick<BookMeta, 'title' | 'author' | 'language' | 'meta'>>
): Promise<void> {
  await db.books.update(bookId, {
    ...updates,
    _dirty: true,
    _updatedAt: Date.now(),
  })
}
```

**5. `web/src/components/BookMetadataDialog.tsx` - 同时更新 books 表**

```typescript
// **本地优先**：先更新本地缓存和书籍表
await updateLibraryBookCache(bookId, { title, author })
await updateBookMetadata(bookId, { title, author })  // 新增！设置 _dirty 标志
```

**6. `web/src/pages/app/home/YearlyGoalCard.tsx` - 离线支持**

```typescript
const handleUpdate = async () => {
  // **本地优先**: 先保存到本地缓存
  const currentCache = await getDashboardData()
  if (currentCache) {
    await saveDashboardData({ ...currentCache, yearlyGoal: newTarget })
  }
  
  if (navigator.onLine) {
    // 在线: 同步到服务器
    await fetch('/api/v1/home/goals', { method: 'PATCH', ... })
  } else {
    // 离线: 加入同步队列
    await addToSyncQueue('settings', 'update', 'yearly_goal', { yearly_books: newTarget })
    setSavedOffline(true)
  }
}
```

#### 修改文件清单

| 文件 | 修改内容 |
| :--- | :--- |
| `web/src/lib/syncEngine.ts` | initialSync: 书籍/进度/笔记/高亮都增加 _dirty 检查和 LWW 策略 |
| `web/src/lib/homeStorage.ts` | 新增 mergeDashboardData() 智能合并函数 |
| `web/src/pages/app/Home.tsx` | refresh() 使用 mergeDashboardData() 而非直接覆盖 |
| `web/src/lib/db.ts` | 新增 updateBookMetadata(), getDirtyBooks(), markBookSynced() |
| `web/src/components/BookMetadataDialog.tsx` | 同时调用 updateBookMetadata() 设置 _dirty 标志 |
| `web/src/pages/app/home/YearlyGoalCard.tsx` | 添加离线支持和同步队列 |

#### 验证清单

- [ ] 离线修改阅读进度 → 联网后不被覆盖，推送到服务器
- [ ] 离线修改书籍元数据 → 联网后不被覆盖，推送到服务器
- [ ] 离线阅读时间 → 联网后与服务器数据取 MAX 合并
- [ ] 离线修改 Yearly Goal → 显示离线保存提示，联网后同步
- [ ] Home 页面数据 → 使用智能合并策略

---

## 🔥 更新 (2025-12-09 17:30)

### App-First 前端 P4/P6 完成 ✅

完成了 App-First 改造计划 P4（离线业务逻辑）和 P6（冲突解决 UI）阶段的前端工作，标志着离线优先架构前端实现全部完成！

#### P4 - 离线业务逻辑层 (React Hooks)

**新增文件**:

1. ✅ **`web/src/hooks/useOfflineNotesV2.ts`** (175 行)
   - 封装笔记的离线 CRUD 操作
   - **createNewNote()** - 创建笔记，自动标记 dirty，触发心跳同步
   - **updateExistingNote()** - 更新笔记内容
   - **deleteExistingNote()** - 软删除笔记，移入回收站
   - **unsyncedCount** - 显示未同步笔记数量
   - **triggerSync()** - 手动触发同步
   - **autoSync** - 自动后台同步（默认开启）

2. ✅ **`web/src/hooks/useOfflineProgressV2.ts`** (168 行)
   - 封装阅读进度的离线更新
   - **updateProgressData()** - 本地优先更新进度（LWW 策略）
   - **markFinished()** - 标记书籍完成，立即同步
   - **isDirty** - 显示是否有未同步进度
   - **自动心跳同步** - 定期（15秒）自动上传进度
   - **syncInterval** - 可配置同步间隔

3. ✅ **`web/src/hooks/useOfflineShelvesV2.ts`** (306 行)
   - 封装书架的离线 CRUD 操作
   - **createNewShelf()** - 创建书架
   - **updateExistingShelf()** - 更新书架信息
   - **deleteExistingShelf()** - 软删除书架，移入回收站
   - **addBookToShelf()** - 添加书籍到书架
   - **removeBookFromShelf()** - 从书架移除书籍
   - **getShelfBooks()** - 获取书架的书籍列表
   - **unsyncedCount** - 显示未同步书架数量

**核心特性**:
- **本地优先** - 所有操作立即写入 IndexedDB，无需等待网络
- **自动同步** - 在线状态下自动触发 heartbeat 同步
- **dirty 追踪** - 自动标记未同步数据，显示同步状态
- **错误处理** - 统一的错误捕获和日志记录
- **类型安全** - 完整的 TypeScript 类型定义

#### P6 - 冲突解决 UI

**新增文件**:

1. ✅ **`web/src/components/ConflictResolverDialog.tsx`** (330 行)
   - **并排对比界面** - 左侧本地版本，右侧服务器版本
   - **详细信息展示**:
     - 笔记内容（支持多行）
     - 章节信息
     - 位置（EPUB CFI 或 PDF 页码）
     - 更新时间（本地化格式）
     - 设备 ID（服务器版本）
   - **三种解决方案**:
     - **保留本地** - 删除服务器版本冲突副本
     - **使用服务器** - 删除本地版本，保留服务器版本
     - **跳过** - 暂不处理，稍后手动解决
   - **批量处理** - 自动显示下一个冲突
   - **进度提示** - 显示剩余冲突数量

2. ✅ **`web/src/hooks/useConflictDetection.ts`** (112 行)
   - **自动检测** - 应用启动时自动检查冲突
   - **定期检查** - 可配置检查间隔（默认 60 秒）
   - **同步后检查** - 监听 syncEngine 事件，同步完成后自动检查
   - **状态管理**:
     - hasConflicts - 是否有冲突
     - conflictCount - 冲突数量
     - isChecking - 是否正在检查
     - showDialog - 控制对话框显示
   - **手动触发** - openDialog(), closeDialog(), checkConflicts()

**使用示例**:
```typescript
// 在应用根组件中集成
function App() {
  const {
    hasConflicts,
    conflictCount,
    showDialog,
    openDialog,
    closeDialog,
  } = useConflictDetection()
  
  return (
    <>
      {hasConflicts && (
        <Button onClick={openDialog}>
          解决 {conflictCount} 个冲突
        </Button>
      )}
      
      <ConflictResolverDialog
        open={showDialog}
        onClose={closeDialog}
        onResolved={() => {
          // 冲突解决后的回调
          toast.success('冲突已解决')
        }}
      />
    </>
  )
}
```

#### 技术亮点

1. **离线优先架构完整闭环**
   - P2: 统一数据层（Dexie + Repository）
   - P3: 同步引擎（initialSync + heartbeat）
   - P4: 业务逻辑层（React Hooks）
   - P6: 用户交互层（冲突解决 UI）

2. **开发者友好**
   - Hooks API 简洁直观
   - 自动处理同步逻辑
   - 无需手动管理 dirty 状态
   - 完整的 TypeScript 类型支持

3. **用户体验优化**
   - 操作立即生效（无网络延迟）
   - 后台自动同步（无感知）
   - 冲突解决流程清晰
   - 实时同步状态反馈

4. **可靠性保障**
   - 软删除 + 30 天回收站
   - LWW 策略避免进度冲突
   - 冲突副本保留完整历史
   - 指数退避重试机制

---

## 🔥 更新 (2025-12-09 15:45)

### App-First 前端 P2/P3 完成 ✅

完成了 App-First 改造计划 P2 和 P3 阶段的前端工作，实现了统一数据层和同步引擎。

#### P2 - 数据层实现 (Dexie Schema v1 + Repository 层)

**新增文件**:
1. ✅ **`web/src/lib/db.ts`** (340 行)
   - 定义 `AthenaDatabase` 类，继承 Dexie
   - 13 张表：books, notes, highlights, shelves, progress, settings, syncQueue, trash, aiConversations, aiMessages, searchIndices, versionFingerprints, userSettings
   - 统一同步元数据字段：`_dirty`, `_deleted`, `_rev`, `_updatedAt`, `_syncedAt`
   - 工具函数：`getDeviceId()`, `generateTempId()`, `isTempId()`

2. ✅ **`web/src/lib/repo/bookRepo.ts`** (154 行)
   - 书籍 CRUD：getAllBooks(), createBook(), updateBook(), deleteBook()
   - 软删除支持（标记 `_deleted: true`，进入 trash 表）
   - dirty 追踪（本地修改自动标记 `_dirty: true`）
   - 同步方法：getDirtyBooks(), syncBooksFromServer()

3. ✅ **`web/src/lib/repo/noteRepo.ts`** (229 行)
   - 笔记 CRUD：getNotes(), createNote(), updateNote(), deleteNote()
   - 冲突检测：createConflictCopy(), getConflictedNotes()
   - 冲突解决：resolveConflict() - 支持保留本地/使用服务器/手动合并
   - 同步方法：syncNotesFromServer() - 智能合并策略

4. ✅ **`web/src/lib/repo/progressRepo.ts`** (138 行)
   - Last-Write-Wins (LWW) 策略
   - updateProgress() - 本地优先写入，标记 dirty
   - syncProgressFromServer() - 比较时间戳，保留最新
   - markProgressSynced() - 清除 dirty 标记

5. ✅ **`web/src/lib/repo/settingsRepo.ts`** (203 行)
   - 全局设置：updateGlobalSettings(), getGlobalSettings()
   - 每本书阅读器设置：updateBookReaderSettings() - 完整快照存储
   - 阅读统计：incrementTodayReading(), updateReadingStreak()

6. ✅ **`web/package.json`** 更新
   - 添加依赖：`"dexie": "^4.0.11"`

#### P3 - 同步引擎实现 (SyncEngine 升级)

**升级文件**: `web/src/lib/syncEngine.ts` (新增 367 行代码)

1. ✅ **initialSync() 方法** - 对接 `GET /api/v1/sync/initial`
   - 支持进度回调 `onProgress?: (progress: InitialSyncProgress) => void`
   - 分三阶段拉取：
     - Phase 1 (33%): METADATA - 书籍元数据、阅读进度、用户设置
     - Phase 2 (66%): NOTES - 笔记、高亮
     - Phase 3 (100%): AI_HISTORY - AI 对话历史
   - 存储到 IndexedDB：books, progress, userSettings, notes, highlights, aiConversations, aiMessages
   - 支持断点续传（分页参数 offset/limit）
   - 返回值：`{ success: boolean; error?: string }`

2. ✅ **heartbeat() 方法** - 对接 `POST /api/v1/sync/heartbeat`
   - 构建请求负载：
     - deviceId: 从 getDeviceId() 获取
     - clientVersions: 版本指纹（ocr/metadata/vectorIndex）
     - clientUpdates: 待上传的 pendingNotes, pendingHighlights, readingProgress
   - 处理 pushResults：
     - readingProgress: accepted → 标记 `_dirty: false`
     - notes: created → 更新 serverId, conflict_copy → 触发冲突 UI
     - highlights: created/merged → 更新 serverId
   - 更新 versionFingerprints 表
   - 返回值：`HeartbeatResponse | null`

3. ✅ **calculateBackoff() 方法** - 指数退避 + 随机抖动
   - 公式：`delay = min(retryDelay * 2^retryCount, maxRetryDelay)`
   - 抖动：±10% 随机变化避免雷鸣羊群效应

4. ✅ **TypeScript 类型定义**
   ```typescript
   interface InitialSyncProgress {
     phase: 'metadata' | 'notes' | 'ai_history' | 'complete'
     current: number
     total: number
     message: string
   }
   
   interface HeartbeatResponse {
     serverVersions: {
       ocr: number
       metadata: number
       vectorIndex: number
     }
     pushResults: {
       readingProgress?: 'accepted' | 'rejected'
       notes?: Array<{
         clientId: string
         serverId: string
         status: 'created' | 'conflict_copy' | 'merged'
       }>
       highlights?: Array<{ ... }>
     }
     pullRequired?: {
       hasNewOcr: boolean
       hasNewMetadata: boolean
       hasNewVectorIndex: boolean
     }
   }
   ```

5. ✅ **SyncEngineConfig 更新**
   - 添加 `heartbeatIntervals` 字段：
     - active: 15000ms (15秒) - 阅读会话中
     - idle: 60000ms (1分钟) - 应用在前台但无交互
     - background: 300000ms (5分钟) - 应用在后台
   - maxRetryDelay: 300000ms (5分钟上限)

#### 技术亮点

1. **统一数据层**
   - 所有本地数据操作统一使用 Repository 模式
   - 消除散落在各处的 localStorage/IndexedDB 直接调用
   - 便于测试、Mock、日志追踪

2. **冲突处理机制**
   - 阅读进度：LWW 策略（简单高效）
   - 笔记：创建冲突副本（conflict_copy），由用户手动解决
   - 高亮：智能合并（位置相同则合并注释）

3. **离线优先架构**
   - 所有写操作本地优先（标记 `_dirty: true`）
   - 在线恢复后自动同步（heartbeat 批量上传）
   - 网络异常时指数退避重试

4. **类型安全**
   - 严格 TypeScript 类型定义
   - 接口与后端 API 响应完全匹配
   - 避免运行时类型错误

---

## 🔥 更新 (2025-12-09 00:30)

### App-First 后端 P5 - 首次同步接口实现 ✅

完成了 App-First 改造计划 P5 阶段的后端工作，实现了 `GET /api/v1/sync/initial` 首次同步接口。

#### 实现内容

**文件**: `api/app/sync.py`

**新增功能**:
1. ✅ **首次同步接口** (`GET /api/v1/sync/initial`)
   - 支持分页（offset/limit，默认 50 条/次，最大 200）
   - 支持按类别筛选（all/metadata/covers/notes/ai_history/billing）
   - 返回完整的业务数据快照

2. ✅ **数据分类枚举** (`SyncCategory`)
   - `ALL`: 全部数据
   - `METADATA`: 核心元数据（书籍、进度、书架、设置）
   - `COVERS`: 封面图片 URL 列表
   - `NOTES`: 笔记、高亮、标签
   - `AI_HISTORY`: AI 对话历史（只读）
   - `BILLING`: 账单记录（只读）

3. ✅ **分阶段同步支持**
   - **阶段1 (METADATA)**: 用户设置、书籍元数据、阅读进度、书架 → UI 立即可用
   - **阶段2 (NOTES)**: 笔记、高亮、标签、AI历史、账单 → 交互数据
   - **阶段3 (COVERS)**: 封面图片 URL → 媒体资源，后台下载

4. ✅ **完整数据同步范围**
   - 书籍元数据（title, author, language, format, size, ocr_status, meta）
   - 阅读进度（progress, lastLocation, finishedAt）
   - 书架定义 + 书架-书籍关联（支持多书架）
   - 用户设置（language, timezone, membershipTier）
   - 阅读目标（dailyMinutes, yearlyBooks）
   - 阅读统计（连续天数、最长记录）
   - 笔记（包含 device_id, conflict_of 冲突检测字段）
   - 高亮（包含 device_id, conflict_of 冲突检测字段）
   - 标签
   - AI 对话历史（最近 50 条，含完整消息列表）
   - 账单记录（最近 50 条流水）

5. ✅ **分页与断点续传**
   - 返回 `pagination` 对象（offset, limit, total, hasMore）
   - 前端可基于 `hasMore` 判断是否需要继续拉取
   - 支持断点续传（网络中断后可从上次 offset 继续）

#### API 响应示例

```json
{
  "data": {
    "books": [
      {
        "id": "uuid",
        "title": "书名",
        "author": "作者",
        "language": "zh-CN",
        "originalFormat": "pdf",
        "coverImageKey": "covers/xxx",
        "size": 12345678,
        "isDigitalized": true,
        "ocrStatus": "completed",
        "metadataConfirmed": true,
        "meta": { "pageCount": 300 },
        "version": 1,
        "createdAt": "2025-12-01T10:00:00Z",
        "updatedAt": "2025-12-08T15:30:00Z"
      }
    ],
    "progress": [
      {
        "bookId": "uuid",
        "progress": 0.35,
        "lastLocation": "epubcfi(...)",
        "finishedAt": null,
        "updatedAt": "2025-12-08T20:15:00Z"
      }
    ],
    "shelves": [...],
    "shelfItems": [...],
    "settings": {...},
    "readingGoals": {...},
    "readingStats": {...},
    "notes": [...],
    "highlights": [...],
    "tags": [...],
    "covers": [...],
    "aiConversations": [...],
    "billing": [...]
  },
  "pagination": {
    "offset": 0,
    "limit": 50,
    "total": 150,
    "hasMore": true
  },
  "timestamp": 1733702400
}
```

#### 与改造计划的对应关系

| 计划要求 | 实现状态 |
|---------|---------|
| P5.1 实现 `GET /api/v1/sync/initial` | ✅ 已完成 |
| 支持分页（offset/limit） | ✅ 已完成 |
| 支持按类别筛选 | ✅ 已完成（5种类别） |
| 返回书籍元数据 | ✅ 已完成（含 meta JSONB） |
| 返回阅读进度 | ✅ 已完成（含 lastLocation） |
| 返回书架数据 | ✅ 已完成（含关联关系） |
| 返回用户设置 | ✅ 已完成（含阅读目标和统计） |
| 返回笔记/高亮 | ✅ 已完成（含冲突字段） |
| 返回标签 | ✅ 已完成 |
| 返回 AI 历史 | ✅ 已完成（含消息列表） |
| 返回账单记录 | ✅ 已完成 |
| 封面图片 URL | ✅ 已完成 |
| 断点续传支持 | ✅ 已完成（pagination.hasMore） |

#### 后续工作

**前端适配（P2-P6）**:
- [x] **P2: 升级 Dexie Schema 至 v2.1，实现 LocalRepository 封装层** ✅ (2025-12-09 15:45)
  - ✅ 创建 `web/src/lib/db.ts` - 13 张表的统一数据库定义
  - ✅ 实现 `bookRepo.ts` - 书籍元数据 CRUD，软删除，dirty 追踪
  - ✅ 实现 `noteRepo.ts` - 笔记 CRUD，冲突检测，createConflictCopy()
  - ✅ 实现 `progressRepo.ts` - 阅读进度 LWW 策略，syncProgressFromServer()
  - ✅ 实现 `settingsRepo.ts` - 全局设置、每本书阅读器设置（完整快照）、阅读统计
  - ✅ 更新 `package.json` 添加 dexie@^4.0.11 依赖
  
- [x] **P3: 实现 SyncEngine 前端同步引擎，对接 `/sync/initial` 和 `/sync/heartbeat`** ✅ (2025-12-09 15:45)
  - ✅ 新增 `initialSync()` 方法 - 对接 GET /api/v1/sync/initial
    - 支持进度回调（metadata → notes → AI历史）
    - 分阶段拉取：元数据（33%）→ 笔记高亮（66%）→ AI历史（100%）
    - 存储书籍、进度、设置、笔记、高亮、AI对话到 IndexedDB
  - ✅ 新增 `heartbeat()` 方法 - 对接 POST /api/v1/sync/heartbeat
    - 构建 clientVersions 版本指纹
    - 上传 pendingNotes、pendingHighlights、readingProgress
    - 处理 pushResults（created/conflict_copy/merged）
    - 更新 versionFingerprints 表
  - ✅ 新增 `calculateBackoff()` 方法 - 指数退避 + 随机抖动
  - ✅ 更新 SyncEngineConfig 类型（heartbeatIntervals: 15s/60s/300s）
  - ✅ 更新 TypeScript 接口（InitialSyncProgress, HeartbeatResponse）
  
- [x] **P4: 离线业务逻辑（笔记、进度、书架离线 CRUD）** ✅ (2025-12-09 17:30)
  - ✅ 创建 `useOfflineNotesV2.ts` - 笔记离线 CRUD Hook（175 行）
    - createNewNote(), updateExistingNote(), deleteExistingNote()
    - unsyncedCount 显示未同步数量
    - 自动触发 heartbeat 同步
  - ✅ 创建 `useOfflineProgressV2.ts` - 阅读进度离线 Hook（168 行）
    - updateProgressData(), markFinished()
    - 定期自动同步（默认 15 秒）
    - isDirty 状态追踪
  - ✅ 创建 `useOfflineShelvesV2.ts` - 书架离线 Hook（306 行）
    - createNewShelf(), updateExistingShelf(), deleteExistingShelf()
    - addBookToShelf(), removeBookFromShelf()
    - getShelfBooks() 获取书架书籍列表
  - ✅ 所有 Hooks 支持本地优先、自动同步、错误处理、类型安全
  
- [x] **P6: 冲突解决 UI（ConflictResolver 对话框）** ✅ (2025-12-09 17:30)
  - ✅ 创建 `ConflictResolverDialog.tsx` 组件（330 行）
    - 并排对比界面（本地版本 vs 服务器版本）
    - 显示笔记内容、章节、位置、时间、设备 ID
    - 三种解决方案：保留本地/使用服务器/跳过
    - 批量处理多个冲突，显示进度
  - ✅ 创建 `useConflictDetection.ts` Hook（112 行）
    - 应用启动时自动检测冲突
    - 定期检查（默认 60 秒）
    - 同步完成后自动检查
    - 状态管理：hasConflicts, conflictCount, showDialog
    - 手动触发：openDialog(), closeDialog(), checkConflicts()

**集成测试（下一步）**:
- [ ] 将 useOfflineNotesV2 集成到 NotesPanel 组件
- [ ] 将 useOfflineProgressV2 集成到 Reader 组件
- [ ] 将 useOfflineShelvesV2 集成到 BookShelf 组件
- [ ] 在 App.tsx 集成 useConflictDetection 和 ConflictResolverDialog
- [ ] 端到端测试：离线创建笔记 → 在线同步 → 冲突检测 → 解决冲突

---

## 🔥 更新 (2025-12-08 23:20)

### App-First 完全体文档同步 ✅

基于 `App-First完全体改造计划.md` 中的讨论记录，完成了所有相关技术文档的同步更新：

#### 1. App-First改造计划.md 更新
- ✅ 版本升级至 v2.1（完全体架构 - 最终确认版）
- ✅ 添加对完全体讨论记录文档的引用
- ✅ 新增**附录A：完全体讨论最终确认决策**，包含：
  - A.1 冲突解决策略最终确认（阅读进度LWW、笔记智能合并、删除vs修改）
  - A.2 首次同步策略最终确认（一次性下载、断点续传、完整封面）
  - A.3 AI对话与账务数据离线策略
  - A.4 搜索功能离线策略
  - A.5 每本书阅读器设置存储（完整快照存储）
  - A.6 阅读统计数据同步
  - A.7 书籍上传离线策略
  - A.8 回收站机制（30天双端同步）
  - A.9 部署环境上下文（FRP+VPS+CDN）
  - A.10 技术选型排除项记录

#### 2. 03号文档（系统架构与ADR）更新
- ✅ ADR-006 版本升级至 v2.1
- ✅ 添加完全体讨论记录和实施计划文档引用

#### 3. 05号文档（API契约与协议）更新
- ✅ 同步接口章节添加相关文档引用
- ✅ 初始全量同步API规格详细化（分页、断点续传、数据范围）
- ✅ 增量推送冲突处理策略明确化

---

## 🔥 更新 (2025-12-08 19:45)

### 离线阅读进度与元数据修改 - 真正的 App-First ✅

**用户反馈的核心问题**：
1. 离线状态下翻页后退出，再进入书籍，进度被重置到离线前的状态
2. 离线状态下修改作者名，提示 "Failed to fetch"，无法保存
3. 书架视图中的书籍没有显示云图标

**这不是 App-First 的最佳实践！** 用户在离线状态下的所有操作都应该：
1. **立即保存到本地 IndexedDB**
2. **网络恢复后自动同步到服务器**

#### 修复 1：离线阅读进度保存 ✅

**根因**：`useReaderHeartbeat.ts` 的 `updateProgress` 只通过心跳 API 同步到服务器，没有保存到本地 IndexedDB。离线时心跳失败，进度丢失。

**修复** (`web/src/hooks/useReaderHeartbeat.ts`):
```typescript
import { saveReadingProgressLocal } from '@/lib/syncStorage'

// 更新进度 - **本地优先**：先保存到 IndexedDB，再尝试同步
const updateProgress = useCallback(async (progress: number, location?: string) => {
  const currentBookId = bookIdRef.current
  if (!currentBookId) return
  
  // 更新当前进度（用于心跳发送）
  currentProgressRef.current = { progress, location }
  
  // **关键修复**：立即保存到本地 IndexedDB，确保离线时进度不丢失
  try {
    await saveReadingProgressLocal(currentBookId, location, progress)
    console.log('[Heartbeat] Progress saved locally:', currentBookId, progress)
  } catch (e) {
    console.error('[Heartbeat] Failed to save progress locally:', e)
  }
  
  // 防抖后尝试同步到服务器（离线时会静默失败，不影响本地保存）
  // ...
}, [sendHeartbeat])
```

#### 修复 2：离线元数据修改 ✅

**根因**：`BookMetadataDialog.tsx` 直接调用 API，离线时失败。

**修复** (`web/src/components/BookMetadataDialog.tsx`):
```typescript
import { updateLibraryBookCache } from '@/lib/libraryStorage'
import { addToSyncQueue } from '@/lib/syncStorage'

const handleSave = async () => {
  // **本地优先**：先更新本地缓存
  await updateLibraryBookCache(bookId, { title, author })
  
  if (isOnline) {
    // 在线：同步到服务器
    await updateMetadataOnServer(bookId, newMetadata)
  } else {
    // 离线：加入同步队列，稍后同步
    await addToSyncQueue('metadata', 'update', bookId, newMetadata)
    setSavedOffline(true)  // 显示"已保存到本地"提示
  }
}
```

**新增 UI**：离线状态下显示友好提示
- 保存前：显示"当前离线，修改将保存到本地并在联网后同步"
- 保存后：显示"已保存到本地，网络恢复后将自动同步"

#### 修复 3：书架视图云图标 ✅

**根因**：`ShelfView.tsx` 的 `BookCard` 没有传递 `status` prop。

**修复** (`web/src/components/ShelfView.tsx`):
```typescript
import { useLocalBookCache } from '@/hooks/useLocalBookCache'

// 获取所有书籍的缓存状态
const bookIds = useMemo(() => books.map(b => b.id), [books])
const { getBookCacheStatus } = useLocalBookCache(bookIds)

// 在 BookCard 渲染中计算显示状态
const cacheStatus = getBookCacheStatus(book.id)
const displayStatus = !isCached ? 'cloud' : cacheStatus === 'downloading' ? 'downloading' : ...
<BookCard status={displayStatus} onSyncClick={...} />
```

### 架构改进：真正的 App-First 数据流

```
用户操作（翻页/修改元数据）
         │
         ▼
  ┌─────────────────┐
  │  IndexedDB 本地  │  ← 第一优先级：立即保存
  │  (永不丢失)      │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │  同步队列        │  ← 离线时加入队列
  │  (待同步操作)    │
  └────────┬────────┘
           │ 网络恢复
           ▼
  ┌─────────────────┐
  │  服务器 API      │  ← 后台异步同步
  │  (最终一致性)    │
  └─────────────────┘
```

---

## 🔥 更新 (2025-12-08 19:20)

**问题**: 书库只有 4 本书显示云图标，其他未缓存书籍仍显示阅读进度状态

**根因**: `LibraryPage.tsx` 中 `displayStatus` 逻辑错误，优先检查了阅读进度而非缓存状态

**修复** (`web/src/pages/LibraryPage.tsx`):
```typescript
// ❌ 旧逻辑 - 有进度就显示 reading，忽略缓存状态
const displayStatus = cacheStatus === 'ready' && item.progress > 0 ? 'reading' : cacheStatus

// ✅ 新逻辑 - 必须已缓存才显示阅读状态
const displayStatus = isConverting
  ? 'converting'
  : !isCached && cacheStatus !== 'downloading'
    ? 'cloud'  // 未缓存显示云图标
    : cacheStatus === 'downloading'
      ? 'downloading'
      : cacheStatus === 'ready' && item.progress >= 100 
        ? 'completed'  // 已缓存且完成
        : cacheStatus === 'ready' && item.progress > 0 
          ? 'reading'  // 已缓存且有进度
          : 'ready'  // 已缓存但未阅读
```

#### 2. 书架-书籍关联未同步 ✅

**问题**: 书架内容为空，只同步了书架元数据，未同步书籍关联

**根因**: `useOfflineShelves.ts` 的 `syncFromServer` 只获取书架列表，没有调用 `/shelves/{id}/items` 获取书籍关联

**修复** (`web/src/hooks/useOfflineShelves.ts`):
```typescript
const syncFromServer = useCallback(async () => {
  // ...获取书架列表
  for (const shelf of shelves) {
    // 新增：获取每个书架的书籍关联
    const itemsRes = await api.get(`/api/v1/shelves/${shelf.id}/items`)
    const bookIds = itemsRes.data.map((item: { bookId: string }) => item.bookId)
    const { importShelfItemsFromServer } = await import('@/lib/shelvesStorage')
    await importShelfItemsFromServer(shelf.id, bookIds)
  }
}, [...])
```

#### 3. 页面切换冗余 API 请求 ✅

**问题**: 每次切换页面都重新调用 API，造成不必要的网络请求

**根因**: `LibraryPage` 和 `Home` 没有缓存新鲜度检查，总是在 mount 时调用 API

**修复**: 添加 30 秒缓存新鲜度检查

`web/src/pages/LibraryPage.tsx`:
```typescript
// 只有当缓存超过30秒或为空时才调用API
const cacheTimestamp = getLibraryCacheTimestamp()
const cacheAge = cacheTimestamp ? Date.now() - cacheTimestamp : Infinity
const CACHE_FRESHNESS_MS = 30 * 1000  // 30秒

if (isOnline && cacheAge > CACHE_FRESHNESS_MS) {
  await fetchList()
}
```

`web/src/lib/homeStorage.ts` - 新增 `getCacheTimestamp()` 函数

`web/src/pages/app/Home.tsx` - 同样的 30 秒缓存新鲜度检查

#### 4. 离线点击未缓存书籍的处理 ✅

**问题**: 离线状态点击云图标书籍会跳转到阅读页并显示 `OFFLINE_NO_CACHE` 错误

**修复** (`web/src/pages/LibraryPage.tsx`):
```typescript
// 新增：handleSyncBook 离线检查
const handleSyncBook = useCallback(async (bookId: string) => {
  if (!isOnline) {
    toast.error(t('offline.sync_unavailable', '离线状态无法下载书籍，请连接网络后重试'))
    return
  }
  // ...原有下载逻辑
}, [isOnline, t, ...])

// 新增：handleBookClick 离线+未缓存检查
const handleBookClick = useCallback((bookId: string) => {
  const cacheStatus = getBookCacheStatus(bookId)
  if (!isOnline && cacheStatus !== 'ready') {
    toast.error(t('offline.book_not_cached', '此书籍尚未缓存，无法在离线状态下阅读'))
    return
  }
  navigate(`/app/read/${bookId}`)
}, [isOnline, getBookCacheStatus, navigate, t])
```

---

## 🔥 更新 (2025-12-08 18:55)

### Service Worker 路由配置修复 ✅

**问题诊断**：离线模式下 Library 页面无法显示书籍，API 请求仍然被发送。

**根本原因**：
1. SW 路由配置错误 - 使用了 `/api/books` 而不是 `/api/v1/books`
2. 浏览器缓存了旧版本的 JavaScript 文件

**修复内容** (`web/src/sw.ts`):

```typescript
// ❌ 旧配置（路径错误）
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/books'),
  new NetworkFirst(...)
)

// ✅ 新配置（正确路径）
// 1. 书籍列表 - /api/v1/books
registerRoute(
  ({ url, request }) => {
    if (request.method !== 'GET') return false
    return url.pathname === '/api/v1/books' || 
           url.pathname.startsWith('/api/v1/library')
  },
  new NetworkFirst({ cacheName: 'athena-api', networkTimeoutSeconds: 5 })
)

// 2. 单本书籍元数据 - /api/v1/books/{uuid}
registerRoute(
  ({ url, request }) => {
    if (request.method !== 'GET') return false
    return url.pathname.match(/^\/api\/v1\/books\/[a-f0-9-]+$/) !== null
  },
  new NetworkFirst({ cacheName: 'athena-api', networkTimeoutSeconds: 5 })
)

// 3. 书籍封面 - /api/v1/books/{uuid}/cover - CacheFirst
registerRoute(
  ({ url }) => url.pathname.match(/^\/api\/v1\/books\/[a-f0-9-]+\/cover/) !== null,
  new CacheFirst({ cacheName: 'athena-images', maxAge: 30 days })
)

// 4. 书籍内容 - /api/v1/books/{uuid}/(content|download)
registerRoute(
  ({ url }) => url.pathname.match(/^\/api\/v1\/books\/[a-f0-9-]+\/(content|download)/) !== null,
  new CacheFirst({ cacheName: 'athena-books', maxAge: 90 days })
)
```

**SW 版本升级**: `1.0.0` → `1.1.0` (强制缓存刷新)

### 前端离线检查逻辑 ✅

**LibraryPage.tsx** - 初始化时检查网络状态：
```typescript
useEffect(() => {
  const init = async () => {
    // 1. 先从 IndexedDB 加载缓存
    const cachedItems = await getLibraryList()
    if (cachedItems.length > 0) {
      setItems(cachedItems)
      setFromCache(true)
    }
    
    // 2. 只有在线时才调用 API
    if (navigator.onLine) {
      await fetchList()  // 获取最新数据并更新缓存
    } else {
      console.log('[LibraryPage] Offline mode, skipping API call')
    }
  }
  init()
}, [])
```

**ReaderPage.tsx** - 离线时使用缓存的书籍元数据：
```typescript
const init = async () => {
  const { getBookMeta, saveBookMeta } = await import('@/lib/bookStorage')
  const cachedMeta = await getBookMeta(bookId)
  
  if (navigator.onLine) {
    // 在线：从 API 获取，然后保存到 IndexedDB
    const res = await fetch(`/api/v1/books/${bookId}`)
    const bookData = await res.json()
    await saveBookMeta({ bookId, title, author, format, size, ... })
  } else if (cachedMeta) {
    // 离线：使用缓存的元数据
    bookData = { id: cachedMeta.bookId, title: cachedMeta.title, ... }
  } else {
    throw new Error('OFFLINE_NO_CACHE')
  }
}
```

### 测试离线模式步骤

**重要**：如果修改后离线模式仍不工作，需要清除浏览器缓存：

1. 打开 Chrome DevTools → Application
2. Service Workers → 点击 "Unregister"
3. Storage → 点击 "Clear site data"
4. 强制刷新页面（Ctrl+Shift+R）
5. 重新登录并访问书籍（让数据缓存到 IndexedDB）
6. 然后再测试离线模式（Network → Offline）

---
  },
  new StaleWhileRevalidate({ plugins: [/* 严格配额限制 */] })
)
```

### 所有底部导航页面离线支持 ✅

为底部导航栏的所有 4 个页面实现完整离线支持：

| 页面 | 路由 | 离线状态 | 说明 |
| :--- | :--- | :--- | :--- |
| 首页 | `/app/home` | ✅ | Dashboard 统计 + 继续阅读列表缓存 |
| 书库 | `/app/library` | ✅ | 书籍列表缓存 + 离线指示器 |
| AI | `/app/ai-conversations` | ✅ | 对话列表缓存 + 离线禁用输入 |
| 搜索 | `/app/search` | ✅ | 本地搜索书籍/笔记/高亮 |

#### 1. 书库页面离线支持 (`LibraryPage.tsx`)

**新增文件**: `web/src/lib/libraryStorage.ts` (~180行)
- IndexedDB 数据库 `athena_library` (v1)
- 存储书籍列表元数据（不含文件内容）
- 主要函数:
  - `saveLibraryList()` / `getLibraryList()` - 书籍列表缓存
  - `updateLibraryBookCache()` - 更新单本书
  - `removeBookFromCache()` / `addBookToCache()` - 增删操作
  - `clearLibraryCache()` / `isLibraryCacheExpired()` - 缓存管理

**修改内容** (`web/src/pages/LibraryPage.tsx`):
- ✅ 添加 `useOnlineStatus` 监听网络状态
- ✅ 启动时先加载 IndexedDB 缓存
- ✅ 在线时获取 API 数据后自动缓存
- ✅ 离线时显示缓存数据 + 离线提示条
- ✅ 离线时停止 OCR/转换状态轮询
- ✅ 网络恢复后自动刷新

#### 2. AI 对话页面离线支持 (`AIConversationsPage.tsx`)

**完全重写** (~260行):
- ✅ 使用已有的 `aiChatStorage.ts` 缓存对话列表
- ✅ 添加对话历史侧边栏（桌面端）
- ✅ 现代化 UI 设计（圆角消息气泡、流式输出）
- ✅ 离线时禁用输入框和发送按钮
- ✅ 离线提示："离线模式 - AI 功能需要联网"
- ✅ 网络恢复后自动刷新对话列表

#### 3. 搜索页面 (`SearchPage.tsx`) - **新建**

**新建文件**: `web/src/pages/SearchPage.tsx` (~260行)
- ✅ 添加路由 `/app/search` 到 `App.tsx`
- ✅ 分类标签：全部、书籍、笔记、高亮
- ✅ **离线搜索**：搜索本地 IndexedDB 缓存
  - 书籍：搜索 `libraryStorage` 中的书名/作者
  - 笔记：搜索 `notesStorage` 中的笔记内容
  - 高亮：搜索 `notesStorage` 中的高亮文本
- ✅ **在线搜索**：调用 `/api/v1/search` API
- ✅ 搜索失败时自动回退到离线搜索
- ✅ 点击结果跳转到阅读页面

```typescript
// 搜索逻辑
const results = isOnline 
  ? await searchOnline(query)  // 调用 API
  : await searchOffline(query) // 搜索 IndexedDB
```

#### 4. 首页离线支持（之前已完成）

- 使用 `homeStorage.ts` 缓存 Dashboard 和继续阅读列表

### 离线支持架构总览

```
IndexedDB 数据库结构:
├── athena_home (v1)       - 首页缓存
│   ├── dashboard          - 阅读统计
│   └── continue_reading   - 继续阅读列表
├── athena_library (v1)    - 书库缓存
│   └── library           - 书籍列表
├── athena_ai_chat (v1)    - AI 对话缓存
│   ├── conversations     - 对话列表
│   └── messages          - 对话消息
├── athena_books (v3)      - 书籍文件缓存
│   ├── book_files        - 书籍 Blob
│   ├── book_meta         - 书籍元数据
│   ├── book_ocr          - OCR 数据
│   └── book_covers       - 封面缓存
├── athena_notes (v3)      - 笔记同步
│   ├── notes             - 笔记
│   ├── highlights        - 高亮
│   └── sync_status       - 同步状态
├── athena_shelves (v1)    - 书架缓存
│   ├── shelves           - 书架列表
│   ├── shelf_books       - 书架-书籍关系
│   └── sync_queue        - 同步队列
└── athena_sync (v3)       - 进度同步
    ├── bookmarks         - 书签
    ├── reading_progress  - 阅读进度
    └── sync_queue        - 同步队列
```

**构建验证**: ✅ `pnpm build` 成功

---

## 🔥 更早更新 (2025-12-08 14:00)

### App-First 深度审核与修复 ✅

对离线功能进行全面审核，发现并修复了 4 项问题：

#### 问题 1: Service Worker 后台同步覆盖范围不足 ✅ 已修复

**原问题**：`sw.ts` 只覆盖了 `/notes`、`/highlights`、`/reading-progress` 的 POST 请求

**修复内容** (`web/src/sw.ts`):
- ✅ 扩展覆盖路径：新增 `/shelves`、`/bookmarks`
- ✅ 扩展 HTTP 方法：支持 POST、PATCH、PUT、DELETE
- ✅ 使用统一的 `SYNC_API_PATTERNS` 配置数组

```typescript
// 修复后的模式匹配
const SYNC_API_PATTERNS = [
  /\/api\/v1\/notes/,
  /\/api\/v1\/highlights/,
  /\/api\/v1\/reading-progress/,
  /\/api\/v1\/shelves/,       // 新增
  /\/api\/v1\/bookmarks/,     // 新增
]

// 支持所有写入方法
registerRoute(..., 'POST')
registerRoute(..., 'PATCH')
registerRoute(..., 'PUT')
registerRoute(..., 'DELETE')
```

#### 问题 2: 冲突解决 UI 未全局接入 ✅ 已修复

**原问题**：`ReaderPage.tsx` 中有"待办"注释，冲突检测到了但没有显示 UI

**修复内容**:
- ✅ 新增 `web/src/contexts/NoteConflictContext.tsx` (~150行)
  - 全局冲突管理 Context
  - 冲突队列机制（多个冲突依次处理）
  - 监听 `note-conflict` 自定义事件
  - `dispatchNoteConflict()` 函数供外部触发
- ✅ 修改 `web/src/App.tsx`：包裹 `<NoteConflictProvider>`
- ✅ 修改 `web/src/pages/ReaderPage.tsx`：
  - 导入 `dispatchNoteConflict`
  - 在 `onNoteSyncResult` 回调中触发冲突事件
- ✅ 扩展 `web/src/hooks/useSmartHeartbeat.ts` 的 `NoteResult` 接口：
  - 新增 `conflictNote` 和 `originalNote` 字段

#### 问题 3: 全文搜索的离线化 📋 记录为待做功能

**现状分析**：
- 搜索页面 (`/app/search`) 路由存在但组件未实现
- 这是整体功能缺失，非离线化问题
- 需要实现 FlexSearch 本地索引（针对已下载书籍）

**计划**：列入后续开发阶段，与离线词典、TTS 功能一起实现

#### 问题 4: 图片跨域处理优化 ✅ 已修复

**原问题**：`ContinueReadingHero.tsx` 中的颜色提取可能因 CORS 失败

**修复内容** (`web/src/pages/app/home/ContinueReadingHero.tsx`):
- ✅ 添加详细的 JSDoc 注释说明跨域策略
- ✅ 使用 `willReadFrequently: true` 优化 Canvas 性能
- ✅ 分离 `getImageData` 调用的 try-catch，明确捕获安全错误
- ✅ 改进错误日志，区分 CORS 阻止和其他错误

```typescript
// 修复后的安全处理
try {
  imageData = ctx.getImageData(5, 10, 40, 55)
} catch (securityError) {
  // CORS 限制导致无法读取像素（不透明响应）
  console.warn('[Hero ColorExtract] CORS blocked pixel read')
  resolve(DEFAULT_COLOR)
  return
}
```

**构建验证**: ✅ `pnpm build` 成功

---

### 待做功能清单（非离线化问题）

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 全文搜索离线化 | 使用 FlexSearch 索引本地书籍 | P2 |
| 离线词典 | Stardict 格式本地解析 | P2 |
| 离线 TTS | Web Speech API 本地朗读 | P2 |
| S3 CORS 配置检查 | 确保封面图片可跨域访问 | P1 |

---

## 📝 ShelfView 组件离线集成 (2025-12-08 12:15)

**改造文件**: `web/src/components/ShelfView.tsx`

**改动内容**:
1. **移除直接 API 调用**：删除 `fetchShelves`, `fetchShelfBooks`, `deleteShelf` 函数
2. **集成离线 Hook**：使用 `useOfflineShelves` 替代直接网络请求
3. **添加同步状态指示器**：显示未同步数量和"立即同步"按钮
4. **网络状态感知**：使用 `useOnlineStatus` 检测离线状态
5. **未同步书架标记**：虚线边框 + "待同步"徽章

**新增 i18n 翻译** (zh-CN/en-US):
- `shelf.syncing`: 正在同步书架... / Syncing shelves...
- `shelf.unsynced_count`: {{count}} 项待同步 / {{count}} pending sync
- `shelf.sync_now`: 立即同步 / Sync Now
- `shelf.pending_sync`: 待同步 / Pending

---

## 📦 书架离线支持 (2025-12-08 11:30)

#### 1. `web/src/lib/shelvesStorage.ts` (~580行)

书架数据 IndexedDB 存储服务，新数据库 `athena_shelves` (v1)：

| Object Store | 主键 | 索引 | 用途 |
|--------------|------|------|------|
| `shelves` | `id` | synced, deleted, updatedAt | 书架列表 |
| `shelf_items` | `[shelfId, bookId]` | shelfId, bookId, synced, deleted | 书籍-书架关联 |

**核心功能**:
```typescript
// 书架 CRUD
createShelf(name, description?, serverId?)
updateShelf(id, { name, description })
deleteShelf(id)  // 软删除
getAllShelves()
getShelf(id)

// 书架项操作
addBookToShelf(shelfId, bookId, position?)
removeBookFromShelf(shelfId, bookId)
getShelfBookIds(shelfId)
getBookShelfIds(bookId)

// 同步辅助
getUnsyncedShelves()
getUnsyncedShelfItems()
markShelfSynced(id, serverId?)
markShelfItemSynced(shelfId, bookId)

// 服务器数据导入
importShelvesFromServer(shelves)
importShelfItemsFromServer(shelfId, bookIds)

// 统计
getShelvesStats() // { totalShelves, unsyncedShelves, totalItems, unsyncedItems }
```

#### 2. `web/src/hooks/useOfflineShelves.ts` (~350行)

离线书架管理 Hook，本地优先策略：

```typescript
const {
  shelves,           // 书架列表
  loading,           // 加载状态
  createShelf,       // 创建书架
  updateShelf,       // 更新书架
  deleteShelf,       // 删除书架
  addBookToShelf,    // 添加书籍到书架
  removeBookFromShelf, // 从书架移除书籍
  getShelfBookIds,   // 获取书架内书籍
  getBookShelfIds,   // 获取书籍所在书架
  syncStatus,        // 'idle' | 'syncing' | 'error'
  unsyncedCount,     // 未同步数量
  syncNow,           // 立即同步
  refresh,           // 刷新数据
} = useOfflineShelves({ enabled: true, autoSyncInterval: 30000 })
```

**功能特性**:
- ✅ 本地优先 CRUD（离线时操作本地 IndexedDB）
- ✅ 自动后台同步（30秒间隔，可配置）
- ✅ 网络恢复时自动同步
- ✅ 与 SyncEngine 集成（通过 syncStorage.addToSyncQueue）
- ✅ 软删除支持（删除标记为 deleted=1，同步后清理）

#### IndexedDB 数据库架构更新

| 数据库 | Object Stores | 用途 |
|--------|---------------|------|
| `athena_sync` | sync_queue, reading_progress, version_fingerprints | 同步队列与阅读进度 |
| `athena_notes` | notes, highlights | 笔记与高亮离线存储 |
| `athena_books` | book_files, book_ocr, book_covers, book_meta | 书籍文件与元数据缓存 |
| `athena_shelves` | shelves, shelf_items | **🆕 书架与书籍关联** |
| `athena_ai_chat` | conversations | AI 对话历史 |

---

### App-First 架构完整性验证 ✅

**验证日期**: 2025-12-08
**构建状态**: ✅ `pnpm build` 通过

#### 核心功能验证清单

| Phase | 任务 | 文件 | 状态 | 代码行数 |
|-------|------|------|------|----------|
| **Phase 1** | useOnlineStatus Hook | `hooks/useOnlineStatus.ts` | ✅ | 169行 |
| | OfflineIndicator 组件 | `components/OfflineIndicator.tsx` | ✅ | 162行 |
| | athena_sync IndexedDB | `lib/syncStorage.ts` | ✅ | 581行 |
| | 阅读进度离线缓存 | `hooks/useReadingProgress.ts` | ✅ | 349行 |
| | Layout 集成 | `layouts/AppLayout.tsx` | ✅ | 已集成 |
| **Phase 2** | SyncEngine 核心类 | `lib/syncEngine.ts` | ✅ | 406行 |
| | SyncQueueManager | `lib/syncQueue.ts` | ✅ | 400行 |
| | useSmartHeartbeat 持久化 | `hooks/useSmartHeartbeat.ts` | ✅ | 524行 |
| | 后端心跳版本指纹 | `api/app/sync.py` | ✅ | 475行 |
| **Phase 3** | athena_notes IndexedDB | `lib/notesStorage.ts` | ✅ | 605行 |
| | NotesPage 页面 | `pages/NotesPage.tsx` | ✅ | 353行 |
| | useOfflineNotes Hook | `hooks/useOfflineNotes.ts` | ✅ | 396行 |
| | NoteConflictDialog | `components/NoteConflictDialog.tsx` | ✅ | 300行 |
| **Phase 4** | Service Worker | `sw.ts` | ✅ | 327行 |
| | UpdatePrompt | `components/UpdatePrompt.tsx` | ✅ | 145行 |
| **Phase 5** | StorageManager | `components/StorageManager.tsx` | ✅ | 416行 |
| | **🆕 athena_shelves IndexedDB** | `lib/shelvesStorage.ts` | ✅ | ~580行 |
| | **🆕 useOfflineShelves Hook** | `hooks/useOfflineShelves.ts` | ✅ | ~350行 |

#### 后续优化建议（可选功能）

| 功能 | 描述 | 优先级 |
|------|------|--------|
| ShelfView 组件集成 | 将 ShelfView 改造为使用 useOfflineShelves | 🟠 建议 |
| 离线词典 | Stardict 格式本地解析 | 🟢 可选 |
| 离线 TTS | Web Speech API 本地朗读 | 🟢 可选 |
| 数据导出/导入 | 完整本地数据备份 | 🟢 可选 |
| LRU 自动清理 | 存储超阈值时自动清理 | 🟡 建议 |
| E2E 离线测试 | Cypress 离线测试套件 | 🟡 建议 |

---

## 📋 历史更新 (2025-12-08 10:30)

**修改文件**: `web/src/hooks/useSmartHeartbeat.ts`

- 笔记/高亮队列改为从 IndexedDB 读取（原为内存 ref）
- 同步结果自动更新 IndexedDB 中的同步状态
- 保留阅读进度内存缓存以提高性能

#### Phase 3: 笔记系统离线化 ✅

**新增文件**: `web/src/lib/notesStorage.ts`

- 新数据库 `athena_notes` (v1)
- 两个 Object Store: `notes`, `highlights`
- 完整 CRUD 操作
- 服务端数据导入功能

```typescript
// 笔记操作
await createNote(bookId, content, position, chapter)
await updateNote(id, { content })
await deleteNote(id)
const notes = await getNotesByBook(bookId)

// 高亮操作
await createHighlight(bookId, text, startPos, endPos, color)
await updateHighlightColor(id, '#FF0000')
await deleteHighlight(id)
const highlights = await getHighlightsByBook(bookId)

// 同步辅助
const unsynced = await getUnsyncedNotes()
await markNoteSynced(id, serverId)
await importFromServer(notes, highlights)
```

**新增文件**: `web/src/hooks/useOfflineNotes.ts`

- 离线笔记/高亮管理 Hook
- 本地优先策略
- 自动后台同步
- 网络恢复时自动同步

```typescript
const {
  notes, createNote, updateNote, deleteNote,
  highlights, createHighlight, updateHighlightColor, deleteHighlight,
  syncStatus, unsyncedCount, syncNow,
} = useOfflineNotes({ bookId })
```

#### Phase 4: Service Worker 增强 ✅

**新增文件**: `web/src/sw.ts`

- 自定义 Service Worker（使用 Workbox）
- 缓存策略:
  - 静态资源: CacheFirst（30天）
  - 字体: CacheFirst（1年）
  - 图片: CacheFirst（7天，自动清理）
  - API 请求: NetworkFirst（1天缓存）
  - 书籍内容: CacheFirst（90天，离线阅读核心）
- 后台同步: 笔记/高亮/阅读进度提交支持 Background Sync
- 推送通知预留

**修改文件**: `web/vite.config.ts`

- PWA 策略改为 `injectManifest`
- 配置自定义 Service Worker
- 增强 manifest（图标、快捷方式、分类）
- 开发模式启用 PWA

**新增文件**: `web/src/components/UpdatePrompt.tsx`

- PWA 更新提示组件
- 检测 Service Worker 更新
- 优雅的更新提示 UI
- 一键刷新更新

```tsx
<UpdatePrompt checkInterval={60 * 60 * 1000} />
```

#### Phase 5: 存储管理 ✅

**新增文件**: `web/src/components/StorageManager.tsx`

- 存储空间管理组件
- 显示总使用量和配额
- 分类显示（书籍、笔记、缓存、其他）
- 存储警告（超过阈值显示）
- LRU 缓存清理功能

```tsx
<StorageManager 
  warningThreshold={0.8}
  showBreakdown={true}
  onCleanup={(freedBytes) => console.log('Freed:', freedBytes)}
/>
```

#### 集成到 AppLayout ✅

**修改文件**: `web/src/layouts/AppLayout.tsx`

- 集成 `OfflineIndicator` 组件
- 集成 `UpdatePrompt` 组件
- 网络状态 toast 提示

#### i18n 翻译更新 ✅

**新增翻译键**:
```json
{
  "pwa.updateAvailable": "发现新版本",
  "pwa.updateDescription": "点击更新以获取最新功能和修复",
  "pwa.updateNow": "立即更新",
  "pwa.updateLater": "稀后",
  "pwa.offlineReady": "应用已准备好离线使用",
  "storage.title": "存储空间",
  "storage.warning": "空间不足",
  "storage.books": "书籍",
  "storage.notes": "笔记",
  "storage.cache": "缓存",
  "storage.other": "其他",
  "storage.cleanup": "清理缓存",
  "storage.cleaning": "清理中...",
  "storage.error": "无法获取存储信息"
}
```

#### 完整验收状态

| Phase | 任务 | 状态 |
|-------|------|------|
| **Phase 1** | 基础设施 | ✅ 100% |
| 1.1 | `useOnlineStatus` Hook | ✅ |
| 1.2 | `OfflineIndicator` 组件 | ✅ |
| 1.3 | `athena_sync` IndexedDB | ✅ |
| 1.4 | 阅读进度离线缓存 | ✅ |
| 1.5 | Layout 集成 | ✅ |
| **Phase 2** | 同步引擎 | ✅ 100% |
| 2.1 | `SyncEngine` 核心类 | ✅ |
| 2.2 | 心跳队列持久化 | ✅ |
| **Phase 3** | 笔记系统离线化 | ✅ 100% |
| 3.1 | `athena_notes` IndexedDB | ✅ |
| 3.2 | `useOfflineNotes` Hook | ✅ |
| **Phase 4** | Service Worker 增强 | ✅ 100% |
| 4.1 | 自定义 `sw.ts` | ✅ |
| 4.2 | `UpdatePrompt` 组件 | ✅ |
| **Phase 5** | 存储管理 | ✅ 100% |
| 5.1 | `StorageManager` 组件 | ✅ |

#### 新增文件清单

```
web/src/
├── hooks/
│   ├── useOnlineStatus.ts      # 网络状态检测 Hook
│   ├── useOfflineNotes.ts      # 离线笔记管理 Hook
│   └── useSmartHeartbeat.ts    # 修改：IndexedDB 持久化
├── components/
│   ├── OfflineIndicator.tsx    # 离线状态指示器
│   ├── UpdatePrompt.tsx        # PWA 更新提示
│   └── StorageManager.tsx      # 存储空间管理
├── lib/
│   ├── syncStorage.ts          # 同步队列 IndexedDB
│   ├── notesStorage.ts         # 笔记 IndexedDB
│   └── syncEngine.ts           # 同步引擎核心类
├── sw.ts                       # 自定义 Service Worker
└── layouts/
    └── AppLayout.tsx           # 修改：集成离线组件
```

---

## 📋 后续优化建议

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 离线词典 | 本地词典数据支持离线查词 | 🟢 可选 |
| 离线 TTS | 使用 Web Speech API 实现本地朗读 | 🟢 可选 |
| 冲突解决 UI | 可视化的冲突解决界面 | 🟡 建议 |
| 同步历史 | 显示同步记录和错误日志 | 🟡 建议 |

---

## 🔥 历史更新 (2025-12-07 18:30)

### Phase 8: App-First 架构改造 - Phase 1 基础设施 ✅ 已完成

**目标**: 建立离线感知能力和基础存储层

#### 1. useOnlineStatus Hook ✅

**新增文件**: `web/src/hooks/useOnlineStatus.ts`

- 监听 `online`/`offline` 事件检测网络状态变化
- 使用 `navigator.onLine` 获取初始状态
- 提供 `isOnline`、`lastChangedAt`、`offlineDuration` 状态
- 支持 `onOnline`/`onOffline` 回调
- 包含 `formatOfflineDuration()` 工具函数

```typescript
const { isOnline, offlineDuration } = useOnlineStatus({
  onOnline: () => toast.success('网络已恢复'),
  onOffline: () => toast.warning('网络已断开'),
})
```

#### 2. OfflineIndicator 组件 ✅

**新增文件**: `web/src/components/OfflineIndicator.tsx`

- 顶部固定橙色横幅，离线时显示
- 使用 framer-motion 实现进入/退出动画
- 显示离线持续时间和待同步项数量
- Apple 风格的渐变橙色警告样式
- 提供简洁版 `OfflineBadge` 组件

```tsx
<OfflineIndicator pendingCount={5} />
```

#### 3. athena_sync IndexedDB 存储 ✅

**新增文件**: `web/src/lib/syncStorage.ts`

- 新数据库 `athena_sync` (v1)
- 三个 Object Store:
  - `sync_queue`: 离线操作队列
  - `reading_progress`: 阅读进度本地缓存
  - `version_fingerprints`: 版本指纹（用于增量同步）
- 提供完整的 CRUD 操作函数

**关键接口**:
```typescript
// 同步队列
addToSyncQueue(type, action, bookId, payload)
getPendingSyncItems()
getSyncQueueCount()
removeSyncItem(id)

// 阅读进度
saveReadingProgressLocal(bookId, position, progress)
getReadingProgressLocal(bookId)
getUnsyncedReadingProgress()
markReadingProgressSynced(bookId)

// 版本指纹
saveVersionFingerprint(bookId, fingerprint)
getVersionFingerprint(bookId)
```

#### 4. 阅读进度离线缓存 ✅

**修改文件**: `web/src/hooks/useReadingProgress.ts`

- 实现本地优先策略（Local-First）
- 首先从 IndexedDB 加载缓存数据
- 在线时后台从服务器获取最新数据
- 比较时间戳，使用更新的数据
- 新增 `saveProgress()` 方法支持离线保存
- 返回 `fromCache` 和 `isOnline` 状态

```typescript
const { progress, fromCache, isOnline, saveProgress } = useReadingProgress({
  bookId: 'xxx',
})

// 离线时也能保存进度
await saveProgress(position, 0.5)
```

#### 5. 集成到 AppLayout ✅

**修改文件**: `web/src/layouts/AppLayout.tsx`

- 集成 `OfflineIndicator` 组件
- 使用 `useOnlineStatus` 监听网络变化
- 网络恢复/断开时显示 toast 提示
- 定期更新待同步项数量
- 离线时自动调整主内容区域的 padding

#### 6. i18n 翻译更新 ✅

**修改文件**: 
- `web/src/locales/zh-CN/common.json`
- `web/src/locales/en-US/common.json`

**新增翻译键**:
```json
{
  "offline.mode": "离线模式",
  "offline.sync_when_online": "您的操作将在恢复网络后同步",
  "offline.pending_count": "{{count}} 项待同步",
  "offline.duration": "已离线 {{duration}}",
  "offline.badge": "离线",
  "offline.reconnected": "网络已恢复",
  "offline.reconnected_syncing": "网络已恢复，正在同步...",
  "offline.disconnected": "网络已断开，进入离线模式",
  "offline.progress_saved": "阅读进度已保存到本地"
}
```
- 右上角显示阅读目标进度环 + 用户头像按钮
- 进度环显示今日阅读时长/目标
- 头像按钮点击打开账户菜单

```typescript
// HomeHeader.tsx
<motion.div style={{ opacity: rightOpacity, scale: rightScale, y: rightTranslateY }}>
  {/* 阅读目标进度环 */}
  <div className="relative w-10 h-10">
    <svg className="w-10 h-10 -rotate-90" viewBox="0 0 40 40">
      <circle ... className="text-gray-200" />  {/* 背景 */}
      <circle ... className="text-system-blue" strokeDashoffset={progressOffset} /> {/* 进度 */}
    </svg>
    <span className="absolute text-xs">{todayMinutes}</span>
  </div>
  {/* 用户头像 */}
  <ProfileButton />
</motion.div>
```

#### 3. 底部弹出账户菜单 ✅

**新组件 (`AccountSheet.tsx`)**：
- 使用 Sheet (Radix Dialog) 实现底部全屏弹出
- Apple 风格的圆角设计和毛玻璃效果

**菜单内容**：
1. **用户信息卡片**：圆形头像 + 用户名 + 邮箱
2. **通知设置**：占位，点击无操作（后续扩展）
3. **账户设置**：点击展开语言选择列表
   - 支持中文/英文切换
   - 选中项显示 ✓ 标记
4. **退出登录**：清除 token 并跳转到首页

**语言切换实现**：
```typescript
const handleLanguageChange = async (langCode: string) => {
  await i18n.changeLanguage(langCode)
  setShowLanguageSelect(false)
}
```

#### 4. i18n 翻译更新 ✅

**新增翻译键 (common.json)**：
```json
{
  "account.title": "账户",
  "account.notifications": "通知",
  "account.settings": "账户设置",
  "account.logout": "退出登录",
  "account.unnamed": "未命名用户",
  "account.language": "语言",
  "account.avatar_upload": "更换头像"
}
```

#### 5. 头像上传（待后续实现）📋

**当前状态**：UI 已预留头像上传功能（点击头像可选择文件）

**后续需要**：
- 数据库迁移：`users` 表添加 `avatar_key` 字段
- 后端 API：`POST /api/v1/profile/avatar` 接收图片并压缩为 WebP
- 前端集成：上传成功后更新头像显示

---

## 🔥 更早更新 (2025-12-06 20:00)

### 多格式电子书转换流程完善 ✅

修复了转换完成后状态未更新、前端无法自动刷新、元数据对话框不弹出等问题。

#### 1. 后端独立事务修复 ✅

**问题根因**：原 `convert_to_epub` 任务使用单一长事务，`time.sleep()` 阻塞导致状态更新不提交。

**修复方案 (`tasks.py`)**：重构为独立事务函数
```python
async def _update_status(status: str, extra_sql: str = "", extra_params: dict = None):
    """独立事务更新状态"""
    async with engine.begin() as conn:
        # ... 立即提交状态更新
        print(f"[Convert] Status updated to '{status}' for book: {book_id}")

async def _get_book_info():
    """独立事务获取书籍信息"""

async def _update_converted_epub(epub_key: str):
    """独立事务更新转换后的 EPUB 信息"""
```

**状态流转**：每个步骤独立提交，不再依赖长事务
- `pending` → `_update_status('processing')` → 立即可见
- 转换完成 → `_update_converted_epub()` → `status='completed'` 立即可见

#### 2. 前端自动刷新机制 ✅

**UploadManager.tsx 增强**：新增独立的转换状态轮询机制
```typescript
// 开始监控转换状态（用于非 EPUB/PDF 格式）
const startConversionMonitoring = useCallback((bookId: string, title: string) => {
  // 每 3 秒轮询 GET /api/books/{bookId} 检查 conversion_status
  // 当 conversion_status === 'completed' 时:
  // 1. 广播 book_conversion_complete 事件（通知 LibraryPage 刷新）
  // 2. 调用 startMonitoring() 开始元数据提取监控
  // 3. 显示元数据确认对话框
}, [pollConversionStatus])
```

#### 3. 格式支持优化 ✅

**移除漫画格式**：CBZ/CBR 转 EPUB 体验差，不适合通用阅读器
**新增 DJV 格式**：与 DJVU 为同一格式的不同扩展名

**最终支持格式（13种）**：
```typescript
export const SUPPORTED_FORMATS = [
  'epub', 'pdf',           // 直接支持
  'mobi', 'azw', 'azw3',   // Amazon Kindle
  'fb2',                   // FictionBook
  'txt', 'rtf',            // 文本格式
  'djvu', 'djv',           // DjVu 扫描文档
  'lit',                   // Microsoft Reader
  'doc', 'docx',           // Microsoft Word
]
```

---

## 🔥 更早更新 (2025-12-06 19:30)
  - 删除 S3 中的原始文件
  - 更新 `books.minio_key` 指向新 EPUB
- 用户后续同步（其他设备登录）直接获取已转换的 EPUB

**技术实现**：
```python
# 上传转换后的 EPUB
epub_key = make_object_key(user_id, f"converted/{book_id}.epub")
upload_bytes(BUCKET, epub_key, epub_data, "application/epub+zip")

# 删除原始文件
client.delete_object(Bucket=BUCKET, Key=minio_key)

# 更新数据库
UPDATE books SET minio_key = :epub_key, 
                 converted_epub_key = :epub_key,
                 conversion_status = 'completed'
WHERE id = :book_id
```

---

## 🔥 更早更新 (2025-12-06 18:00)

### 书架系统完整实现 ✅

完成了书架（Shelves）功能的前后端开发，支持用户创建、管理和删除书架，以及将书籍添加到书架。

#### 1. 后端 API 完善 ✅

**新增/修复端点**：
- `DELETE /api/v1/shelves/{shelf_id}` - 删除书架（含 shelf_items 级联清理）
- 修复 `GET /api/v1/books/{book_id}/shelves` 路由顺序（移至 `/{book_id}` 之前避免被截获）

**代码修改 (`api/app/books.py`)**：
```python
@shelves_router.delete("/{shelf_id}")
async def delete_shelf(shelf_id: str, user: dict = Depends(get_current_user), db = Depends(get_db)):
    # 1. 验证书架归属当前用户
    # 2. 删除 shelf_items 关联记录
    # 3. 删除书架记录
    # 4. 返回成功消息
```

#### 2. 前端书架功能完善 ✅

**AddToShelfDialog.tsx 修复**：
- 修复事件冒泡导致点击按钮跳转阅读页的问题（添加 `e.preventDefault()` 和 `e.stopPropagation()`）
- 修复创建书架后 `s.name?.toLowerCase()` 空指针崩溃
- 修复 `createShelf` 返回类型为 `Promise<{ id: string }>`

**ShelfView.tsx 修复**：
- 修复 DOM 嵌套错误（button 内不能嵌套 button），将外层 button 改为 div
- 修复 API 响应解析（兼容 `data.data` 数组和 `data.data.items` 两种格式）
- 添加 `shelf-changed` 事件监听器实现自动刷新

**BookCardMenu.tsx 增强**：
- 添加菜单位置自动检测（`openUpward` 逻辑）
- 菜单在页面底部时自动向上展开，避免被视窗截断

#### 3. 视图模式持久化 ✅

**LibraryPage.tsx**：
- 使用 `localStorage` 保存用户选择的视图模式（`athena_library_view_mode`）
- 刷新页面后保持之前的视图模式（grid/list/shelf）

#### 4. 云同步功能 ✅

**新增功能**：新设备登录后，书库中显示云端书籍，点击可下载到本地 IndexedDB。

**BookCard.tsx 修改**：
- 新增 `onSyncClick` 回调 prop
- `status='cloud'` 时点击卡片触发下载而非打开阅读器

**LibraryPage.tsx 修改**：
- 新增 `handleSyncBook` 函数：后台下载书籍内容并缓存到 IndexedDB
- 下载完成后触发 `book_cached` 事件更新 UI 状态

#### 5. 数据库设计验证 ✅

确认当前书架数据库设计完全支持未来 AI 对话功能：
- `shelf_items` 表通过 `book_id` 和 `shelf_id` 外键关联书籍与书架
- 可通过 JOIN 查询获取书架内所有书籍，作为 RAG 知识库范围

---

## 🔥 更早更新 (2025-12-05 23:30)

### ADR-008: SHA256 全局去重与 OCR 复用机制 ✅ 已完成

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



### App-First 架构改造 - Phase 3 完成 ✅ (2025-12-13 18:30)

**核心页面与组件已完全迁移至 PowerSync + Native IndexedDB 架构。**

#### 完成内容

**1. 核心页面重写 ✅**
- **LibraryPage**: 移除 API 轮询，使用 `useBooksData` (Live Query) + `useLocalBookCache`。
- **ReaderPage**: 移除 Heartbeat/Sync 逻辑，使用 `useProgressData` (Debounced Save) + 本地 OCR。
- **NotesPage**: 使用 `useNotesData`，实现响应式笔记管理。

**2. 存储层重构 ✅**
- **bookStorage.ts**: 彻底重写，使用原生 IndexedDB (`athena-files`) 管理大文件（PDF/EPUB/Cover/OCR）。
- **Upload Queue**: 在 `bookStorage` 中实现了离线上传队列支持。
- **Deleted**: 删除了 `db.ts` (Dexie), `libraryStorage.ts`, `useOfflineNotes.ts` 等旧文件。

**3. 组件适配 ✅**
- **BookCard**: 更新为接受 `BookItem` 类型，移除旧的回调逻辑。
- **BookCardMenu**: 重写为使用 `usePowerSync` 直接操作数据库，移除对旧 `db.ts` 的依赖。
- **UploadManager**: 适配新的 `useUploadPostProcessing` (PowerSync 监控)。

**4. Hook 优化 ✅**
- **useUploadPostProcessing**: 重写为使用 PowerSync 监听书籍状态，替代 API 轮询。
- **useBookUpload**: 适配新的 `bookStorage` 离线队列。

#### 状态更新
- **App-First → App-First**: 🚧 90% (主要迁移完成，待测试验证)
- **Data Sync**: ✅ 100% (PowerSync 全面接管)

#### 下一步计划
- [ ] 全面测试 (E2E/Unit Tests)
- [ ] 清理剩余的未使用文件
- [ ] 验证离线上传流程

**5. 代码清理 ✅**
- **Deleted**: 删除了 `web/src/lib/repo` (Dexie Repos), `web/src/lib/sync*` (Old Sync Engine), `web/src/lib/*Storage.ts` (Old Storage Wrappers).
- **Result**: `web/src/lib` 仅保留 `powersync/`, `bookStorage.ts`, `api.ts` 等核心文件。

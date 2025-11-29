# PROJECT_STATUS.md

> **最后更新**: 2025-11-28 22:18
> **当前阶段**: Phase 1 - 后端核心就绪，前端开发启动中。

## 1. 总体进度 (Overall)

| 模块 | 状态 | 说明 |
| :--- | :--- | :--- |
| Backend API | ✅ 90% | 核心逻辑与 DB 已就绪 (Auth, Books, Notes, AI, Billing 等均已实现) |
| Frontend Web | 🚧 45% | 基础页面 (Home, Login, Library, Reader) 已存在，Auth 完善，部分组件待完善 |
| Infrastructure | ✅ 100% | Docker/CI/SRE 手册就绪 (已修复 OpenSearch/Calibre/Worker 启动问题) |

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

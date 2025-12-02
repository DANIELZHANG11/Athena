# PROJECT_STATUS.md

> **最后更新**: 2025-12-02 10:15
> **当前阶段**: Phase 3 - UI/UX 优化与书籍处理 ✅ 进行中

## 1. 总体进度 (Overall)

| 模块 | 状态 | 说明 |
| :--- | :--- | :--- |
| Backend API | ✅ 95% | 核心逻辑与 DB 已就绪, OCR/Embedding 服务升级完成, PP-OCRv5 + BGE-M3 已集成 |
| Frontend Web | ✅ 91% | Auth ✅, Upload ✅, BookCard ✅, Library ✅, Reader ✅, UI 优化 ✅, 横向卡片进度显示修复 ✅ |
| Infrastructure | ✅ 100% | Docker/CI/SRE 手册就绪, OpenSearch 中文插件已安装, Worker GPU 加速已配置 |

---

## 🔥 最新更新 (2025-12-02 10:15)

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


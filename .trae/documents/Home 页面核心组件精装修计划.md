## 文件结构
- 新建 `web/src/pages/app/home/` 目录
- 组件：`HomeHeader.tsx`、`ReadingGoalCard.tsx`、`ContinueReadingList.tsx`
- 页面：`Home.tsx` 作为组装入口（保留现有路径），仅导入并排布上述组件

## 数据与接口
- Dashboard：`GET /api/v1/home/dashboard`（已就绪）用于日目标进度、周视图与年度统计
- 继续阅读：`GET /api/v1/reader/progress` 获取书籍进度与 `last_location`（用于列表与进度条）
- 创建 `useDashboard()` 与 `useReadingProgress()` 两个 Hook，封装加载态、错误态与刷新

## 组件实现
- HomeHeader
  - 大标题区：`framer-motion` 基于 `useScroll` + `useTransform`，下滚时大标题淡出
  - 顶栏小标题：在页面滚动阈值后淡入，文本来自 `t('reading_now.title')`
  - 右侧头像：沿用 `AppLayout` 顶栏右侧 Avatar 位，保持一致
- ReadingGoalCard
  - 卡片样式：`rounded-2xl`、`shadow-md`、`bg-secondary-background`、`border-separator`
  - 圆环进度：`SVG` 圆环 + `stroke-dasharray` 动画，数值来自 `dashboard.today.minutes / goals.daily_minutes`
  - 空态：进度为 0 显示 `t('reading_goal.adjust')` 按钮（触发目标设置入口）
- ContinueReadingList
  - 横向滚动：`overflow-x-auto` + `scroll-snap-x mandatory` 容器；子项 `scroll-snap-align: start`
  - 卡片：封面（圆角、阴影）、进度条（细线）、书名；点击进入阅读或上传
  - 空态：虚线边框占位卡，显示 `t('library.import_first')`，点击触发上传流程

## 样式规范
- 严禁硬编码颜色；使用 `figma.css` 变量与 utilities：`bg-system-background`、`bg-secondary-background`、`border-separator`、`text-label`、`text-secondary-label`
- 圆角：`rounded-2xl`；阴影：`shadow-sm/shadow-md`；安全区：底部 `padding-bottom: env(safe-area-inset-bottom)`

## 国际化键
- `reading_now.title`、`reading_goal.adjust`、`library.import_first`
- 加入到 `web/src/locales/en-US/common.json` 与 `zh-CN/common.json`，页面所有文案使用 `t('key')`

## 交互与动效
- 标题淡入淡出曲线：`cubic-bezier(0.22, 1, 0.36, 1)`（与规范一致）
- 圆环进度初次挂载与值变更时平滑过渡
- 列表滑动具备滚动捕捉与无抖动体验

## 组装与布局
- `Home.tsx` 内按顺序排布：`HomeHeader` → `ReadingGoalCard` → `ContinueReadingList`
- 使用 `max-w-6xl mx-auto px-4` 容器与 `gap-6` 控制层级与间距

## 加载与错误
- 首次加载：显示简单占位（后续在指令 3 替换为 Skeleton）
- 错误：展示 `toast` 或轻量提示，避免打断主流程

## 验收
- 移动端浏览器测试滚动阈值与动效流畅度
- 检查暗/明模式、Safe Area、色彩 Token 与 i18n 覆盖率
- 组件边界与无数据空态是否符合规范
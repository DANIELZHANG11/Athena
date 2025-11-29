# 06_UI_UX_Design_System.md

> **版本**：v2.1 (Industry Standard Refined)
> **SSOT**：`web/src/styles/figma.css` 是 Design Tokens 的代码实现源；本文档是设计规范的真理源。任何样式开发必须遵循本文档。

## 1. 设计哲学 (Design Philosophy)
*   **静谧的智慧 (Quiet Intelligence)**：界面应像空气一样存在，仅在用户需要时提供感知，绝不喧宾夺主。
*   **内容优先 (Content-First)**：阅读体验是核心，UI 只是容器。
*   **按需浮现 (On-Demand)**：复杂的工具（如 AI 面板、标注工具）仅在特定上下文中（如选中文字时）浮现。

## 2. Design Tokens (核心变量)
**开发指令**：所有 CSS 属性值必须引用以下变量，**严禁**使用 Hex/RGB 硬编码。

### 2.1 色彩系统 (Colors)
*映射自 `web/src/styles/figma.css`*

| Token Name | Light Value | Dark Value | 用途说明 |
| :--- | :--- | :--- | :--- |
| `--color-system-blue` | `#007AFF` | `#0A84FF` | **主交互色** (按钮、链接、选中态) |
| `--color-system-green` | `#34C759` | `#30D158` | 成功、安全、正面反馈 |
| `--color-system-red` | `#FF3B30` | `#FF453A` | 错误、删除、危险操作 |
| `--color-system-purple`| `#5856D6` | `#5E5CE6` | **AI 专属品牌色** (Loading、光标) |
| `--system-background` | `#FFFFFF` | `#000000` | 应用底层背景 |
| `--secondary-background`| `#F2F2F7` | `#1C1C1E` | 侧边栏、卡片、列表项 |
| `--tertiary-background` | `#FFFFFF` | `#2C2C2E` | 输入框、模态框内部容器 |
| `--color-label` | `rgba(0,0,0,0.85)` | `rgba(255,255,255,0.85)` | 一级标题、正文 |
| `--color-secondary-label`| `rgba(60,60,67,0.6)` | `rgba(235,235,245,0.6)` | 说明文案、副标题 |

> **[待补充] 阅读器高亮色板 (需在 figma.css 中新增)**
> *   `--highlight-yellow`: `#FFCC00` (Idea/Insight)
> *   `--highlight-green`: `#34C759` (Fact/Data)
> *   `--highlight-blue`: `#007AFF` (Quote/Beautiful)

### 2.2 排版 (Typography)
*   **UI Font Stack**:
    `--font-ui`: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", sans-serif;
*   **Reader Font Stack** (阅读器专用):
    *   Default: `Source Serif 4`
    *   Fallback: `Noto Serif SC`
*   **[强制] 中文标点规范**：
    所有界面文案必须使用 **英文半角标点** (`, . : ; ? !`)，并在标点后加空格。
    *   ✅ `阅读, 聆听, 发现.`
    *   ❌ `阅读，聆听，发现。`

### 2.3 质感与特效 (Effects)
*   **Liquid Glass (核心视觉特征)**:
    *   **参数**: `backdrop-filter: blur(24px) saturate(180%)`
    *   **应用场景**: 顶部导航栏 (Sticky Header)、侧边栏 (Sidebar)、浮动工具栏 (Toolbar)。
    *   **降级策略**: 在不支持 backdrop-filter 的设备上，回退到 `opacity: 0.95` 的纯色背景。
*   **圆角 (Radius)**:
    *   `--radius`: `10px` (标准容器)
    *   `full`: (按钮、胶囊标签)

### 2.4 动效 (Motion)
*   **Easing**: `cubic-bezier(0.22, 1, 0.36, 1)` (Apple 风格的自然回弹)。
*   **Duration**:
    *   Fast: `150ms` (Hover, Click)
    *   Medium: `300ms` (Panel Slide, Modal Fade)

### 2.5 智能配色 (Adaptive Colors)
*   **封面反色策略**: 对于叠加在书籍封面上的图标（如 Cloud, Check），必须计算图片主色调亮度 (Luminance)。
    *   L > 0.5 (浅色封面) -> 图标使用深色半透明 (`rgba(0,0,0,0.6)`).
    *   L <= 0.5 (深色封面) -> 图标使用浅色半透明 (`rgba(255,255,255,0.8)`).
    *   技术实现推荐: `colorthief` 或 `fast-average-color`.

### 2.6 间距系统 (Spacing)
*遵循 4px 栅格系统，保证视觉呼吸感。*
*   `--space-xs`: `4px` (紧凑间距)
*   `--space-s`: `8px` (组件内间距)
*   `--space-m`: `16px` (默认间距)
*   `--space-l`: `24px` (区块间距)
*   `--space-xl`: `32px` (页面边缘)

### 2.7 层级规范 (Z-Index Scale)
*解决层叠冲突，严禁使用任意数字 (如 z-9999)。*
*   `z-0`: 默认层级
*   `z-10`: **Elevated** (悬浮卡片, Dropdown)
*   `z-40`: **Sticky** (顶部导航栏, 侧边栏)
*   `z-50`: **Overlay** (Contextual Toolbar, 遮罩层)
*   `z-100`: **Modal** (对话框, 抽屉)
*   `z-200`: **Toast** (全局通知)

## 3. 组件规范 (Component Specs)

### 3.1 已有基础组件 (Base Components)
*直接复用 `web/src/components/ui/` 下的组件*

*   **Button**:
    *   `variant="default"`: `bg-system-blue text-white hover:opacity-90 rounded-full`
    *   `variant="ghost"`: `text-system-blue hover:bg-secondary-background rounded-lg`
*   **Input**:
    *   `bg-tertiary-background focus:ring-2 ring-system-blue border-none`
    *   **Error State**: `ring-2 ring-system-red bg-system-red/5` (错误时边框变红，背景微红)

### 3.2 业务核心组件 (Business Components)
*需按此规范开发*

*   **Contextual AI Toolbar (上下文工具栏)**
    *   **触发**: 用户在阅读器选中文本时。
    *   **外观**: 黑色 (`#1C1C1E`) 胶囊状悬浮条，白色图标。
    *   **功能**: [Sparkles] 摘要 | [FileText] 笔记 | [Languages] 翻译。
*   **AI Chat Panel (对话面板)**
    *   **流式效果**: 必须实现打字机效果 (Typewriter Effect)。
    *   **光标**: 尾部跟随闪烁的 `system-purple` 光标。
    *   **引用**: `[1]` 角标需可点击，跳转至正文高亮处。
*   **书籍卡片体系 (Book Card System)**
    基于 Apple Books 风格的响应式卡片组，支持多种状态与自适应配色。

    **1. Hero Card (继续阅读/最近阅读)**
    *   **场景**: 首页顶部“继续阅读”区域。**仅展示未读完的书籍**。
    *   **尺寸 (Mobile)**: 高度 `160px`，宽度 `100%`。
    *   **视觉构造**:
        *   **背景**: **动态模糊 (Ambient Blur)**。提取封面主色调进行 `blur-3xl` + `opacity-30` 处理。
        *   **封面**: 左侧 2:3 比例，圆角 `6px`，**阴影 `shadow-lg` (强调悬浮感)**。
        *   **云状态 (Cloud State)**:
            *   若未下载，封面中心显示 `Cloud` 图标。
            *   **智能反色**: 图标颜色基于封面平均亮度自动计算 (Light Cover -> `text-black/60`, Dark Cover -> `text-white/80`)。
        *   **元数据**: 右侧垂直排列，Title (`font-bold`), Author (`text-secondary-label`), Info ("图书 · 25%").
        *   **操作**: 右下角 `MoreHorizontal`。

    **2. List Item Card (列表/历史)**
    *   **场景**: 书架列表模式。
    *   **布局**: Flex Row，底部带分割线。
    *   **封面**: 固定宽 `80px`，高 `120px`，圆角 `4px`，**阴影 `shadow-sm`**。
    *   **状态标识**:
        *   **未下载**: 封面右上角小 `Cloud` 图标 (智能反色)。
        *   **已读完**: 右侧元数据区显示绿色/灰色 "已读完" 文本，进度条隐藏。
        *   **阅读中**: 显示进度条与百分比。

    **3. Grid Standard Card (书架网格)**
    *   **场景**: 书架网格模式 (竖向卡片)。
    *   **尺寸**: 宽度自适应 (约 `100px - 120px`)，高度自适应。
    *   **视觉构造**:
        *   **封面**: 2:3 比例，圆角 `8px`，**阴影 `shadow-md`**。
        *   **云状态**: 同 Hero Card，封面中心显示智能反色 `Cloud` 图标。
        *   **底部信息**:
            *   左下角: 
                *   阅读中: 显示进度百分比 (e.g. "25%")。
                *   已读完: 显示 "已读完" (文本或 Check 图标)。
            *   右下角: `MoreHorizontal` 图标 (点击唤起菜单)。

    **4. Grid Micro Card (年度/成就)**
    *   **场景**: “年度已读”小格子。
    *   **尺寸**: 紧凑型 Grid，纯封面。
    *   **样式**:
        *   **阴影**: `shadow-sm`。
        *   **状态**: 右下角固定显示蓝色实心 `Check` 图标 (表示已完成)。

## 4. 移动端与 PWA 适配 (Mobile & PWA)

### 4.1 移动端优先 (Mobile First)
*   **断点 (Breakpoints)**:
    *   `md` (768px): 平板/桌面分界线。`< md` 为移动端视图，`>= md` 为桌面视图。
*   **触达区域 (Touch Targets)**: 所有交互元素的点击热区必须 **≥ 44x44px**。
*   **导航模式**:
    *   Mobile: Bottom Tab Bar (图标+标签)。
    *   Desktop: Left Sidebar (图标+标签)。

### 4.2 PWA 离线体验
*   **Service Worker**: 必须缓存应用 Shell (HTML/CSS/JS) 和已下载的书籍资源。
*   **离线指示器**: 当检测到网络断开时：
    1.  应用变为 **灰度模式 (Grayscale)** 或顶部显示 "Offline Mode" 橙色条。
    2.  所有需联网操作 (AI, Upload) 按钮置灰，点击提示 "离线不可用"。

## 5. 图标系统 (Iconography)

**库**: 必须使用 `lucide-react`，统一 `stroke-width={1.5}` (常规) 或 `2` (强调)。

| 语义 | 图标组件 (Lucide) | 备注 |
| :--- | :--- | :--- |
| **AI / 智能** | `Sparkles` | 必须使用紫色渲染 |
| **书库 / 阅读** | `Library` / `BookOpen` | - |
| **同步 / 下载** | `Cloud` / `CloudDownload` | - |
| **笔记 / 生成** | `FileText` | - |
| **更多操作** | `MoreHorizontal` | 严禁使用三个点图片 |
| **菜单** | `Menu` | 移动端左上角 |

## 6. 质量门禁 (Quality Gates)
*   **A11Y**: 所有组件必须通过 `axe-core` 扫描，无 Serious/Critical 级错误。
*   **对比度**: 文本与背景对比度 ≥ 4.5:1 (WCAG AA)。
*   **代码检查**: 禁止在 TSX/JSX 中写死 Hex 颜色值（如 `className="bg-[#F5F5F5]"`），必须使用 Tailwind 类名（如 `bg-secondary-background`）。


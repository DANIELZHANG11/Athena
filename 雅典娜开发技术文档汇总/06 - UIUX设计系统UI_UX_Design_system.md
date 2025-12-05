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

*   **Button (按钮系统)**:
    所有按钮必须遵循以下规范，确保在明亮/暗黑模式下均可见且易于交互。

    | 变体 | 样式 | 应用场景 |
    | :--- | :--- | :--- |
    | `primary` | `bg-system-blue text-white shadow-md hover:opacity-90 rounded-full font-medium` | 主要操作 (上传、保存、确认) |
    | `secondary` | `bg-secondary-background text-label border border-separator hover:bg-tertiary-background rounded-full` | 次要操作 (取消、返回) |
    | `ghost` | `text-system-blue hover:bg-system-blue/10 rounded-lg` | 文字链接式按钮 |
    | `destructive` | `bg-system-red text-white hover:opacity-90 rounded-full` | 危险操作 (删除) |
    | `icon` | `p-2 rounded-full hover:bg-secondary-background transition-colors` | 纯图标按钮 |

    **[重要] 可见性规范**:
    *   主要按钮必须有 `shadow-md` 阴影确保在浅色背景下可见。
    *   图标按钮必须有 `hover` 状态反馈。
    *   所有按钮点击热区 ≥ 44x44px (移动端)。

*   **Input**:
    *   `bg-tertiary-background focus:ring-2 ring-system-blue border-none`
    *   **Error State**: `ring-2 ring-system-red bg-system-red/5` (错误时边框变红，背景微红)

*   **Modal / Dialog (弹出对话框)**:
    **[重要] 毛玻璃效果规范** - 所有弹出层必须使用白色毛玻璃效果，禁止黑色透明背景。

    | 属性 | 值 | 说明 |
    | :--- | :--- | :--- |
    | 遮罩层 | `bg-black/20 backdrop-blur-sm` | 轻微半透明 + 模糊 |
    | 内容容器 (Light) | `bg-white/95 backdrop-blur-xl shadow-2xl border border-gray-200/50` | 白色毛玻璃 + 强阴影 |
    | 内容容器 (Dark) | `bg-gray-900/95 backdrop-blur-xl shadow-2xl border border-white/10` | 深色毛玻璃 |
    | 圆角 | `rounded-2xl` | 16px 圆角 |
    | 动效 | `animate-in fade-in-0 zoom-in-95 duration-200` | **从中心由小变大 + 淡入** |

    **[强制] 弹窗动效规范**:
    *   所有弹窗必须有 **缩放进入动效** (从 95% 放大到 100%)。
    *   缩放原点：`transform-origin: center` (Modal) 或 `transform-origin: top right` (Dropdown)。
    *   时长：`200ms`，缓动函数：`cubic-bezier(0.22, 1, 0.36, 1)`。

*   **Dropdown Menu (下拉菜单)**:
    | 属性 | 值 | 说明 |
    | :--- | :--- | :--- |
    | 容器 | `bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl shadow-2xl border rounded-xl` | 与 Modal 统一风格 |
    | 动效 | `animate-menu-expand` | **从触发点位置由小变大展开** |
    | 方向 | `transform-origin: top right` | 从右上角展开 |

    **视觉效果**: 所有弹出层应有明显的悬浮感，使用统一的白色毛玻璃风格。

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

    **1. Horizontal Card (横向阅读卡片) [重要更新 - Apple Books 风格]**
    *   **场景**: 首页"继续阅读"区域、"之前阅读"列表。
    *   **尺寸**: 高度 `100px - 120px`，宽度自适应 (最小 `280px`)。
    *   **视觉构造 (重要)**:
        *   **布局比例**: **封面占 1/4 宽度，内容区占 3/4 宽度** (严禁改变此比例)。
        *   **封面区 (左侧 25%)**:
            *   2:3 比例封面图，圆角 `8px`，**阴影 `shadow-lg`**。
            *   完全靠左显示，无内边距。
        *   **背景区 (右侧 75%)**:
            *   **Ambient Blur 效果**: 从封面图片提取主色调，或将封面某区域放大后 `blur-3xl` 处理。
            *   渐变覆盖: 从左侧透明到右侧半透明白/黑 (`from-transparent to-white/20`)。
        *   **文字区 (覆盖在背景上)**:
            *   **智能反色文字**: 根据背景亮度自动切换 (浅背景用深色字，深背景用浅色字)。
            *   Title: `font-semibold text-base`，最多 2 行。
            *   Author: `text-sm opacity-80`，最多 1 行。
            *   Progress: `text-xs opacity-60`，显示 "25%" 或 "已读完"。
        *   **进度条**: 底部细线进度条 (`h-0.5`)，颜色为 `system-blue`。
    *   **技术实现**:
        *   使用 `fast-average-color` 提取封面主色调。
        *   计算亮度公式: `L = (0.299*R + 0.587*G + 0.114*B) / 255`。
        *   L > 0.5 时文字用深色，L <= 0.5 时文字用浅色。
    *   **动效**: `hover:scale-[1.02]`，`transition-transform duration-200`。

    **2. Hero Card (首页大卡片)**
    *   继承 Horizontal Card 规范，但尺寸更大 (高度 `160px`)。
    *   增加更多按钮 (`MoreHorizontal`) 在右下角。

    **3. List Item Card (列表/历史) [重要更新 - Horizontal Style]**
    *   **场景**: 书架列表模式、"之前阅读"列表。
    *   **布局**: 采用 Horizontal Card 风格 (Ambient Blur 背景 + 1/4 封面)。
    *   **尺寸**: 高度 `100px`，宽度自适应。
    *   **文字规范**:
        *   **Title**: `font-semibold text-base`，单行显示，**禁止省略号** (使用 `overflow-hidden whitespace-nowrap`)。
        *   **Author**: `text-sm opacity-80`，单行显示，**禁止省略号**。
    *   **视觉构造**:
        *   与 Horizontal Card 一致，但作为列表项使用。
        *   **封面**: 2:3 比例，圆角 `8px`，`shadow-lg`。
        *   **背景**: 动态提取封面主色调 + Ambient Blur。

    **3. Grid Standard Card (书架网格) [重要更新]**
    *   **场景**: 书架网格模式 (竖向卡片)。
    *   **尺寸**: 宽度自适应 (约 `100px - 120px`)，高度自适应。
    *   **视觉构造**:
        *   **封面**: 2:3 比例，圆角 `8px`，**阴影 `shadow-md` (强制)**。
        *   **云状态**: 同 Hero Card，封面中心显示智能反色 `Cloud` 图标。
        *   **底部信息 (覆盖在封面上)**:
            *   **取消书名显示**: 不在卡片下方显示书名和作者。
            *   左下角: 显示进度百分比 (e.g. "25%")，白色文字带半透明黑色背景。
            *   右下角: `MoreHorizontal` 图标 (白色，点击唤起单本书籍操作菜单)。
        *   **底部渐变遮罩**: `bg-gradient-to-t from-black/60 to-transparent`，确保文字可读。
    *   **阴影规范**: 所有书籍卡片必须有 `shadow-md` 阴影，增强层次感。

    **4. Grid Micro Card (年度/成就)**
    *   **场景**: "年度已读"小格子。
    *   **尺寸**: 紧凑型 Grid，纯封面。
    *   **样式**:
        *   **阴影**: `shadow-sm`。
        *   **状态**: 右下角固定显示蓝色实心 `Check` 图标 (表示已完成)。

    **5. Processing Card (处理中状态) [NEW]**
    *   **场景**: 书籍正在转换格式 (Calibre) 或正在 OCR 识别时显示。
    *   **尺寸**: 与 Grid Standard Card 完全相同 (保持布局一致性)。
    *   **视觉构造**:
        *   **背景**: 灰色渐变 (`from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-600`)。
        *   **脉冲动效**: `animate-pulse` - 像心跳一样的呼吸灯效果。
        *   **状态文本**: 卡片中央显示 "正在处理..." 或 "正在转换..." 文本。
        *   **图标**: 顶部显示 `Loader2` 旋转图标。
    *   **动效参数**:
        *   `animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite`
        *   亮度在 100% 和 75% 之间循环。
    *   **适用状态**:
        *   `processing`: 通用处理中
        *   `converting`: Calibre 格式转换中
        *   `ocr`: OCR 文字识别中

    **6. Dedup Card (秒传成功状态) [NEW - ADR-007]**
    *   **场景**: SHA256 全局去重命中，秒传成功时短暂显示。
    *   **尺寸**: 与 Grid Standard Card 完全相同。
    *   **视觉构造**:
        *   **背景**: 绿色渐变 (`from-green-100 to-green-200 dark:from-green-900 dark:to-green-800`)。
        *   **图标**: 中央显示 `Zap` 或 `CheckCircle` 图标 (绿色)。
        *   **状态文本**: "秒传成功" 或 "文件已存在"。
        *   **动效**: 淡入后 1.5s 自动过渡到正常卡片状态。
    *   **用途**: 给用户视觉反馈，告知文件无需重新上传。

### 3.3 书籍卡片菜单 (Book Card Menu)

**⋮ 下拉菜单规范** - 书籍卡片右下角的更多操作菜单。

| 菜单项 | 图标 | 显示条件 | 说明 |
|-------|------|---------|------|
| 查看详情 | `Info` | 始终显示 | 查看书籍详细信息 |
| 编辑信息 | `Pencil` | 始终显示 | 修改书名和作者 |
| 添加到书架 | `FolderPlus` | 始终显示 | 添加到书架分类 |
| OCR 本书 | `ScanText` | `is_image_based && ocr_status !== 'completed'` | 触发 OCR 处理 |
| OCR 处理中 | `Loader2` (旋转) | `ocr_status === 'processing'` | 禁用状态，显示进度 |
| 删除 | `Trash2` | 始终显示 | **危险操作**，需二次确认 |

**删除确认对话框**:
```
┌─────────────────────────────────────────────────────────────────┐
│  🗑️ 确认删除                                                    │
│                                                                 │
│  确定要删除《{书名}》吗?                                          │
│                                                                 │
│  此操作将删除:                                                    │
│  • 您在本书中的所有笔记和高亮                                       │
│  • 您的阅读进度记录                                                │
│  • 书架分类关联                                                   │
│                                                                 │
│  ⚠️ 此操作无法撤销                                                │
│                                                                 │
│                                [取消]            [🗑️ 确认删除]   │
└─────────────────────────────────────────────────────────────────┘
```

**删除按钮样式**: `destructive` 变体 (`bg-system-red text-white`)

### 3.4 上传状态指示器 (Upload Status Indicator)

**上传流程状态机**:
```
idle → hashing → checking → uploading/dedup → completing → done
                    ↓              ↓
                  error          error
```

| 状态 | 图标 | 文案 | 进度条 |
|-----|------|------|-------|
| `idle` | - | - | - |
| `hashing` | `Loader2` (旋转) | "正在计算文件指纹..." | 不确定进度 |
| `checking` | `Search` | "正在检查文件..." | 不确定进度 |
| `uploading` | `Upload` | "正在上传... {percent}%" | 确定进度 |
| `dedup` | `Zap` | "秒传成功!" | 100% (绿色) |
| `completing` | `Loader2` (旋转) | "正在处理..." | 不确定进度 |
| `done` | `CheckCircle` | "上传完成" | 100% (绿色) |
| `error` | `XCircle` | "{错误信息}" | 红色 |

**秒传特殊效果**:
- 当检测到 `dedup_available: true` 时，跳过上传步骤
- 显示 `Zap` 闪电图标 + "秒传成功!" 文案
- 进度条直接跳到 100%，使用绿色填充
- 0.5s 后自动进入 `completing` 状态

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


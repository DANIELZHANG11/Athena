## 目标
- 将 Lucide Icons 设为唯一官方图标库；在《UI/UX设计系统 v4.0》4.3节建立完整“图标系统 (Iconography)”规范。
- 全文对齐：用精确的 Lucide 名称替换所有模糊图标描述；更新组件契约为 lucide-react。

## 修订点位（锚点）
- 视觉元素章节：`### 第四章：视觉元素`（约行1605）
- 现有 `#### 4.3 图标`（1617–1619）扩展为完整规范与示例。
- 需替换的模糊描述位置：165/168/169（云图标）、1749（魔法棒/星火）、1750（文档+星火）、3067（汉堡/上下文）、5919（更多操作）。

## 4.3 图标系统（扩展草案）
- 官方指定库：仅使用 Lucide Icons；全平台统一。
- 核心原则：清晰性、一致性（描边统一）、有意义（语义明确）。
- 尺寸：`--icon-size-s:16px`（行内/紧凑）、`--icon-size-m:24px`（导航/主要按钮）、`--icon-size-l:32px`（空状态/标题）。
- 描边：统一 `stroke-width="2"`；特殊情况需在组件规范单独注明。
- 颜色（最高法则：克制与一致，强制版）：
  - 默认（95%场景）：`color: currentColor`，由父文本决定（通常 `var(--color-label)` 或 `var(--color-secondary-label)`），自然融入黑/白/灰文本流。
  - 交互（可点击/选中）：`var(--color-system-blue)`，用于按钮图标与当前 Tab 项。
  - 特殊状态：危险/删除 → `var(--color-system-red)`；成功/完成 → `var(--color-system-green)`。
  - 品牌点缀（AI专属）：AI面板标题等少量场景可用 `var(--color-system-purple)`；必须克制、一致且有意义。
  - 强制禁令：严禁按“功能分类”随意赋色（如书库棕色、笔记黄色）；图标颜色仅反映“状态”，不反映“类别”。
- 集成示例（lucide-react）：
```tsx
import { Sparkles, Book, Globe, MoreHorizontal, Menu, Cloud } from 'lucide-react'

export function NavItem({ active, label }){
  return (
    <div className="nav-item">
      <Menu size={24} color={active ? 'var(--color-system-blue)' : 'currentColor'} />
      <span>{label}</span>
    </div>
  )
}
```
- 可访问性：统一以 Lucide 官方名称引用；提供 `aria-label` 并通过 i18n 管理。

## 全局替换映射
- 云图标 → `Cloud`（下载/云端状态）：替换 165/168/169。
- 魔法棒/星火 → `Sparkles`：替换 1749。
- 文档+星火 → `FileText`（如需强调生成则组合 `FileText` + `Sparkles`）：替换 1750。
- 汉堡菜单 → `Menu`：替换 3067。
- 上下文图标 → 语义选 `Book`（书籍上下文）或 `Layers`（多源上下文）：替换 3067。
- 更多操作 → `MoreHorizontal`（或竖排用 `MoreVertical`）：补充 5919。
- 地球（语言切换器，如有） → `Globe`：扫描并统一。

## 组件契约更新
- 统一声明 icon props 为 lucide-react：
  - `iconLeft?: ReactElement<LucideIcon>`，`iconRight?: ReactElement<LucideIcon>`；颜色/尺寸遵循图标系统。
  - 默认内置图标仅使用 Lucide 名称。

## 实施步骤
1. 扩展 4.3 节为完整 Iconography（含颜色最高法则与示例）。
2. 对上述行位进行精确替换为 Lucide 名称；新增缺失的“更多操作”明确指向 `MoreHorizontal/MoreVertical`。
3. 更新涉及图标的组件 Props 说明为 lucide-react 类型。
4. 自检：全文搜索确保无模糊说法残留；颜色规则与 Design Tokens/Apple HIG 一致。

## 交付物
- 更新后的《UI/UX设计系统》4.3 完整规范。
- v7.0 全文图标对齐完成，组件契约完成更新。

如确认此计划，我将按上述步骤提交具体修订。
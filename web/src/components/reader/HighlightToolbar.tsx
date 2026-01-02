/**
 * HighlightToolbar - 选中文字后的悬浮工具栏
 * 
 * Apple Books 风格设计:
 * - 黑色胶囊形状悬浮条
 * - 白色图标
 * - 颜色选择 + 笔记 + 复制 + 翻译
 * 
 * @see 06 - UIUX设计系统 - 3.2 Contextual AI Toolbar
 */

import { memo, useState, useCallback } from 'react'
import { FileText, Copy, Languages, Trash2, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { HIGHLIGHT_COLORS, type HighlightColor, DEFAULT_HIGHLIGHT_COLOR } from '@/lib/highlightColors'

export interface HighlightToolbarProps {
  /** 是否显示工具栏 */
  visible: boolean
  /** 工具栏位置 (相对于viewport) */
  position: { x: number; y: number }
  /** 选中的文本 */
  selectedText: string
  /** 是否已经是高亮 (显示删除按钮) */
  isExistingHighlight?: boolean
  /** 现有高亮的颜色 */
  existingColor?: HighlightColor
  /** 创建高亮回调 */
  onHighlight: (color: HighlightColor) => void
  /** 添加笔记回调 */
  onAddNote: () => void
  /** 复制文本回调 */
  onCopy: () => void
  /** 翻译回调 */
  onTranslate?: () => void
  /** 删除高亮回调 */
  onDelete?: () => void
  /** 更改高亮颜色回调 */
  onChangeColor?: (color: HighlightColor) => void
  /** 关闭工具栏 */
  onClose: () => void
}

/**
 * 颜色选择圆点
 */
const ColorDot = memo(function ColorDot({ 
  color, 
  isSelected, 
  onClick 
}: { 
  color: typeof HIGHLIGHT_COLORS[number]
  isSelected: boolean
  onClick: () => void 
}) {
  return (
    <button
      className={cn(
        'w-6 h-6 rounded-full transition-all duration-fast',
        'border-2 border-transparent',
        'hover:scale-110',
        isSelected && 'ring-2 ring-white ring-offset-1 ring-offset-transparent'
      )}
      style={{ backgroundColor: color.color }}
      onClick={onClick}
      aria-label={color.name}
      title={`${color.name} - ${color.meaning}`}
    />
  )
})

/**
 * 工具栏按钮
 */
const ToolbarButton = memo(function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  className,
}: {
  icon: typeof FileText
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      className={cn(
        'p-2 rounded-lg transition-colors duration-fast',
        'hover:bg-white/20',
        'text-white',
        className
      )}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Icon size={18} strokeWidth={1.5} />
    </button>
  )
})

/**
 * 高亮工具栏组件
 */
export const HighlightToolbar = memo(function HighlightToolbar({
  visible,
  position,
  selectedText,
  isExistingHighlight = false,
  existingColor,
  onHighlight,
  onAddNote,
  onCopy,
  onTranslate,
  onDelete,
  onChangeColor,
  onClose,
}: HighlightToolbarProps) {
  const [showColorPicker, setShowColorPicker] = useState(!isExistingHighlight)
  
  const handleColorClick = useCallback((colorId: HighlightColor) => {
    if (isExistingHighlight && onChangeColor) {
      onChangeColor(colorId)
    } else {
      onHighlight(colorId)
    }
    setShowColorPicker(false)
  }, [isExistingHighlight, onChangeColor, onHighlight])

  const handleCopy = useCallback(() => {
    onCopy()
    navigator.clipboard.writeText(selectedText)
    onClose()
  }, [selectedText, onCopy, onClose])

  if (!visible) return null

  // 计算位置 (确保不超出屏幕)
  const toolbarWidth = 280
  const toolbarHeight = 48
  const padding = 12
  
  let left = position.x - toolbarWidth / 2
  let top = position.y - toolbarHeight - padding
  
  // 边界检查
  if (left < padding) left = padding
  if (left + toolbarWidth > window.innerWidth - padding) {
    left = window.innerWidth - toolbarWidth - padding
  }
  if (top < padding) {
    top = position.y + padding // 显示在选区下方
  }

  return (
    <div
      className={cn(
        'fixed z-50',
        'bg-[#1C1C1E] rounded-full',
        'shadow-2xl',
        'flex items-center gap-1 px-2 py-1.5',
        'animate-in fade-in-0 zoom-in-95 duration-fast',
        'origin-bottom'
      )}
      style={{
        left: `${left}px`,
        top: `${top}px`,
      }}
      role="toolbar"
      aria-label="文本操作工具栏"
    >
      {/* 颜色选择器 */}
      {showColorPicker ? (
        <div className="flex items-center gap-1.5 px-1">
          {HIGHLIGHT_COLORS.map((color) => (
            <ColorDot
              key={color.id}
              color={color}
              isSelected={existingColor === color.id}
              onClick={() => handleColorClick(color.id)}
            />
          ))}
        </div>
      ) : (
        // 当前颜色指示器 (点击展开颜色选择)
        <button
          className="flex items-center gap-0.5 px-1 py-1 rounded-lg hover:bg-white/20 transition-colors"
          onClick={() => setShowColorPicker(true)}
        >
          <div
            className="w-5 h-5 rounded-full"
            style={{ backgroundColor: existingColor ? `var(--highlight-${existingColor})` : `var(--highlight-${DEFAULT_HIGHLIGHT_COLOR})` }}
          />
          <ChevronRight size={14} className="text-white/60" />
        </button>
      )}

      {/* 分隔线 */}
      <div className="w-px h-6 bg-white/20 mx-1" />

      {/* 操作按钮 */}
      <ToolbarButton
        icon={FileText}
        label="添加笔记"
        onClick={onAddNote}
      />
      
      <ToolbarButton
        icon={Copy}
        label="复制"
        onClick={handleCopy}
      />

      {onTranslate && (
        <ToolbarButton
          icon={Languages}
          label="翻译"
          onClick={onTranslate}
        />
      )}

      {/* 删除按钮 (仅已有高亮时显示) */}
      {isExistingHighlight && onDelete && (
        <>
          <div className="w-px h-6 bg-white/20 mx-1" />
          <ToolbarButton
            icon={Trash2}
            label="删除高亮"
            onClick={onDelete}
            className="text-red-400 hover:text-red-300"
          />
        </>
      )}
    </div>
  )
})

export default HighlightToolbar

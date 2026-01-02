/**
 * NoteEditor - 笔记编辑器组件
 * 
 * Apple Books 风格的笔记编辑界面:
 * - 毛玻璃 Sheet 从底部滑入
 * - 显示高亮的文本片段
 * - 简洁的文本编辑区域
 * - 颜色标签选择
 * 
 * @see 06 - UIUX设计系统 - Modal/Dialog 规范
 * @see 02 - 功能规格 - 2.4 Notes & Highlights
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { X, Check, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { 
  HIGHLIGHT_COLORS, 
  type HighlightColor, 
  DEFAULT_HIGHLIGHT_COLOR,
  getHighlightColorConfig 
} from '@/lib/highlightColors'
import { 
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

export interface NoteEditorProps {
  /** 是否显示编辑器 */
  open: boolean
  /** 关闭编辑器 */
  onClose: () => void
  /** 高亮的文本内容 */
  highlightedText?: string
  /** 现有笔记内容 (编辑模式) */
  existingNote?: string
  /** 现有高亮颜色 */
  existingColor?: HighlightColor
  /** 笔记ID (编辑模式) */
  noteId?: string
  /** 高亮ID (关联的高亮) */
  highlightId?: string
  /** 保存笔记回调 */
  onSave: (content: string, color: HighlightColor) => Promise<void>
  /** 删除笔记回调 */
  onDelete?: () => Promise<void>
  /** 是否正在保存 */
  isSaving?: boolean
}

/**
 * 颜色选择按钮
 */
function ColorButton({ 
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
      type="button"
      className={cn(
        'w-8 h-8 rounded-full transition-all duration-fast',
        'border-2',
        isSelected 
          ? 'border-label scale-110 shadow-md' 
          : 'border-transparent hover:scale-105'
      )}
      style={{ backgroundColor: color.color }}
      onClick={onClick}
      aria-label={color.name}
      title={`${color.name} - ${color.meaning}`}
    />
  )
}

/**
 * 笔记编辑器组件
 */
export function NoteEditor({
  open,
  onClose,
  highlightedText,
  existingNote = '',
  existingColor = DEFAULT_HIGHLIGHT_COLOR,
  noteId,
  highlightId: _highlightId,
  onSave,
  onDelete,
  isSaving = false,
}: NoteEditorProps) {
  const { t } = useTranslation('reader')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  const [content, setContent] = useState(existingNote)
  const [selectedColor, setSelectedColor] = useState<HighlightColor>(existingColor)
  const [isDeleting, setIsDeleting] = useState(false)

  const isEditMode = !!noteId || !!existingNote
  const colorConfig = getHighlightColorConfig(selectedColor)

  // 打开时重置状态
  useEffect(() => {
    if (open) {
      setContent(existingNote)
      setSelectedColor(existingColor)
      // 聚焦到文本区域
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }, [open, existingNote, existingColor])

  const handleSave = useCallback(async () => {
    if (isSaving) return
    try {
      await onSave(content, selectedColor)
      onClose()
    } catch (error) {
      console.error('[NoteEditor] Save failed:', error)
    }
  }, [content, selectedColor, onSave, onClose, isSaving])

  const handleDelete = useCallback(async () => {
    if (!onDelete || isDeleting) return
    setIsDeleting(true)
    try {
      await onDelete()
      onClose()
    } catch (error) {
      console.error('[NoteEditor] Delete failed:', error)
    } finally {
      setIsDeleting(false)
    }
  }, [onDelete, onClose, isDeleting])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Cmd/Ctrl + Enter 保存
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
    // Escape 关闭
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [handleSave, onClose])

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent 
        side="bottom" 
        className={cn(
          'h-auto max-h-[80vh]',
          'bg-white/95 dark:bg-gray-900/95',
          'backdrop-blur-xl',
          'border-t border-separator',
          'rounded-t-2xl',
          'px-4 pb-8 pt-4'
        )}
      >
        <SheetHeader className="mb-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="p-2 -ml-2 rounded-full hover:bg-hover-background transition-colors"
              onClick={onClose}
              aria-label={t('common.close', '关闭')}
            >
              <X size={20} className="text-secondary-label" />
            </button>
            
            <SheetTitle className="text-base font-semibold text-label">
              {isEditMode 
                ? t('notes.editNote', '编辑笔记')
                : t('notes.addNote', '添加笔记')
              }
            </SheetTitle>

            <button
              type="button"
              className={cn(
                'p-2 -mr-2 rounded-full transition-colors',
                content.trim() || highlightedText
                  ? 'hover:bg-system-blue/10 text-system-blue'
                  : 'text-secondary-label opacity-50 cursor-not-allowed'
              )}
              onClick={handleSave}
              disabled={isSaving || (!content.trim() && !highlightedText)}
              aria-label={t('common.save', '保存')}
            >
              {isSaving ? (
                <div className="w-5 h-5 border-2 border-system-blue border-t-transparent rounded-full animate-spin" />
              ) : (
                <Check size={20} />
              )}
            </button>
          </div>
        </SheetHeader>

        {/* 高亮文本预览 */}
        {highlightedText && (
          <div
            className={cn(
              'mb-4 p-3 rounded-lg',
              'border-l-4'
            )}
            style={{ 
              backgroundColor: colorConfig.backgroundColor,
              borderLeftColor: colorConfig.color 
            }}
          >
            <p className="text-sm text-label line-clamp-3">
              "{highlightedText}"
            </p>
          </div>
        )}

        {/* 颜色选择 */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-secondary-label">
            {t('notes.highlightColor', '高亮颜色')}:
          </span>
          <div className="flex gap-2">
            {HIGHLIGHT_COLORS.map((color) => (
              <ColorButton
                key={color.id}
                color={color}
                isSelected={selectedColor === color.id}
                onClick={() => setSelectedColor(color.id)}
              />
            ))}
          </div>
        </div>

        {/* 笔记输入区域 */}
        <div className="mb-4">
          <Textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('notes.placeholder', '写下你的想法...')}
            className={cn(
              'min-h-[120px] resize-none',
              'bg-tertiary-background',
              'border-none',
              'focus:ring-2 focus:ring-system-blue',
              'text-label placeholder:text-tertiary-label'
            )}
          />
          <p className="mt-2 text-xs text-tertiary-label text-right">
            {t('notes.saveHint', 'Ctrl + Enter 保存')}
          </p>
        </div>

        {/* 删除按钮 (编辑模式) */}
        {isEditMode && onDelete && (
          <div className="pt-4 border-t border-separator">
            <Button
              variant="ghost"
              className="w-full text-system-red hover:bg-system-red/10"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <div className="w-4 h-4 border-2 border-system-red border-t-transparent rounded-full animate-spin mr-2" />
              ) : (
                <Trash2 size={16} className="mr-2" />
              )}
              {t('notes.delete', '删除笔记')}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

export default NoteEditor

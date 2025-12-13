/**
 * BookMetadataDialog.tsx
 * 
 * 书籍元数据编辑对话框
 * 允许用户修改书籍标题、作者等信息
 * 
 * **离线优先**：
 * - 离线时保存到本地缓存并加入同步队列
 * - 在线时立即同步到服务器
 */

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { FileText, Loader2, X, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useBooksData } from '@/hooks/useBooksData'

interface BookMetadataDialogProps {
  bookId: string
  initialTitle: string
  initialAuthor?: string
  open: boolean
  onClose: () => void
  onSuccess?: (metadata: { title: string; author?: string }) => void
}

export default function BookMetadataDialog({
  bookId,
  initialTitle,
  initialAuthor,
  open,
  onClose,
  onSuccess,
}: BookMetadataDialogProps) {
  const { t } = useTranslation('common')
  const [title, setTitle] = useState(initialTitle)
  const [author, setAuthor] = useState(initialAuthor || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { updateBook } = useBooksData()

  // 重置表单当对话框打开时
  useEffect(() => {
    if (open) {
      setTitle(initialTitle)
      setAuthor(initialAuthor || '')
      setError(null)
    }
  }, [open, initialTitle, initialAuthor])

  const handleSave = async () => {
    if (!title.trim()) {
      setError(t('metadata.title_required'))
      return
    }

    setSaving(true)
    setError(null)

    const newMetadata = {
      title: title.trim(),
      author: author.trim() || undefined,
    }

    try {
      // 使用 PowerSync 更新 (本地写入，自动同步)
      await updateBook(bookId, newMetadata)

      console.log('[BookMetadataDialog] Updated book metadata:', bookId)

      onSuccess?.(newMetadata)
      onClose()
    } catch (e: any) {
      console.error('[BookMetadataDialog] Failed to save metadata:', e)
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 遮罩层 */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 对话框 */}
      <div
        className={cn(
          'relative w-full max-w-md',
          'bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl',
          'shadow-2xl border border-gray-200/50 dark:border-white/10',
          'rounded-2xl overflow-hidden',
          'animate-in fade-in-0 zoom-in-95 duration-fast'
        )}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-separator">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-system-blue/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-system-blue" />
            </div>
            <div>
              <h3 className="text-base font-bold text-label">{t('metadata.edit_title')}</h3>
              <p className="text-xs text-secondary-label">{t('metadata.edit_subtitle')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-secondary-background transition-colors"
          >
            <X className="w-5 h-5 text-secondary-label" />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-6 py-5 space-y-4">
          {/* 标题输入 */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-label">
              {t('metadata.field_title')} <span className="text-system-red">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('metadata.title_placeholder')}
              className={cn(
                'w-full px-4 py-3 rounded-xl',
                'bg-secondary-background text-label',
                'border border-separator',
                'focus:outline-none focus:ring-2 focus:ring-system-blue/50',
                'placeholder:text-tertiary-label'
              )}
            />
          </div>

          {/* 作者输入 */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-label">
              {t('metadata.field_author')}
            </label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder={t('metadata.author_placeholder')}
              className={cn(
                'w-full px-4 py-3 rounded-xl',
                'bg-secondary-background text-label',
                'border border-separator',
                'focus:outline-none focus:ring-2 focus:ring-system-blue/50',
                'placeholder:text-tertiary-label'
              )}
            />
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-system-red/10">
              <AlertTriangle className="w-4 h-4 text-system-red flex-shrink-0 mt-0.5" />
              <span className="text-sm text-system-red">{error}</span>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-separator flex gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className={cn(
              'flex-1 py-3 px-4 rounded-full',
              'bg-secondary-background text-label',
              'border border-separator',
              'font-medium text-sm',
              'hover:bg-tertiary-background transition-colors',
              'disabled:opacity-50'
            )}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className={cn(
              'flex-1 py-3 px-4 rounded-full',
              'bg-system-blue text-white',
              'font-medium text-sm',
              'hover:opacity-90 transition-opacity',
              'disabled:opacity-50',
              'flex items-center justify-center gap-2'
            )}
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

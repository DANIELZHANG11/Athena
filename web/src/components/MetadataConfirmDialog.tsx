/**
 * MetadataConfirmDialog - 书籍元数据确认对话框
 * 
 * 设计背景 (来自 PRD):
 * - 书籍的 title 和 author 会作为 AI 对话的上下文发送给上游模型
 * - 准确的元数据能显著提升 AI 回答的精准度
 * - 用户上传的可能不是书籍（私人资料），需要灵活处理
 */

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, AlertCircle, Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import api from '@/lib/api'

export interface BookMetadata {
  bookId: string
  title: string
  author: string
  extractedTitle?: string
  extractedAuthor?: string
  pageCount?: number
}

interface MetadataConfirmDialogProps {
  /** 是否显示对话框 */
  open: boolean
  /** 关闭对话框回调 */
  onOpenChange: (open: boolean) => void
  /** 书籍元数据 */
  metadata: BookMetadata | null
  /** 确认完成回调 */
  onConfirmed?: (metadata: BookMetadata) => void
  /** 跳过确认回调 */
  onSkipped?: () => void
}

export function MetadataConfirmDialog({
  open,
  onOpenChange,
  metadata,
  onConfirmed,
  onSkipped,
}: MetadataConfirmDialogProps) {
  const { t } = useTranslation('common')
  
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 初始化表单值
  useEffect(() => {
    if (metadata) {
      setTitle(metadata.extractedTitle || metadata.title || '')
      setAuthor(metadata.extractedAuthor || metadata.author || '')
      setError(null)
    }
  }, [metadata])

  const hasExtractedData = metadata?.extractedTitle || metadata?.extractedAuthor

  const handleConfirm = async () => {
    if (!metadata?.bookId) return

    setIsSubmitting(true)
    setError(null)

    try {
      await api.patch(`/books/${metadata.bookId}/metadata`, {
        title: title.trim() || undefined,
        author: author.trim() || undefined,
        metadata_confirmed: true,
      })

      onConfirmed?.({
        ...metadata,
        title: title.trim(),
        author: author.trim(),
      })
      onOpenChange(false)
    } catch (err) {
      console.error('[MetadataConfirmDialog] Failed to update metadata:', err)
      setError(t('metadata.error.update_failed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSkip = async () => {
    if (!metadata?.bookId) return

    setIsSubmitting(true)
    setError(null)

    try {
      // 标记为已确认但不更改内容
      await api.patch(`/books/${metadata.bookId}/metadata`, {
        metadata_confirmed: true,
      })
      onSkipped?.()
      onOpenChange(false)
    } catch (err) {
      console.error('[MetadataConfirmDialog] Failed to skip confirmation:', err)
      setError(t('metadata.error.skip_failed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            {t('metadata.dialog.title')}
          </DialogTitle>
          <DialogDescription>
            {t('metadata.dialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 提取状态提示 */}
          {hasExtractedData ? (
            <div className="flex items-start gap-2 p-3 bg-green-50 dark:bg-green-950/30 rounded-lg text-sm">
              <Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
              <span className="text-green-700 dark:text-green-300">
                {t('metadata.dialog.extracted_success')}
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg text-sm">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <span className="text-amber-700 dark:text-amber-300">
                {t('metadata.dialog.extracted_empty')}
              </span>
            </div>
          )}

          {/* 书名输入 */}
          <div className="space-y-2">
            <Label htmlFor="book-title">{t('metadata.field.title')}</Label>
            <Input
              id="book-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('metadata.placeholder.title')}
              disabled={isSubmitting}
            />
          </div>

          {/* 作者输入 */}
          <div className="space-y-2">
            <Label htmlFor="book-author">{t('metadata.field.author')}</Label>
            <Input
              id="book-author"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder={t('metadata.placeholder.author')}
              disabled={isSubmitting}
            />
          </div>

          {/* AI 提示 */}
          <p className="text-xs text-muted-foreground">
            {t('metadata.dialog.ai_hint')}
          </p>

          {/* 错误提示 */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/30 rounded-lg text-sm">
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
              <span className="text-red-700 dark:text-red-300">{error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="ghost"
            onClick={handleSkip}
            disabled={isSubmitting}
          >
            {t('metadata.action.skip')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting ? t('common.saving') : t('metadata.action.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

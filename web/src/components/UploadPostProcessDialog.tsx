/**
 * UploadPostProcessDialog.tsx
 * 
 * 上传完成后的处理对话框
 * 负责显示元数据确认提示和 OCR 触发提示
 */

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, FileText, AlertCircle, Check, Loader2 } from 'lucide-react'
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

interface UploadPostProcessDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookId: string
  bookTitle: string
  /** 元数据相关 */
  needsMetadataConfirm: boolean
  extractedTitle?: string
  extractedAuthor?: string
  /** OCR 相关 */
  isImageBasedPdf: boolean
  pageCount?: number
  /** 回调 */
  onComplete?: () => void
}

export function UploadPostProcessDialog({
  open,
  onOpenChange,
  bookId,
  bookTitle,
  needsMetadataConfirm,
  extractedTitle,
  extractedAuthor,
  isImageBasedPdf,
  pageCount,
  onComplete,
}: UploadPostProcessDialogProps) {
  const { t } = useTranslation('common')
  
  // 当前步骤：'metadata' | 'ocr' | 'done'
  const [step, setStep] = useState<'metadata' | 'ocr' | 'done'>('metadata')
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 初始化状态
  useEffect(() => {
    if (open) {
      setTitle(extractedTitle || bookTitle || '')
      setAuthor(extractedAuthor || '')
      setError(null)
      // 决定从哪个步骤开始
      if (needsMetadataConfirm) {
        setStep('metadata')
      } else if (isImageBasedPdf) {
        setStep('ocr')
      } else {
        // 不需要任何处理，直接关闭
        onOpenChange(false)
        onComplete?.()
      }
    }
  }, [open, needsMetadataConfirm, isImageBasedPdf, extractedTitle, extractedAuthor, bookTitle, onOpenChange, onComplete])

  const hasExtractedMetadata = !!(extractedTitle || extractedAuthor)

  // 确认元数据
  const handleConfirmMetadata = async () => {
    setIsSubmitting(true)
    setError(null)

    try {
      await api.patch(`/books/${bookId}/metadata`, {
        title: title.trim() || undefined,
        author: author.trim() || undefined,
        metadata_confirmed: true,
      })

      // 如果是图片型 PDF，进入 OCR 步骤
      if (isImageBasedPdf) {
        setStep('ocr')
      } else {
        setStep('done')
        setTimeout(() => {
          onOpenChange(false)
          onComplete?.()
        }, 500)
      }
    } catch (err) {
      console.error('[UploadPostProcess] Failed to update metadata:', err)
      setError(t('metadata.error.update_failed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  // 跳过元数据确认
  const handleSkipMetadata = async () => {
    setIsSubmitting(true)
    setError(null)

    try {
      await api.patch(`/books/${bookId}/metadata`, {
        metadata_confirmed: true,
      })

      if (isImageBasedPdf) {
        setStep('ocr')
      } else {
        setStep('done')
        setTimeout(() => {
          onOpenChange(false)
          onComplete?.()
        }, 500)
      }
    } catch (err) {
      console.error('[UploadPostProcess] Failed to skip metadata:', err)
      setError(t('metadata.error.skip_failed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  // 触发 OCR
  const handleTriggerOcr = async () => {
    setIsSubmitting(true)
    setError(null)

    try {
      await api.post(`/books/${bookId}/ocr`)
      
      // 【关键】立即广播 OCR 开始事件，通知 LibraryPage 更新书籍状态为 pending
      // 这确保书籍被立即锁定，防止用户在 OCR 期间打开阅读页面
      window.dispatchEvent(new CustomEvent('ocr_started', {
        detail: { bookId }
      }))
      console.log('[UploadPostProcess] OCR started, broadcasted ocr_started event for book:', bookId)
      
      setStep('done')
      setTimeout(() => {
        onOpenChange(false)
        onComplete?.()
      }, 1000)
    } catch (err: any) {
      console.error('[UploadPostProcess] Failed to trigger OCR:', err)
      const msg = err.response?.data?.message || err.response?.data?.detail || t('ocr.error.trigger_failed')
      setError(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  // 稍后处理 OCR
  const handleSkipOcr = () => {
    setStep('done')
    setTimeout(() => {
      onOpenChange(false)
      onComplete?.()
    }, 500)
  }

  // 渲染元数据确认步骤
  const renderMetadataStep = () => (
    <>
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
        {hasExtractedMetadata ? (
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
        <Button variant="ghost" onClick={handleSkipMetadata} disabled={isSubmitting}>
          {t('metadata.action.skip')}
        </Button>
        <Button onClick={handleConfirmMetadata} disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {t('metadata.action.confirm')}
        </Button>
      </DialogFooter>
    </>
  )

  // 渲染 OCR 提示步骤
  const renderOcrStep = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          {t('ocr.dialog.title', { defaultValue: '文字识别服务' })}
        </DialogTitle>
        <DialogDescription>
          {t('ocr.dialog.description', { defaultValue: '检测到这是一本图片格式的 PDF，需要进行文字识别才能使用高亮、笔记和 AI 对话功能。' })}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {/* 图片 PDF 提示 */}
        <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg text-sm">
          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="text-amber-700 dark:text-amber-300">
            <p className="font-medium">{t('ocr.dialog.image_pdf_detected', { defaultValue: '检测到图片型 PDF' })}</p>
            {pageCount && (
              <p className="mt-1">{t('ocr.dialog.page_count', { count: pageCount, defaultValue: `共 ${pageCount} 页` })}</p>
            )}
          </div>
        </div>

        {/* 功能说明 */}
        <div className="text-sm text-muted-foreground space-y-1">
          <p>{t('ocr.dialog.features_hint', { defaultValue: 'OCR 文字识别后，您可以：' })}</p>
          <ul className="list-disc list-inside pl-2 space-y-1">
            <li>{t('ocr.dialog.feature_select', { defaultValue: '选择和复制文字' })}</li>
            <li>{t('ocr.dialog.feature_highlight', { defaultValue: '添加高亮和笔记' })}</li>
            <li>{t('ocr.dialog.feature_search', { defaultValue: '全文搜索' })}</li>
            <li>{t('ocr.dialog.feature_ai', { defaultValue: 'AI 对话问答' })}</li>
          </ul>
        </div>

        {/* 配额提示 */}
        <p className="text-xs text-muted-foreground">
          {t('ocr.dialog.quota_hint', { defaultValue: 'OCR 服务会消耗配额，您也可以稍后在书籍菜单中触发。' })}
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
        <Button variant="ghost" onClick={handleSkipOcr} disabled={isSubmitting}>
          {t('ocr.action.later', { defaultValue: '稍后处理' })}
        </Button>
        <Button onClick={handleTriggerOcr} disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {t('ocr.action.trigger', { defaultValue: '立即识别' })}
        </Button>
      </DialogFooter>
    </>
  )

  // 渲染完成步骤
  const renderDoneStep = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Check className="h-5 w-5 text-green-600" />
          {t('upload.post_process.done_title', { defaultValue: '处理完成' })}
        </DialogTitle>
      </DialogHeader>
      <div className="py-4 text-center text-muted-foreground">
        {t('upload.post_process.done_message', { defaultValue: '书籍已准备就绪，可以开始阅读了！' })}
      </div>
    </>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {step === 'metadata' && renderMetadataStep()}
        {step === 'ocr' && renderOcrStep()}
        {step === 'done' && renderDoneStep()}
      </DialogContent>
    </Dialog>
  )
}

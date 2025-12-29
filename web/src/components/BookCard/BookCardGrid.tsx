/**
 * BookCardGrid - 网格视图书籍卡片
 * 
 * 用于书架网格布局，竖向封面展示
 * 
 * @see 06 - UIUX设计系统UI_UX_Design_system.md
 */
import { Check, Scan } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/sonner'
import BookCardMenu from '../BookCardMenu'
import { BookCover, ProcessingPlaceholder, StatusIcon } from './BookCardParts'
import type { NormalizedBookProps, BookCardCallbacks } from './types'

interface BookCardGridProps extends NormalizedBookProps, BookCardCallbacks {
  className?: string
}

export default function BookCardGrid(props: BookCardGridProps) {
  const { t } = useTranslation('common')
  const {
    id,
    title,
    author,
    coverUrl,
    coverColor,
    progress,
    status,
    isFinished,
    ocrStatus,
    isImageBased,
    isCompleted,
    showCloudIcon,
    isProcessing,
    isOcrProcessing,
    processingText,
    onClick,
    onSyncClick,
    onDeleted,
    onFinishedChange,
    onMetadataChange,
    onOcrTrigger,
    className,
  } = props

  // 根据状态获取处理中文本
  const getProcessingText = () => {
    if (processingText) return processingText
    switch (status) {
      case 'converting': return t('book_status.converting')
      case 'ocr': return t('book_status.ocr_processing')
      default: return t('book_status.processing')
    }
  }

  // 处理卡片点击
  const handleCardClick = () => {
    if (isProcessing || status === 'downloading') return
    
    if (isOcrProcessing) {
      toast.info(t('book_status.ocr_in_progress', '正在进行文字识别，请稍候...'))
      return
    }
    
    if (status === 'cloud' && onSyncClick) {
      onSyncClick()
    } else {
      onClick?.()
    }
  }

  // 处理中状态 - 显示脉冲动效卡片
  if (isProcessing) {
    return (
      <div className={cn('group relative flex flex-col', className)}>
        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg shadow-md">
          <ProcessingPlaceholder 
            text={getProcessingText()} 
            className="h-full w-full rounded-lg" 
          />
        </div>
        <div className="mt-2 h-5" />
      </div>
    )
  }
    
  return (
    <div
      onClick={handleCardClick}
      className={cn(
        'group relative flex flex-col cursor-pointer transition-transform hover:scale-[1.02]',
        className
      )}
    >
      {/* 封面 - 带阴影 */}
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg shadow-md">
        <BookCover coverUrl={coverUrl} title={title} className="h-full w-full rounded-lg">
          {/* 云状态图标 */}
          {showCloudIcon && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <StatusIcon status={status} coverColor={coverColor} />
            </div>
          )}
          
          {/* 底部信息栏 - 覆盖在封面上 */}
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between p-2 bg-gradient-to-t from-black/60 to-transparent">
            {/* 左下角：进度或已读完状态 */}
            <span className="text-xs font-medium text-white">
              {isCompleted ? (
                <span className="flex items-center gap-1">
                  <Check className="h-3 w-3" /> 已读完
                </span>
              ) : (
                `${Math.round(progress)}%`
              )}
            </span>
            
            {/* 右下角：三点菜单 */}
            {id && (
              <BookCardMenu
                bookId={id}
                bookTitle={title}
                bookAuthor={author}
                isFinished={isFinished}
                ocrStatus={ocrStatus}
                isImageBased={isImageBased}
                onDeleted={() => onDeleted?.(id)}
                onFinishedChange={(finished) => onFinishedChange?.(id, finished)}
                onMetadataChange={(metadata) => onMetadataChange?.(id, metadata)}
                onOcrTrigger={() => onOcrTrigger?.(id)}
                buttonClassName="text-white"
              />
            )}
          </div>

          {/* OCR 处理中图标 */}
          {isOcrProcessing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg">
              <div className="flex flex-col items-center gap-2">
                <Scan className="w-6 h-6 text-white animate-pulse" />
                <span className="text-xs text-white font-medium">OCR 处理中</span>
              </div>
            </div>
          )}
        </BookCover>
      </div>
    </div>
  )
}

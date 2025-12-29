/**
 * BookCardList - 列表视图书籍卡片
 * 
 * 横向卡片布局，带 ambient blur 背景效果
 * 
 * @see 06 - UIUX设计系统UI_UX_Design_system.md
 */
import { useState, useEffect } from 'react'
import { Check, MoreHorizontal, Loader2, Scan } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/sonner'
import { extractDominantColor, getLuminance } from '@/lib/color-utils'
import { ScrollText } from '@/components/ui/ScrollText'
import BookCardMenu from '../BookCardMenu'
import { BookCover, StatusIcon } from './BookCardParts'
import type { NormalizedBookProps, BookCardCallbacks } from './types'

interface BookCardListProps extends NormalizedBookProps, BookCardCallbacks {
  className?: string
}

export default function BookCardList(props: BookCardListProps) {
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
    onMoreClick,
    onDeleted,
    onFinishedChange,
    onMetadataChange,
    onOcrTrigger,
    className,
  } = props

  // 状态用于存储提取的主色调
  const [dominantColor, setDominantColor] = useState(coverColor || '#6B7280')

  useEffect(() => {
    if (coverUrl && !coverColor) {
      extractDominantColor(coverUrl).then(setDominantColor)
    } else if (coverColor) {
      setDominantColor(coverColor)
    }
  }, [coverUrl, coverColor])

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

  // 处理中状态
  if (isProcessing) {
    return (
      <div
        className={cn(
          'relative flex h-[100px] overflow-hidden rounded-2xl shadow-lg',
          'bg-gradient-to-r from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-600',
          'animate-pulse',
          className
        )}
      >
        <div className="relative w-1/4 shrink-0 flex items-center justify-center p-2">
          <div className="relative w-full max-w-[60px] overflow-hidden rounded-lg bg-gray-300 dark:bg-gray-600 flex items-center justify-center" style={{ aspectRatio: '2/3' }}>
            <Loader2 className="h-6 w-6 text-gray-500 dark:text-gray-400 animate-spin" />
          </div>
        </div>
        <div className="relative flex-1 flex flex-col justify-center px-4 py-3">
          <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {getProcessingText()}
          </span>
        </div>
      </div>
    )
  }
    
  const luminance = getLuminance(dominantColor)
  const isLight = luminance > 0.5
  const textClass = isLight ? 'text-gray-900' : 'text-white'
  const subTextClass = isLight ? 'text-gray-700' : 'text-white/90'

  return (
    <div
      onClick={handleCardClick}
      className={cn(
        'relative flex h-[100px] overflow-hidden rounded-2xl shadow-lg transition-transform duration-fast hover:scale-[1.02] cursor-pointer',
        className
      )}
      style={{ backgroundColor: dominantColor }}
    >
      {/* Ambient Blur 背景 */}
      {coverUrl && (
        <div 
          className="absolute inset-0 blur-2xl scale-150 opacity-60"
          style={{
            backgroundImage: `url(${coverUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}
      
      {/* 渐变遮罩层 */}
      <div 
        className="absolute inset-0"
        style={{
          background: isLight 
            ? 'linear-gradient(to right, rgba(255,255,255,0.1), rgba(255,255,255,0.4))'
            : 'linear-gradient(to right, rgba(0,0,0,0.1), rgba(0,0,0,0.3))'
        }}
      />
      
      {/* 封面区域 - 占 1/4 宽度 */}
      <div className="relative w-1/4 shrink-0 flex items-center justify-center p-2">
        <div className="relative w-full max-w-[60px] overflow-hidden rounded-lg shadow-xl" style={{ aspectRatio: '2/3' }}>
          <BookCover coverUrl={coverUrl} title={title} className="absolute inset-0 h-full w-full">
            {showCloudIcon && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <StatusIcon status={status} coverColor={dominantColor} />
              </div>
            )}
          </BookCover>
        </div>
      </div>
      
      {/* 内容区域 - 占 3/4 宽度 */}
      <div className="relative flex-1 flex flex-col justify-center px-4 py-3 pr-12 overflow-hidden">
        <ScrollText 
          text={title} 
          className={cn("font-semibold text-base", textClass)}
        />
        {author && (
          <div 
            className={cn("text-sm truncate mt-1", subTextClass)}
            title={author}
          >
            {author}
          </div>
        )}
        
        {/* 进度显示 */}
        {isCompleted ? (
          <div className={cn("flex items-center gap-1.5 mt-1", textClass)}>
            <div className="w-4 h-4 rounded-full bg-system-blue flex items-center justify-center">
              <Check className="w-2.5 h-2.5 text-white" />
            </div>
            <span className="text-xs font-medium">已读完</span>
          </div>
        ) : (
          <p className={cn("text-xs mt-1 opacity-60", textClass)}>
            {Math.round(progress)}%
          </p>
        )}
      </div>
      
      {/* 底部进度条 */}
      {!isCompleted && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/10">
          <div 
            className="h-full bg-white/80 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* OCR 处理中图标 */}
      {isOcrProcessing && (
        <div className="absolute bottom-2 left-2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm">
          <Scan className="w-3 h-3 text-white animate-pulse" />
          <span className="text-xs text-white font-medium">OCR</span>
        </div>
      )}

      {/* 更多菜单 */}
      <div className="absolute top-2 right-2 z-10">
        {id ? (
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
            buttonClassName={textClass}
          />
        ) : onMoreClick && (
          <button
            onClick={(e) => { e.stopPropagation(); onMoreClick(); }}
            className={cn("p-1 rounded-full hover:bg-white/20 transition-colors", textClass)}
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  )
}

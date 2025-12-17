/**
 * BookCardHero - 大尺寸继续阅读卡片
 * 
 * 用于首页"继续阅读"区域的大卡片展示
 */
import { useState, useEffect } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/sonner'
import { extractDominantColor } from '@/lib/color-utils'
import { BookCover, StatusIcon, ProgressBar } from './BookCardParts'
import type { NormalizedBookProps, BookCardCallbacks } from './types'

interface BookCardHeroProps extends NormalizedBookProps, BookCardCallbacks {
  className?: string
}

export default function BookCardHero(props: BookCardHeroProps) {
  const { t } = useTranslation('common')
  const {
    id,
    title,
    author,
    coverUrl,
    coverColor,
    progress,
    status,
    isCompleted,
    showProgress,
    showCloudIcon,
    isProcessing,
    isOcrProcessing,
    onClick,
    onSyncClick,
    onMoreClick,
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

  return (
    <div
      onClick={handleCardClick}
      className={cn(
        'relative flex h-40 cursor-pointer overflow-hidden rounded-xl transition-transform hover:scale-[1.02]',
        className
      )}
    >
      {/* Ambient Blur 背景 */}
      <div 
        className="absolute inset-0 blur-3xl opacity-30"
        style={{ backgroundColor: dominantColor }}
      />
      
      {/* 内容层 */}
      <div className="relative flex w-full gap-4 p-4">
        {/* 封面 */}
        <div className="relative aspect-[2/3] h-full shrink-0 overflow-hidden rounded-md shadow-lg">
          <BookCover coverUrl={coverUrl} title={title} className="h-full w-full">
            {showCloudIcon && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <StatusIcon status={status} coverColor={dominantColor} />
              </div>
            )}
          </BookCover>
        </div>
        
        {/* 元数据 */}
        <div className="flex flex-1 flex-col justify-between py-1">
          <div>
            <h3 className="font-bold text-label line-clamp-2">{title}</h3>
            {author && (
              <p className="mt-1 text-sm text-secondary-label line-clamp-1">{author}</p>
            )}
            <p className="mt-1 text-xs text-tertiary-label">
              图书 · {isCompleted ? '已读完' : `${Math.round(progress)}%`}
            </p>
          </div>
          
          {/* 进度条 */}
          {showProgress && <ProgressBar progress={progress} />}
        </div>
        
        {/* 更多按钮 */}
        {onMoreClick && (
          <button
            onClick={(e) => { e.stopPropagation(); onMoreClick(); }}
            className="absolute bottom-4 right-4 p-1 rounded-full hover:bg-white/20 transition-colors"
          >
            <MoreHorizontal className="h-5 w-5 text-secondary-label" />
          </button>
        )}
      </div>
    </div>
  )
}

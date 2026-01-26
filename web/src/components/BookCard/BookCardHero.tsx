/**
 * BookCardHero - 大尺寸继续阅读卡片
 * 
 * 用于首页"继续阅读"区域的大卡片展示
 * 实现 Apple CarPlay 风格的动态模糊背景效果
 * 
 * @see 雅典娜开发技术文档汇总/06 - UIUX设计系统 - Liquid Glass 效果规范
 * @ai-generated Claude Opus 4.5 (2026-01-24)
 */
import { useState, useEffect } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/sonner'
import { extractDominantColor, getLuminance } from '@/lib/color-utils'
import { BookCover, StatusIcon, ProgressBar } from './BookCardParts'
import type { NormalizedBookProps, BookCardCallbacks } from './types'

interface BookCardHeroProps extends NormalizedBookProps, BookCardCallbacks {
  className?: string
}

export default function BookCardHero(props: BookCardHeroProps) {
  const { t } = useTranslation('common')
  const {
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

  // 状态用于存储提取的主色调和亮度
  const [dominantColor, setDominantColor] = useState(coverColor || '#6B7280')
  const [isLightBackground, setIsLightBackground] = useState(false)

  useEffect(() => {
    if (coverUrl && !coverColor) {
      extractDominantColor(coverUrl).then((color) => {
        setDominantColor(color)
        setIsLightBackground(getLuminance(color) > 0.5)
      })
    } else if (coverColor) {
      setDominantColor(coverColor)
      setIsLightBackground(getLuminance(coverColor) > 0.5)
    }
  }, [coverUrl, coverColor])

  // 根据背景亮度选择文字颜色
  const textColor = isLightBackground ? 'text-gray-900' : 'text-white'
  const secondaryTextColor = isLightBackground ? 'text-gray-600' : 'text-white/70'
  const tertiaryTextColor = isLightBackground ? 'text-gray-500' : 'text-white/50'

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
        'relative flex h-40 cursor-pointer overflow-hidden rounded-2xl transition-transform hover:scale-[1.02]',
        className
      )}
    >
      {/* 动态模糊背景 - Apple CarPlay 风格 */}
      {coverUrl ? (
        <>
          {/* 封面图片放大并模糊作为背景 */}
          <div className="absolute inset-0 overflow-hidden">
            <img
              src={coverUrl}
              alt=""
              className="w-full h-full object-cover scale-150 blur-3xl"
              aria-hidden="true"
            />
          </div>
          {/* 暗色遮罩层确保文字可读 */}
          <div 
            className={cn(
              'absolute inset-0',
              isLightBackground ? 'bg-white/30' : 'bg-black/40'
            )}
          />
        </>
      ) : (
        /* 无封面时的渐变背景 */
        <div 
          className="absolute inset-0"
          style={{ 
            background: `linear-gradient(135deg, ${dominantColor} 0%, rgba(0,0,0,0.8) 100%)`
          }}
        />
      )}
      
      {/* 内容层 */}
      <div className="relative flex w-full gap-4 p-4">
        {/* 封面 */}
        <div className="relative aspect-[2/3] h-full shrink-0 overflow-hidden rounded-lg shadow-xl">
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
            <h3 className={cn('font-bold line-clamp-2', textColor)}>{title}</h3>
            {author && (
              <p className={cn('mt-1 text-sm line-clamp-1', secondaryTextColor)}>{author}</p>
            )}
            <p className={cn('mt-1 text-xs', tertiaryTextColor)}>
              {t('book.type', '图书')} · {isCompleted ? t('book.completed', '已读完') : `${Math.round(progress)}%`}
            </p>
          </div>
          
          {/* 进度条 */}
          {showProgress && <ProgressBar progress={progress} />}
        </div>
        
        {/* 更多按钮 */}
        {onMoreClick && (
          <button
            onClick={(e) => { e.stopPropagation(); onMoreClick(); }}
            className={cn(
              'absolute bottom-4 right-4 p-1.5 rounded-full transition-colors',
              isLightBackground ? 'hover:bg-black/10' : 'hover:bg-white/20'
            )}
          >
            <MoreHorizontal className={cn('h-5 w-5', secondaryTextColor)} />
          </button>
        )}
      </div>
    </div>
  )
}

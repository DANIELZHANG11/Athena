/**
 * 书籍卡片组件
 *
 * 说明：
 * - 支持 `default`/`hero`/`grid`/`list` 四种变体
 * - 动态显示下载/阅读/处理中/OCR 状态
 * - 提供更多菜单以执行删除、元数据确认、OCR 触发等操作
 */
import { Cloud, Check, MoreHorizontal, BookOpen, Loader2, Scan } from 'lucide-react'
import { cn } from '@/lib/utils'
import BookCardMenu from './BookCardMenu'
import { useState, useEffect } from 'react'
import { extractDominantColor, getLuminance } from '@/lib/color-utils'
import { ScrollText } from '@/components/ui/ScrollText'
import { useTranslation } from 'react-i18next'

export type BookStatus = 'cloud' | 'downloading' | 'ready' | 'reading' | 'completed' | 'processing' | 'converting' | 'ocr'

export interface BookCardProps {
  /** 书籍 ID */
  id?: string
  /** 书籍标题 */
  title: string
  /** 作者 */
  author?: string
  /** 封面图片 URL */
  coverUrl?: string
  /** 封面主色调（用于 ambient blur） */
  coverColor?: string
  /** 阅读进度 (0-100) */
  progress?: number
  /** 书籍状态 */
  status?: BookStatus
  /** 是否已读完（手动标记） */
  isFinished?: boolean
  /** OCR 状态: 'pending' | 'processing' | 'completed' | 'failed' | null */
  ocrStatus?: string | null
  /** 是否为图片型 PDF（需要 OCR） */
  isImageBased?: boolean
  /** 处理中提示文本 */
  processingText?: string
  /** 下载 URL（兼容旧版） */
  downloadUrl?: string
  /** 点击回调 */
  onClick?: () => void
  /** 云图标点击回调 - 用于后台同步，不跳转阅读页 */
  onSyncClick?: () => void
  /** 更多操作回调 - 旧版兼容 */
  onMoreClick?: () => void
  /** 删除回调 - 接收 bookId 参数 */
  onDeleted?: (bookId: string) => void
  /** 已读完状态变更回调 - 接收 bookId 和 finished 参数 */
  onFinishedChange?: (bookId: string, finished: boolean) => void
  /** 元数据更新后的回调 */
  onMetadataChange?: (bookId: string, metadata: { title?: string; author?: string }) => void
  /** OCR 触发成功后的回调 */
  onOcrTrigger?: (bookId: string) => void
  /** 卡片变体 */
  variant?: 'default' | 'hero' | 'grid' | 'list'
  /** 自定义类名 */
  className?: string
}

// 智能反色：根据封面亮度决定图标颜色
function getAdaptiveColor(coverColor?: string): string {
  if (!coverColor) return 'text-white/80'
  
  // 简单的亮度计算（假设 coverColor 是 hex 格式）
  try {
    const hex = coverColor.replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return luminance > 0.5 ? 'text-black/60' : 'text-white/80'
  } catch {
    return 'text-white/80'
  }
}

// 默认封面占位图
function CoverPlaceholder({ className }: { className?: string }) {
  return (
    <div className={cn(
      'flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800',
      className
    )}>
      <BookOpen className="h-8 w-8 text-gray-400" />
    </div>
  )
}

// 处理中状态占位图 - 心跳脉冲动效
function ProcessingPlaceholder({ text, className }: { text?: string; className?: string }) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center gap-3',
      'bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-600',
      'animate-pulse',
      className
    )}>
      <Loader2 className="h-6 w-6 text-gray-500 dark:text-gray-400 animate-spin" />
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 text-center px-2">
        {text || '正在处理...'}
      </span>
    </div>
  )
}

// 状态图标
function StatusIcon({ status, coverColor }: { status: BookStatus; coverColor?: string }) {
  const colorClass = getAdaptiveColor(coverColor)
  
  switch (status) {
    case 'cloud':
      return <Cloud className={cn('h-6 w-6', colorClass)} />
    case 'downloading':
      return (
        <div className="relative">
          <Cloud className={cn('h-6 w-6 animate-pulse', colorClass)} />
        </div>
      )
    case 'completed':
      return (
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-system-blue">
          <Check className="h-3 w-3 text-white" />
        </div>
      )
    default:
      return null
  }
}

export default function BookCard({
  id,
  title,
  author,
  coverUrl,
  coverColor,
  progress = 0,
  status = 'ready',
  isFinished = false,
  processingText,
  downloadUrl,
  onClick,
  onSyncClick,
  onMoreClick,
  onDeleted,
  onFinishedChange,
  onMetadataChange,
  onOcrTrigger,
  ocrStatus,
  isImageBased = false,
  variant = 'default',
  className,
}: BookCardProps) {
  const { t } = useTranslation('common')
  // 状态用于存储提取的主色调 (仅用于 list/hero 变体)
  const [dominantColor, setDominantColor] = useState(coverColor || '#6B7280')

  useEffect(() => {
    if (variant === 'list' || variant === 'hero') {
      if (coverUrl && !coverColor) {
        extractDominantColor(coverUrl).then(setDominantColor)
      } else if (coverColor) {
        setDominantColor(coverColor)
      }
    }
  }, [coverUrl, coverColor, variant])

  // 手动标记已读完优先于进度判断
  const isCompleted = isFinished || status === 'completed' || progress >= 100
  const showProgress = !isCompleted && progress > 0 && status === 'reading'
  const showCloudIcon = status === 'cloud' || status === 'downloading'
  const isProcessing = status === 'processing' || status === 'converting' || status === 'ocr'
  // OCR 正在处理中
  const isOcrProcessing = ocrStatus === 'pending' || ocrStatus === 'processing'
  
  // 处理卡片点击：如果是云状态且有同步回调，则触发同步而不跳转
  const handleCardClick = () => {
    // 处理中、下载中、格式转换中不响应点击
    if (isProcessing || status === 'downloading') {
      return
    }
    if (status === 'cloud' && onSyncClick) {
      onSyncClick()
    } else {
      onClick?.()
    }
  }
  
  // 根据状态获取处理中文本
  const getProcessingText = () => {
    if (processingText) return processingText
    switch (status) {
      case 'converting': return t('book_status.converting')
      case 'ocr': return t('book_status.ocr_processing')
      default: return t('book_status.processing')
    }
  }

  // Hero 变体（继续阅读大卡片）
  if (variant === 'hero') {
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
          style={{ backgroundColor: coverColor || '#6B7280' }}
        />
        
        {/* 内容层 */}
        <div className="relative flex w-full gap-4 p-4">
          {/* 封面 */}
          <div className="relative aspect-[2/3] h-full shrink-0 overflow-hidden rounded-md shadow-lg">
            {coverUrl ? (
              <img src={coverUrl} alt={title} className="h-full w-full object-cover" />
            ) : (
              <CoverPlaceholder className="h-full w-full" />
            )}
            {showCloudIcon && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <StatusIcon status={status} coverColor={coverColor} />
              </div>
            )}
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
            {showProgress && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-gray-200">
                <div 
                  className="h-full rounded-full bg-system-blue transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
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

  // Grid 变体（书架网格）
  if (variant === 'grid') {
    // 处理中状态 - 显示脉冲动效卡片（不显示书名，避免泄露书籍信息）
    if (isProcessing) {
      return (
        <div
          className={cn(
            'group relative flex flex-col',
            className
          )}
        >
          {/* 处理中封面 */}
          <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg shadow-md">
            <ProcessingPlaceholder 
              text={getProcessingText()} 
              className="h-full w-full rounded-lg" 
            />
          </div>
          
          {/* 处理中状态不显示书名 - 占位保持布局一致 */}
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
          {coverUrl ? (
            <img src={coverUrl} alt={title} className="h-full w-full object-cover" />
          ) : (
            <CoverPlaceholder className="h-full w-full rounded-lg" />
          )}
          
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

          {/* OCR 处理中图标 - 显示在卡片中央 */}
          {isOcrProcessing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg">
              <div className="flex flex-col items-center gap-2">
                <Scan className="w-6 h-6 text-white animate-pulse" />
                <span className="text-xs text-white font-medium">OCR 处理中</span>
              </div>
            </div>
          )}
        </div>
        
        {/* 取消标题显示 - 根据 UIUX 规范 */}
      </div>
    )
  }

  // List 变体（列表模式 - Horizontal Card Style）
  if (variant === 'list') {
    // 处理中状态 - 显示特殊的处理中卡片（不显示书名）
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
          {/* 封面区域 - 处理中图标 */}
          <div className="relative w-1/4 shrink-0 flex items-center justify-center p-2">
            <div className="relative w-full max-w-[60px] overflow-hidden rounded-lg bg-gray-300 dark:bg-gray-600 flex items-center justify-center" style={{ aspectRatio: '2/3' }}>
              <Loader2 className="h-6 w-6 text-gray-500 dark:text-gray-400 animate-spin" />
            </div>
          </div>
          
          {/* 内容区域 - 只显示状态提示 */}
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
            {coverUrl ? (
              <img 
                src={coverUrl} 
                alt={title} 
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <CoverPlaceholder className="h-full w-full" />
            )}
            {showCloudIcon && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <StatusIcon status={status} coverColor={dominantColor} />
              </div>
            )}
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

        {/* OCR 处理中图标 - 显示在卡片左下角 */}
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

  // Default 变体（简单卡片，兼容旧版）
  return (
    <div
      onClick={handleCardClick}
      className={cn(
        'rounded-lg border border-gray-200 dark:border-gray-700 p-3 cursor-pointer transition-all hover:shadow-md hover:border-system-blue/30',
        className
      )}
    >
      <div className="font-semibold text-label line-clamp-2">{title}</div>
      {author && (
        <p className="mt-1 text-sm text-secondary-label">{author}</p>
      )}
      {downloadUrl && (
        <a
          href={downloadUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-sm text-system-blue hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          下载
        </a>
      )}
    </div>
  )
}

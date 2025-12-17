/**
 * BookCard 公共子组件
 * 
 * 封面、状态图标、进度条等可复用组件
 */
import { Cloud, Check, BookOpen, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BookStatus } from './types'

// ============================================================================
// 颜色工具函数
// ============================================================================

/** 根据封面亮度决定图标颜色 */
export function getAdaptiveColor(coverColor?: string): string {
  if (!coverColor) return 'text-white/80'
  
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

// ============================================================================
// 封面组件
// ============================================================================

/** 默认封面占位图 */
export function CoverPlaceholder({ className }: { className?: string }) {
  return (
    <div className={cn(
      'flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800',
      className
    )}>
      <BookOpen className="h-8 w-8 text-gray-400" />
    </div>
  )
}

/** 处理中状态占位图 - 心跳脉冲动效 */
export function ProcessingPlaceholder({ text, className }: { text?: string; className?: string }) {
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

/** 书籍封面图片 */
export function BookCover({ 
  coverUrl, 
  title, 
  className,
  children 
}: { 
  coverUrl?: string
  title: string
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div className={cn("relative overflow-hidden", className)}>
      {coverUrl ? (
        <img src={coverUrl} alt={title} className="h-full w-full object-cover" />
      ) : (
        <CoverPlaceholder className="h-full w-full" />
      )}
      {children}
    </div>
  )
}

// ============================================================================
// 状态组件
// ============================================================================

/** 状态图标 */
export function StatusIcon({ status, coverColor }: { status: BookStatus; coverColor?: string }) {
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

/** 进度条 */
export function ProgressBar({ 
  progress, 
  className,
  barClassName 
}: { 
  progress: number
  className?: string
  barClassName?: string
}) {
  return (
    <div className={cn("h-1 w-full overflow-hidden rounded-full bg-gray-200", className)}>
      <div 
        className={cn("h-full rounded-full bg-system-blue transition-all", barClassName)}
        style={{ width: `${progress}%` }}
      />
    </div>
  )
}

/** 已读完徽章 */
export function CompletedBadge({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-1", className)}>
      <Check className="h-3 w-3" /> 已读完
    </span>
  )
}

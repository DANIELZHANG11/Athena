/**
 * BookCard 组件模块
 * 
 * 统一导出入口，支持四种变体：
 * - default: 简单卡片（兼容旧版）
 * - hero: 大尺寸继续阅读卡片
 * - grid: 网格视图竖向卡片
 * - list: 列表视图横向卡片
 * 
 * 使用方式：
 * ```tsx
 * // 统一入口（自动选择变体）
 * import BookCard from '@/components/BookCard'
 * <BookCard book={book} variant="grid" />
 * 
 * // 直接使用特定变体
 * import { BookCardGrid, BookCardList } from '@/components/BookCard'
 * <BookCardGrid {...props} />
 * ```
 * 
 * @see 06 - UIUX设计系统UI_UX_Design_system.md
 */

// 类型导出
export * from './types'

// 子组件导出
export { default as BookCardGrid } from './BookCardGrid'
export { default as BookCardList } from './BookCardList'
export { default as BookCardHero } from './BookCardHero'
export { default as BookCardDefault } from './BookCardDefault'

// 公共组件导出
export * from './BookCardParts'

// 统一入口组件
import { useMemo } from 'react'
import BookCardGrid from './BookCardGrid'
import BookCardList from './BookCardList'
import BookCardHero from './BookCardHero'
import BookCardDefault from './BookCardDefault'
import type { BookCardProps, NormalizedBookProps, BookStatus } from './types'

/**
 * 规范化 props，统一处理兼容性
 */
function normalizeProps(props: BookCardProps): NormalizedBookProps {
  const { book } = props
  
  const id = props.id || book?.id
  const title = props.title || book?.title || ''
  const author = props.author || book?.author
  const coverUrl = props.coverUrl || book?.coverUrl
  const progress = props.progress ?? book?.progress ?? 0
  const isFinished = props.isFinished ?? book?.isFinished ?? false
  const ocrStatus = props.ocrStatus ?? book?.ocrStatus
  const isImageBased = props.isImageBased ?? book?.isImageBased
  const downloadUrl = props.downloadUrl || book?.downloadUrl
  const coverColor = props.coverColor
  const processingText = props.processingText
  
  // 兼容性处理：status 可能是 props.status 或 props.cacheStatus
  const status: BookStatus = props.status || props.cacheStatus || 'ready'
  
  // 计算属性
  const isCompleted = isFinished || status === 'completed' || progress >= 100
  const showProgress = !isCompleted && progress > 0 && status === 'reading'
  const showCloudIcon = status === 'cloud' || status === 'downloading'
  const isProcessing = status === 'processing' || status === 'converting' || status === 'ocr'
  const isOcrProcessing = ocrStatus === 'pending' || ocrStatus === 'processing'

  return {
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
    processingText,
    downloadUrl,
    isCompleted,
    showProgress,
    showCloudIcon,
    isProcessing,
    isOcrProcessing,
  }
}

/**
 * BookCard 统一入口组件
 * 
 * 根据 variant 自动选择对应的子组件
 */
export default function BookCard(props: BookCardProps) {
  const normalized = useMemo(() => normalizeProps(props), [props])
  
  // 确定变体
  let variant = props.variant || 'default'
  if (props.viewMode === 'list') variant = 'list'
  if (props.viewMode === 'grid' || props.viewMode === 'shelf') variant = 'grid'
  
  // 合并回调
  const callbacks = {
    onClick: props.onClick,
    onSyncClick: props.onSyncClick || props.onDownload,
    onMoreClick: props.onMoreClick,
    onDeleted: props.onDeleted,
    onFinishedChange: props.onFinishedChange,
    onMetadataChange: props.onMetadataChange,
    onOcrTrigger: props.onOcrTrigger,
  }
  
  const commonProps = {
    ...normalized,
    ...callbacks,
    className: props.className,
  }

  switch (variant) {
    case 'hero':
      return <BookCardHero {...commonProps} />
    case 'grid':
      return <BookCardGrid {...commonProps} />
    case 'list':
      return <BookCardList {...commonProps} />
    default:
      return <BookCardDefault {...commonProps} />
  }
}

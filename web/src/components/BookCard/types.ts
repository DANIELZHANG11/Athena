/**
 * BookCard 类型定义
 * 
 * 统一管理所有 BookCard 相关类型
 */
import { BookItem } from '@/hooks/useBooksData'

export type BookStatus = 'cloud' | 'downloading' | 'ready' | 'reading' | 'completed' | 'processing' | 'converting' | 'ocr'

export type BookCardVariant = 'default' | 'hero' | 'grid' | 'list'

export interface BookCardBaseProps {
  /** 书籍对象 (可选，如果提供则优先使用其中的属性) */
  book?: BookItem
  
  /** 书籍 ID */
  id?: string
  /** 书籍标题 */
  title?: string
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
  /** 自定义类名 */
  className?: string
}

export interface BookCardCallbacks {
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
  /** 下载回调 (兼容 LibraryPage 传入的 onDownload) */
  onDownload?: () => void
}

export interface BookCardProps extends BookCardBaseProps, BookCardCallbacks {
  /** 卡片变体 */
  variant?: BookCardVariant
  /** 缓存状态 (兼容 LibraryPage 传入的 cacheStatus) */
  cacheStatus?: BookStatus
  /** 视图模式 (兼容 LibraryPage 传入的 viewMode) */
  viewMode?: 'grid' | 'list' | 'shelf'
  /** 是否在线 (兼容 LibraryPage 传入的 isOnline) */
  isOnline?: boolean
}

// 内部使用的标准化属性
export interface NormalizedBookProps {
  id?: string
  title: string
  author?: string
  coverUrl?: string
  coverColor?: string
  progress: number
  status: BookStatus
  isFinished: boolean
  ocrStatus?: string | null
  isImageBased?: boolean
  processingText?: string
  downloadUrl?: string
  
  // 计算属性
  isCompleted: boolean
  showProgress: boolean
  showCloudIcon: boolean
  isProcessing: boolean
  isOcrProcessing: boolean
}

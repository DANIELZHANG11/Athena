/**
 * BookCardDefault - 默认简单卡片
 * 
 * 基础卡片样式，用于兼容旧版场景
 */
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/sonner'
import type { NormalizedBookProps, BookCardCallbacks } from './types'

interface BookCardDefaultProps extends NormalizedBookProps, BookCardCallbacks {
  className?: string
}

export default function BookCardDefault(props: BookCardDefaultProps) {
  const { t } = useTranslation('common')
  const {
    title,
    author,
    downloadUrl,
    status,
    isProcessing,
    isOcrProcessing,
    onClick,
    onSyncClick,
    className,
  } = props

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

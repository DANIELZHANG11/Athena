/**
 * 上传进度组件
 * - 展示阶段、进度百分比与错误信息
 * - 支持取消、重试、关闭等交互
 */
import { useTranslation } from 'react-i18next'
import { X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { UploadStage, UploadErrorCode } from '@/hooks/useBookUpload'

export interface UploadProgressProps {
  stage: UploadStage
  progress: number
  fileName: string
  errorCode?: UploadErrorCode | null
  onCancel?: () => void
  onRetry?: () => void
  onDismiss?: () => void
  className?: string
}

// 阶段配置
const STAGE_CONFIG: Record<UploadStage, { labelKey: string; color: string }> = {
  idle: { labelKey: 'upload.stage.idle', color: 'text-secondary-label' },
  hashing: { labelKey: 'upload.stage.hashing', color: 'text-system-blue' },
  initializing: { labelKey: 'upload.stage.initializing', color: 'text-system-blue' },
  uploading: { labelKey: 'upload.stage.uploading', color: 'text-system-blue' },
  completing: { labelKey: 'upload.stage.completing', color: 'text-system-blue' },
  done: { labelKey: 'upload.stage.done', color: 'text-system-green' },
  error: { labelKey: 'upload.stage.error', color: 'text-system-red' },
}

export default function UploadProgress({
  stage,
  progress,
  fileName,
  errorCode,
  onCancel,
  onRetry,
  onDismiss,
  className,
}: UploadProgressProps) {
  const { t } = useTranslation('common')

  const config = STAGE_CONFIG[stage]
  const isComplete = stage === 'done'
  const isError = stage === 'error'
  const isActive = !isComplete && !isError

  // 获取错误消息
  const getErrorMessage = () => {
    if (!errorCode) return t('upload.error.unknown')
    return t(`upload.error.${errorCode}`)
  }

  return (
    <div className={cn(
      'rounded-xl border p-4 transition-all duration-medium',
      isComplete && 'border-system-green/30 bg-system-green/5',
      isError && 'border-system-red/30 bg-system-red/5',
      isActive && 'border-system-blue/30 bg-system-blue/5',
      className
    )}>
      {/* 头部：文件名和操作按钮 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* 状态图标 */}
          <div className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full shrink-0',
            isComplete && 'bg-system-green/10',
            isError && 'bg-system-red/10',
            isActive && 'bg-system-blue/10'
          )}>
            {isComplete && <CheckCircle className="h-5 w-5 text-system-green" />}
            {isError && <AlertCircle className="h-5 w-5 text-system-red" />}
            {isActive && <Loader2 className="h-5 w-5 text-system-blue animate-spin" />}
          </div>
          
          {/* 文件名 */}
          <span className="text-sm font-medium text-label truncate">
            {fileName}
          </span>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 shrink-0">
          {isActive && onCancel && (
            <button
              onClick={onCancel}
              className="p-1.5 rounded-full hover:bg-secondary-background transition-colors"
              aria-label={t('common.cancel')}
            >
              <X className="h-4 w-4 text-secondary-label" />
            </button>
          )}
          {(isComplete || isError) && onDismiss && (
            <button
              onClick={onDismiss}
              className="p-1.5 rounded-full hover:bg-secondary-background transition-colors"
              aria-label={t('common.close')}
            >
              <X className="h-4 w-4 text-secondary-label" />
            </button>
          )}
        </div>
      </div>

      {/* 进度条 */}
      {isActive && (
        <div className="mb-2">
          <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-system-blue rounded-full transition-all duration-medium ease-out"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        </div>
      )}

      {/* 状态文本 */}
      <div className="flex items-center justify-between text-sm">
        <span className={config.color}>
          {isError ? getErrorMessage() : t(config.labelKey)}
        </span>
        {isActive && (
          <span className="text-secondary-label">
            {progress}%
          </span>
        )}
      </div>

      {/* 错误状态下的重试按钮 */}
      {isError && onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 w-full py-2 px-4 rounded-full border border-system-red text-system-red hover:bg-system-red/10 transition-colors text-sm font-medium"
        >
          {t('common.retry')}
        </button>
      )}
    </div>
  )
}

import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { useBookUpload, UploadResult, UploadErrorCode } from '@/hooks/useBookUpload'
import UploadDropzone from './UploadDropzone'
import UploadProgress from './UploadProgress'
import Modal from '@/components/ui/Modal'
import { cn } from '@/lib/utils'

export interface UploadManagerProps {
  /** 是否在上传完成后自动导航到书库 */
  navigateOnSuccess?: boolean
  /** 上传成功回调 */
  onSuccess?: (result: UploadResult) => void
  /** 上传错误回调 */
  onError?: (errorCode: UploadErrorCode) => void
  /** 自定义类名 */
  className?: string
  /** 按钮变体 */
  variant?: 'button' | 'icon' | 'inline'
}

export default function UploadManager({
  navigateOnSuccess = true,
  onSuccess,
  onError,
  className,
  variant = 'button',
}: UploadManagerProps) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  const {
    stage,
    progress,
    fileName,
    errorCode,
    isUploading,
    start,
    cancel,
    reset,
  } = useBookUpload({
    onSuccess: (result) => {
      onSuccess?.(result)
      // 广播上传成功事件，供其他组件监听
      window.dispatchEvent(new CustomEvent('book_uploaded', { detail: result }))
      
      // 延迟关闭 modal 和导航
      setTimeout(() => {
        setIsModalOpen(false)
        reset()
        if (navigateOnSuccess) {
          navigate('/app/library')
        }
      }, 1500)
    },
    onError: (code) => {
      onError?.(code)
    },
  })

  // 处理文件选择
  const handleFileSelect = useCallback((file: File) => {
    setPendingFile(file)
    start(file)
  }, [start])

  // 处理取消
  const handleCancel = useCallback(() => {
    cancel()
    setPendingFile(null)
  }, [cancel])

  // 处理重试
  const handleRetry = useCallback(() => {
    if (pendingFile) {
      reset()
      start(pendingFile)
    }
  }, [pendingFile, reset, start])

  // 处理关闭 Modal
  const handleCloseModal = useCallback(() => {
    if (isUploading) {
      // 如果正在上传，先确认是否取消
      if (window.confirm(t('upload.confirm_cancel'))) {
        cancel()
        setIsModalOpen(false)
        setPendingFile(null)
        reset()
      }
    } else {
      setIsModalOpen(false)
      setPendingFile(null)
      reset()
    }
  }, [isUploading, cancel, reset, t])

  // 处理完成后关闭
  const handleDismiss = useCallback(() => {
    setIsModalOpen(false)
    setPendingFile(null)
    reset()
  }, [reset])

  // 渲染触发按钮
  const renderTrigger = () => {
    switch (variant) {
      case 'icon':
        return (
          <button
            onClick={() => setIsModalOpen(true)}
            className={cn(
              // 圆形按钮 - 白色背景 + 黑色加号 + 阴影
              'flex h-11 w-11 items-center justify-center rounded-full',
              'bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700',
              'hover:shadow-xl hover:scale-105 active:scale-95 transition-all',
              className
            )}
            aria-label={t('upload.cta')}
          >
            <Plus className="h-6 w-6 text-gray-900 dark:text-white" strokeWidth={2.5} />
          </button>
        )
      case 'inline':
        return (
          <div className={cn('w-full', className)}>
            {stage === 'idle' ? (
              <UploadDropzone onFileSelect={handleFileSelect} />
            ) : (
              <UploadProgress
                stage={stage}
                progress={progress}
                fileName={fileName || ''}
                errorCode={errorCode}
                onCancel={handleCancel}
                onRetry={handleRetry}
                onDismiss={handleDismiss}
              />
            )}
          </div>
        )
      default:
        return (
          <button
            onClick={() => setIsModalOpen(true)}
            className={cn(
              // 主要按钮样式 - 确保在明亮模式下可见
              'inline-flex items-center gap-2 rounded-full px-5 py-2.5',
              'bg-system-blue text-white shadow-md',
              'hover:opacity-90 active:scale-95 transition-all',
              'text-sm font-medium',
              className
            )}
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            {t('upload.cta')}
          </button>
        )
    }
  }

  // inline 变体直接渲染，不需要 Modal
  if (variant === 'inline') {
    return renderTrigger()
  }

  return (
    <>
      {renderTrigger()}

      {isModalOpen && (
        <Modal onClose={handleCloseModal}>
          <div className="w-full max-w-md">
            <h2 className="text-lg font-semibold text-label mb-4">
              {t('upload.title')}
            </h2>

            {stage === 'idle' ? (
              <UploadDropzone
                onFileSelect={handleFileSelect}
                disabled={isUploading}
              />
            ) : (
              <UploadProgress
                stage={stage}
                progress={progress}
                fileName={fileName || ''}
                errorCode={errorCode}
                onCancel={handleCancel}
                onRetry={handleRetry}
                onDismiss={stage === 'done' || stage === 'error' ? handleDismiss : undefined}
              />
            )}
          </div>
        </Modal>
      )}
    </>
  )
}


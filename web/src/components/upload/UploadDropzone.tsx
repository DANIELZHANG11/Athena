import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Upload, FileText, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SUPPORTED_FORMATS, MAX_FILE_SIZE } from '@/hooks/useBookUpload'

/**
 * 上传拖拽选择组件
 *
 * 功能：
 * - 支持点击/拖拽选择单个文件，预览后确认上传
 * - 校验扩展名与大小，文案来源 `common` 命名空间
 * - 外部通过 `onFileSelect` 接收文件并发起上传
 */
export interface UploadDropzoneProps {
  onFileSelect: (file: File) => void
  disabled?: boolean
  className?: string
  accept?: string[]
  maxSize?: number
}

// 格式化文件大小
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export default function UploadDropzone({
  onFileSelect,
  disabled = false,
  className,
  accept = SUPPORTED_FORMATS,
  maxSize = MAX_FILE_SIZE,
}: UploadDropzoneProps) {
  const { t } = useTranslation('common')
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 验证文件
  const validateFile = useCallback((file: File): string | null => {
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    if (!accept.includes(ext)) {
      return t('upload.error.invalid_format')
    }
    if (file.size > maxSize) {
      return t('upload.error.file_too_large', { size: formatFileSize(maxSize) })
    }
    return null
  }, [accept, maxSize, t])

  // 处理文件选择
  const handleFile = useCallback((file: File) => {
    setError(null)
    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      return
    }
    setPreviewFile(file)
  }, [validateFile])

  // 确认上传
  const handleConfirm = useCallback(() => {
    if (previewFile) {
      onFileSelect(previewFile)
      setPreviewFile(null)
    }
  }, [previewFile, onFileSelect])

  // 取消选择
  const handleClear = useCallback(() => {
    setPreviewFile(null)
    setError(null)
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }, [])

  // 点击选择
  const handleClick = useCallback(() => {
    if (!disabled && !previewFile) {
      inputRef.current?.click()
    }
  }, [disabled, previewFile])

  // 文件输入变更
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFile(file)
    }
  }, [handleFile])

  // 拖拽事件处理
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) {
      setIsDragOver(true)
    }
  }, [disabled])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    if (disabled) return

    const file = e.dataTransfer.files?.[0]
    if (file) {
      handleFile(file)
    }
  }, [disabled, handleFile])

  // 构建 accept 属性
  const acceptStr = accept.map(ext => `.${ext}`).join(',')

  return (
    <div className={cn('w-full', className)}>
      <input
        ref={inputRef}
        type="file"
        accept={acceptStr}
        onChange={handleInputChange}
        className="hidden"
        disabled={disabled}
      />

      {/* 预览状态 */}
      {previewFile ? (
        <div className="rounded-xl border-2 border-dashed border-system-blue bg-system-blue/5 p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-system-blue/10">
              <FileText className="h-6 w-6 text-system-blue" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-label truncate">{previewFile.name}</p>
              <p className="text-sm text-secondary-label">
                {formatFileSize(previewFile.size)}
              </p>
            </div>
            <button
              onClick={handleClear}
              className="p-2 rounded-full hover:bg-secondary-background transition-colors"
              aria-label={t('common.cancel')}
            >
              <X className="h-5 w-5 text-secondary-label" />
            </button>
          </div>
          
          <div className="mt-4 flex gap-3">
            <button
              onClick={handleClear}
              className="flex-1 py-2 px-4 rounded-full border border-gray-300 text-label hover:bg-secondary-background transition-colors"
            >
              {t('upload.choose_another')}
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 py-2 px-4 rounded-full bg-system-blue text-white hover:opacity-90 transition-opacity"
            >
              {t('upload.start')}
            </button>
          </div>
        </div>
      ) : (
        /* 拖拽区域 */
        <div
          onClick={handleClick}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={cn(
            'rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-all duration-fast',
            isDragOver
              ? 'border-system-blue bg-system-blue/5 scale-[1.02]'
              : 'border-gray-300 hover:border-system-blue hover:bg-secondary-background',
            disabled && 'opacity-50 cursor-not-allowed',
            error && 'border-system-red bg-system-red/5'
          )}
        >
          <div className={cn(
            'mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full transition-colors',
            isDragOver ? 'bg-system-blue/10' : 'bg-secondary-background'
          )}>
            <Upload className={cn(
              'h-8 w-8 transition-colors',
              isDragOver ? 'text-system-blue' : 'text-secondary-label'
            )} />
          </div>

          <p className="text-label font-medium mb-1">
            {isDragOver ? t('upload.drop_here') : t('upload.drag_or_click')}
          </p>
          <p className="text-sm text-secondary-label mb-3">
            {t('upload.supported_formats', { formats: accept.join(', ').toUpperCase() })}
          </p>
          <p className="text-xs text-tertiary-label">
            {t('upload.max_size', { size: formatFileSize(maxSize) })}
          </p>

          {error && (
            <p className="mt-3 text-sm text-system-red">{error}</p>
          )}
        </div>
      )}
    </div>
  )
}

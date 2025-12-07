/**
 * 上传管理组件
 *
 * 说明：
 * - 负责发起文件选择与上传流程（使用 `useBookUpload`）
 * - 监听后台处理状态（封面、元数据、OCR）并弹出确认对话框
 * - 上传完成后广播事件，供书库页面刷新
 */
import { useCallback, useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { useBookUpload, UploadResult, UploadErrorCode } from '@/hooks/useBookUpload'
import { useUploadPostProcessing } from '@/hooks/useUploadPostProcessing'
import UploadDropzone from './UploadDropzone'
import UploadProgress from './UploadProgress'
import { UploadPostProcessDialog } from '@/components/UploadPostProcessDialog'
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
  
  // 上传后处理状态
  const [postProcessOpen, setPostProcessOpen] = useState(false)
  const [postProcessData, setPostProcessData] = useState<{
    bookId: string
    bookTitle: string
    needsMetadataConfirm: boolean
    extractedTitle?: string
    extractedAuthor?: string
    isImageBasedPdf: boolean
    pageCount?: number
  } | null>(null)
  
  // 保存最近上传成功的书籍信息
  const lastUploadRef = useRef<{ id: string; title: string; author?: string; format?: string } | null>(null)
  // 标记对话框是否已显示，避免重复弹出
  const dialogShownRef = useRef(false)

  // 后处理监控 hook
  const { startMonitoring, stopMonitoring } = useUploadPostProcessing({
    pollInterval: 2000,
    maxPollCount: 30,
    onStatusUpdate: (status) => {
      console.log('[UploadManager] Processing status update:', status)
      
      // 如果对话框已显示，只更新图片 PDF 状态
      if (dialogShownRef.current) {
        if (status.isImageBasedPdf && postProcessData && !postProcessData.isImageBasedPdf) {
          setPostProcessData(prev => prev ? {
            ...prev,
            isImageBasedPdf: true,
            pageCount: status.pageCount,
          } : null)
        }
        return
      }
      
      // 元数据提取任务完成且尚未确认 → 弹出对话框
      if (status.metadataExtracted && !status.metadataConfirmed && lastUploadRef.current) {
        console.log('[UploadManager] Metadata extraction complete, showing dialog')
        dialogShownRef.current = true
        setPostProcessData({
          bookId: status.bookId,
          bookTitle: status.title || lastUploadRef.current.title,
          needsMetadataConfirm: true,
          extractedTitle: status.extractedTitle,
          extractedAuthor: status.extractedAuthor,
          isImageBasedPdf: status.isImageBasedPdf,
          pageCount: status.pageCount,
        })
        setPostProcessOpen(true)
      }
    },
    onMetadataReady: (status) => {
      console.log('[UploadManager] Metadata ready callback:', status.metadataExtracted)
    },
    onImagePdfDetected: (status) => {
      console.log('[UploadManager] Image-based PDF detected:', status.isImageBasedPdf)
    },
    onCoverReady: (status) => {
      console.log('[UploadManager] Cover ready, broadcasting event:', status.bookId)
      // 广播封面就绪事件，通知 LibraryPage 刷新
      window.dispatchEvent(new CustomEvent('book_cover_ready', {
        detail: { bookId: status.bookId, coverUrl: status.coverUrl }
      }))
    },
  })
  
  // 用于追踪正在等待转换完成的书籍
  const convertingBookRef = useRef<{ id: string; title: string } | null>(null)
  const conversionPollRef = useRef<NodeJS.Timeout | null>(null)
  
  // 轮询检查转换状态
  const pollConversionStatus = useCallback(async (bookId: string, title: string) => {
    try {
      const res = await fetch(`/api/books/${bookId}`)
      if (!res.ok) {
        console.log(`[UploadManager] Failed to fetch book status: ${res.status}`)
        return
      }
      const book = await res.json()
      console.log(`[UploadManager] Polling conversion status for ${bookId}:`, book.conversion_status)
      
      if (book.conversion_status === 'completed') {
        // 转换完成，停止轮询并开始监控元数据提取
        console.log(`[UploadManager] Conversion completed for ${bookId}, starting metadata monitoring`)
        if (conversionPollRef.current) {
          clearInterval(conversionPollRef.current)
          conversionPollRef.current = null
        }
        convertingBookRef.current = null
        
        // 广播转换完成事件，通知 LibraryPage 刷新
        window.dispatchEvent(new CustomEvent('book_conversion_complete', {
          detail: { bookId, title }
        }))
        
        // 开始监控元数据提取
        lastUploadRef.current = { id: bookId, title }
        dialogShownRef.current = false
        startMonitoring(bookId, title)
      } else if (book.conversion_status === 'failed') {
        // 转换失败，停止轮询
        console.log(`[UploadManager] Conversion failed for ${bookId}`)
        if (conversionPollRef.current) {
          clearInterval(conversionPollRef.current)
          conversionPollRef.current = null
        }
        convertingBookRef.current = null
      }
      // pending/processing: 继续轮询
    } catch (err) {
      console.error('[UploadManager] Error polling conversion status:', err)
    }
  }, [startMonitoring])
  
  // 开始监控转换状态（用于非 EPUB/PDF 格式）
  const startConversionMonitoring = useCallback((bookId: string, title: string) => {
    console.log(`[UploadManager] Starting conversion monitoring for ${bookId} (${title})`)
    
    // 清理之前的轮询
    if (conversionPollRef.current) {
      clearInterval(conversionPollRef.current)
    }
    
    convertingBookRef.current = { id: bookId, title }
    
    // 立即检查一次
    pollConversionStatus(bookId, title)
    
    // 每 3 秒轮询一次，最多 5 分钟（100 次）
    let pollCount = 0
    const maxPolls = 100
    conversionPollRef.current = setInterval(() => {
      pollCount++
      if (pollCount >= maxPolls) {
        console.log(`[UploadManager] Conversion monitoring timeout for ${bookId}`)
        if (conversionPollRef.current) {
          clearInterval(conversionPollRef.current)
          conversionPollRef.current = null
        }
        convertingBookRef.current = null
        return
      }
      pollConversionStatus(bookId, title)
    }, 3000)
  }, [pollConversionStatus])
  
  // 组件卸载时清理轮询
  useEffect(() => {
    return () => {
      if (conversionPollRef.current) {
        clearInterval(conversionPollRef.current)
      }
    }
  }, [])

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
      
      // 获取文件扩展名，判断是否需要转换
      const ext = result.title.split('.').pop()?.toLowerCase() || ''
      const originalFormat = pendingFile?.name.split('.').pop()?.toLowerCase() || ext
      const directFormats = ['epub', 'pdf']
      const needsConversion = !directFormats.includes(originalFormat)
      
      // 保存上传信息（包含格式信息）
      lastUploadRef.current = { id: result.id, title: result.title, format: originalFormat }
      dialogShownRef.current = false  // 重置对话框显示标记
      
      // 【关键】只有 EPUB/PDF 格式才立即开始监控元数据提取
      // 其他格式（AZW3/MOBI等）需要先完成 Calibre 转换，转换完成后会自动触发元数据提取
      if (!needsConversion) {
        startMonitoring(result.id, result.title)
      } else {
        console.log(`[UploadManager] Format ${originalFormat} needs conversion, starting conversion monitoring`)
        // 开始监控转换状态，转换完成后自动开始元数据监控
        startConversionMonitoring(result.id, result.title)
      }
      
      // 延迟关闭上传 modal（但不立即导航，等待后处理完成）
      setTimeout(() => {
        setIsModalOpen(false)
        reset()
        
        // 对于需要转换的格式，直接导航到书库页面
        if (needsConversion && navigateOnSuccess) {
          navigate('/app/library')
        }
      }, 1500)
    },
    onError: (code) => {
      onError?.(code)
    },
  })

  // 后处理完成后的回调
  const handlePostProcessComplete = useCallback(() => {
    stopMonitoring()
    setPostProcessData(null)
    lastUploadRef.current = null
    dialogShownRef.current = false  // 重置对话框显示标记
    
    // 广播事件通知 LibraryPage 刷新数据，确保 isImageBased 等字段更新
    window.dispatchEvent(new CustomEvent('book_data_updated'))
    
    if (navigateOnSuccess) {
      navigate('/app/library')
    }
  }, [navigateOnSuccess, navigate, stopMonitoring])

  // 后处理对话框关闭
  const handlePostProcessClose = useCallback((open: boolean) => {
    setPostProcessOpen(open)
    if (!open) {
      // 用户关闭对话框，也执行导航
      handlePostProcessComplete()
    }
  }, [handlePostProcessComplete])

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
    return (
      <>
        {renderTrigger()}
        {/* 后处理对话框 */}
        {postProcessData && (
          <UploadPostProcessDialog
            open={postProcessOpen}
            onOpenChange={handlePostProcessClose}
            bookId={postProcessData.bookId}
            bookTitle={postProcessData.bookTitle}
            needsMetadataConfirm={postProcessData.needsMetadataConfirm}
            extractedTitle={postProcessData.extractedTitle}
            extractedAuthor={postProcessData.extractedAuthor}
            isImageBasedPdf={postProcessData.isImageBasedPdf}
            pageCount={postProcessData.pageCount}
            onComplete={handlePostProcessComplete}
          />
        )}
      </>
    )
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
      
      {/* 后处理对话框 */}
      {postProcessData && (
        <UploadPostProcessDialog
          open={postProcessOpen}
          onOpenChange={handlePostProcessClose}
          bookId={postProcessData.bookId}
          bookTitle={postProcessData.bookTitle}
          needsMetadataConfirm={postProcessData.needsMetadataConfirm}
          extractedTitle={postProcessData.extractedTitle}
          extractedAuthor={postProcessData.extractedAuthor}
          isImageBasedPdf={postProcessData.isImageBasedPdf}
          pageCount={postProcessData.pageCount}
          onComplete={handlePostProcessComplete}
        />
      )}
    </>
  )
}

/**
 * useUploadPostProcessing.ts
 * 
 * 上传后处理 Hook (App-First 版)
 * 使用 PowerSync 实时监控书籍状态，替代 API 轮询
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useQuery } from '@powersync/react'

export interface BookProcessingStatus {
  bookId: string
  title: string
  // 封面状态
  hasCover: boolean
  coverUrl?: string
  // 元数据状态
  metadataExtracted: boolean
  extractedTitle?: string
  extractedAuthor?: string
  metadataConfirmed: boolean
  // OCR 状态（是否是图片型 PDF）
  isImageBasedPdf: boolean
  ocrStatus?: 'none' | 'pending' | 'processing' | 'completed' | 'failed'
  pageCount?: number
  // 加载状态
  loading: boolean
  error?: string
}

interface UseUploadPostProcessingOptions {
  /** 轮询间隔（毫秒） - 在 PowerSync 模式下忽略 */
  pollInterval?: number
  /** 最大轮询次数 - 在 PowerSync 模式下忽略 */
  maxPollCount?: number
  /** 状态更新回调 */
  onStatusUpdate?: (status: BookProcessingStatus) => void
  /** 元数据提取完成回调 */
  onMetadataReady?: (status: BookProcessingStatus) => void
  /** 图片 PDF 检测完成回调 */
  onImagePdfDetected?: (status: BookProcessingStatus) => void
  /** 封面就绪回调 */
  onCoverReady?: (status: BookProcessingStatus) => void
}

export function useUploadPostProcessing(options: UseUploadPostProcessingOptions = {}) {
  const {
    onStatusUpdate,
    onMetadataReady,
    onImagePdfDetected,
    onCoverReady,
  } = options

  const [monitoredBookId, setMonitoredBookId] = useState<string | null>(null)
  const prevStatusRef = useRef<BookProcessingStatus | null>(null)
  
  // 使用 ref 保存回调函数
  const onStatusUpdateRef = useRef(onStatusUpdate)
  const onMetadataReadyRef = useRef(onMetadataReady)
  const onImagePdfDetectedRef = useRef(onImagePdfDetected)
  const onCoverReadyRef = useRef(onCoverReady)
  
  useEffect(() => {
    onStatusUpdateRef.current = onStatusUpdate
    onMetadataReadyRef.current = onMetadataReady
    onImagePdfDetectedRef.current = onImagePdfDetected
    onCoverReadyRef.current = onCoverReady
  }, [onStatusUpdate, onMetadataReady, onImagePdfDetected, onCoverReady])

  // 使用 PowerSync 实时查询书籍状态
  const { data: books, isLoading } = useQuery(
    'SELECT * FROM books WHERE id = ?',
    [monitoredBookId || '']
  )
  
  const book = books?.[0]

  useEffect(() => {
    if (!monitoredBookId || !book) return

    const status: BookProcessingStatus = {
      bookId: monitoredBookId,
      title: book.title || '',
      hasCover: !!(book.cover_url || book.cover_image_key),
      coverUrl: book.cover_url,
      metadataExtracted: !!book.metadata_extracted, // 假设 schema 中有此字段，如果没有则需调整
      extractedTitle: book.title,
      extractedAuthor: book.author,
      metadataConfirmed: !!book.metadata_confirmed, // 假设 schema 中有此字段
      isImageBasedPdf: !!book.is_image_based,
      ocrStatus: book.ocr_status as any || 'none',
      pageCount: book.page_count,
      loading: false
    }

    // 触发状态更新回调
    onStatusUpdateRef.current?.(status)

    const prev = prevStatusRef.current

    // 检查状态变化并触发回调
    // 1. 封面就绪
    if (status.hasCover && (!prev || !prev.hasCover)) {
      onCoverReadyRef.current?.(status)
    }

    // 2. 元数据提取完成（但尚未确认）
    if (status.metadataExtracted && !status.metadataConfirmed && (!prev || !prev.metadataExtracted)) {
      onMetadataReadyRef.current?.(status)
    }

    // 3. 图片 PDF 检测到
    if (status.isImageBasedPdf && status.ocrStatus === 'none' && (!prev || !prev.isImageBasedPdf)) {
      onImagePdfDetectedRef.current?.(status)
    }

    prevStatusRef.current = status

  }, [book, monitoredBookId])

  const startMonitoring = useCallback((bookId: string, initialTitle?: string) => {
    console.log('[UploadPostProcessing] Starting monitoring for book:', bookId)
    setMonitoredBookId(bookId)
    prevStatusRef.current = null
  }, [])

  const stopMonitoring = useCallback(() => {
    console.log('[UploadPostProcessing] Stopping monitoring')
    setMonitoredBookId(null)
    prevStatusRef.current = null
  }, [])

  return {
    status: prevStatusRef.current, // 返回最新的状态
    startMonitoring,
    stopMonitoring,
  }
}

/**
 * useUploadPostProcessing.ts
 * 
 * 上传后处理 Hook
 * 监控后台任务状态，在适当时机触发元数据确认和 OCR 提示
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useAuthStore } from '@/stores/auth'

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
  /** 轮询间隔（毫秒） */
  pollInterval?: number
  /** 最大轮询次数 */
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
    pollInterval = 2000,
    maxPollCount = 30, // 最多轮询 60 秒
    onStatusUpdate,
    onMetadataReady,
    onImagePdfDetected,
    onCoverReady,
  } = options

  const [status, setStatus] = useState<BookProcessingStatus | null>(null)
  const pollCountRef = useRef(0)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevStatusRef = useRef<BookProcessingStatus | null>(null)

  // 清理定时器
  const cleanup = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
    pollCountRef.current = 0
  }, [])

  // 获取书籍状态
  const fetchBookStatus = useCallback(async (bookId: string): Promise<BookProcessingStatus | null> => {
    const token = useAuthStore.getState().accessToken
    if (!token) return null

    try {
      // 获取书籍详情
      const bookRes = await fetch(`/api/v1/books/${bookId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      
      if (!bookRes.ok) {
        throw new Error('Failed to fetch book details')
      }

      const bookData = await bookRes.json()
      const book = bookData.data

      // 从后端获取 OCR 状态（如果需要更详细的 OCR 信息）
      let ocrStatus: 'none' | 'pending' | 'processing' | 'completed' | 'failed' = 'none'
      
      const format = (book.original_format || '').toLowerCase()
      if (format === 'pdf') {
        try {
          const ocrRes = await fetch(`/api/v1/books/${bookId}/ocr`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (ocrRes.ok) {
            const ocrData = await ocrRes.json()
            ocrStatus = ocrData.data?.ocr_status || 'none'
          }
        } catch {
          // OCR 状态获取失败，忽略
        }
      }

      // 判断封面是否就绪
      const hasCover = !!(book.cover_url || book.cover_image_key)
      const coverUrl = hasCover ? `/api/v1/books/${bookId}/cover?token=${encodeURIComponent(token)}` : undefined

      // 判断元数据提取任务是否已完成（由后端 extract_book_metadata 任务设置）
      // 注意：这表示任务完成，不表示提取到了有效数据
      const metadataExtracted = book.metadata_extracted || false
      const metadataConfirmed = book.metadata_confirmed || false

      // 使用后端返回的 is_image_based 和 page_count
      const isImageBasedPdf = book.is_image_based || false
      const pageCount = book.page_count

      return {
        bookId,
        title: book.title || '',
        hasCover,
        coverUrl,
        metadataExtracted,
        extractedTitle: book.title,
        extractedAuthor: book.author,
        metadataConfirmed,
        isImageBasedPdf,
        ocrStatus,
        pageCount,
        loading: false,
      }
    } catch (error) {
      console.error('[UploadPostProcessing] Failed to fetch status:', error)
      return {
        bookId,
        title: '',
        hasCover: false,
        metadataExtracted: false,
        metadataConfirmed: false,
        isImageBasedPdf: false,
        loading: false,
        error: (error as Error).message,
      }
    }
  }, [])

  // 开始监控书籍处理状态
  const startMonitoring = useCallback(async (bookId: string, initialTitle?: string) => {
    cleanup()
    pollCountRef.current = 0
    prevStatusRef.current = null

    // 初始状态
    setStatus({
      bookId,
      title: initialTitle || '',
      hasCover: false,
      metadataExtracted: false,
      metadataConfirmed: false,
      isImageBasedPdf: false,
      loading: true,
    })

    const poll = async () => {
      pollCountRef.current++
      
      const newStatus = await fetchBookStatus(bookId)
      if (!newStatus) {
        // 获取失败，继续轮询
        if (pollCountRef.current < maxPollCount) {
          pollTimerRef.current = setTimeout(poll, pollInterval)
        }
        return
      }

      setStatus(newStatus)
      onStatusUpdate?.(newStatus)

      const prev = prevStatusRef.current

      // 检查状态变化并触发回调
      // 1. 封面就绪
      if (newStatus.hasCover && (!prev || !prev.hasCover)) {
        onCoverReady?.(newStatus)
      }

      // 2. 元数据提取完成（但尚未确认）
      if (newStatus.metadataExtracted && !newStatus.metadataConfirmed && (!prev || !prev.metadataExtracted)) {
        onMetadataReady?.(newStatus)
      }

      // 3. 图片 PDF 检测到
      if (newStatus.isImageBasedPdf && newStatus.ocrStatus === 'none' && (!prev || !prev.isImageBasedPdf)) {
        onImagePdfDetected?.(newStatus)
      }

      prevStatusRef.current = newStatus

      // 判断是否需要继续轮询
      // 当封面就绪 且 元数据已提取/已确认 且 (非图片PDF 或 OCR状态明确) 时停止
      const shouldStop = (
        newStatus.hasCover &&
        (newStatus.metadataExtracted || newStatus.metadataConfirmed) &&
        (!newStatus.isImageBasedPdf || newStatus.ocrStatus !== 'none')
      )

      if (!shouldStop && pollCountRef.current < maxPollCount) {
        pollTimerRef.current = setTimeout(poll, pollInterval)
      }
    }

    // 开始轮询
    poll()
  }, [cleanup, fetchBookStatus, maxPollCount, pollInterval, onStatusUpdate, onCoverReady, onMetadataReady, onImagePdfDetected])

  // 停止监控
  const stopMonitoring = useCallback(() => {
    cleanup()
    setStatus(null)
  }, [cleanup])

  // 清理
  useEffect(() => {
    return cleanup
  }, [cleanup])

  return {
    status,
    startMonitoring,
    stopMonitoring,
  }
}

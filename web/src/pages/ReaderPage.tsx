/**
 * ReaderPage - 电子书阅读器路由入口页面 (App-First 版)
 *
 * 架构:
 * 1. 元数据: PowerSync (useBookData)
 * 2. 进度: PowerSync (useProgressData)
 * 3. 文件: IndexedDB (useLocalBookCache + getBookFile)
 * 4. 阅读器: 根据格式选择 EpubReader 或 PdfReader
 *
 * 纯响应式，无心跳，无 API 轮询
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { Loader2, AlertCircle, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useBookData } from '@/hooks/useBooksData'
import { useProgressData, useReadingSession } from '@/hooks/useProgressData'
import { useBookFileCache } from '@/hooks/useBookFileCache'
import { getBookFile, createBlobUrl, revokeBlobUrl } from '@/lib/bookStorage'
import { useOcrData } from '@/hooks/useOcrData'
import { EpubReader } from '@/components/readers'
import { PdfReader } from '@/components/readers'
import { parseEpubLocation, parsePdfLocation } from '@/lib/reading-utils'

export default function ReaderPage() {
  const { bookId } = useParams()
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)

  // 1. 获取书籍元数据
  const { book, isLoading: isMetaLoading, error: metaError } = useBookData(bookId || null)

  // 2. 获取阅读进度 - 必须等待加载完成才能渲染阅读器
  const { progress, saveProgress, isProgressLoading } = useProgressData(bookId || null)

  // 2.1 记录阅读会话（用于统计阅读时长）
  const { startSession, endSession } = useReadingSession(bookId || null)

  // 3. 本地文件状态
  const { markDownloading, markDownloaded } = useBookFileCache(bookId ? [bookId] : [])
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  // 关键修复：使用 useRef 存储 ArrayBuffer，防止引用变化导致 EpubReader 重新挂载
  const epubDataRef = useRef<ArrayBuffer | null>(null)
  const [epubDataReady, setEpubDataReady] = useState(false)
  const [fileLoading, setFileLoading] = useState(true)
  const [fileError, setFileError] = useState<string | null>(null)
  const [fileFormat, setFileFormat] = useState<'epub' | 'pdf'>('epub')

  // 4. OCR 数据（预加载）
  useOcrData({
    bookId: bookId || '',
    autoDownload: true
  })

  // 初始化：加载文件
  useEffect(() => {
    if (!bookId) return

    const loadFile = async () => {
      console.log('[ReaderPage] Loading file for book:', bookId)
      setFileLoading(true)
      setFileError(null)
      try {
        // 检查缓存
        const cached = await getBookFile(bookId)
        if (cached) {
          console.log('[ReaderPage] Cached file:', {
            format: cached.format,
            size: cached.blob.size,
            blobType: cached.blob.type,
            blobSize: cached.blob.size
          })

          setFileFormat(cached.format as 'epub' | 'pdf')

          // EPUB 使用 ArrayBuffer，PDF 使用 Blob URL
          if (cached.format === 'epub') {
            const arrayBuffer = await cached.blob.arrayBuffer()
            console.log('[ReaderPage] Created ArrayBuffer from cache for EPUB, size:', arrayBuffer.byteLength)
            epubDataRef.current = arrayBuffer
            setEpubDataReady(true)
          } else {
            const url = createBlobUrl(cached.blob, cached.format)
            console.log('[ReaderPage] Created blob URL from cache for PDF:', url)
            setBlobUrl(url)
          }

          setFileLoading(false)
          return
        }

        // 未缓存，需要下载
        if (!accessToken) {
          throw new Error('Not authenticated')
        }
        console.log('[ReaderPage] File not cached, downloading...')
        markDownloading(bookId)
        const contentUrl = `/api/v1/books/${bookId}/content?token=${encodeURIComponent(accessToken)}`
        const response = await fetch(contentUrl)

        if (!response.ok) throw new Error(`Download failed: ${response.status}`)

        const blob = await response.blob()
        const contentType = response.headers.get('Content-Type') || ''
        const format = contentType.includes('pdf') ? 'pdf' : 'epub'

        // 保存到缓存
        const { saveBookFile } = await import('@/lib/bookStorage')
        await saveBookFile(bookId, blob, format, undefined)
        markDownloaded(bookId)

        setFileFormat(format as 'epub' | 'pdf')

        // EPUB 使用 ArrayBuffer，PDF 使用 Blob URL
        if (format === 'epub') {
          const arrayBuffer = await blob.arrayBuffer()
          console.log('[ReaderPage] Created ArrayBuffer after download for EPUB, size:', arrayBuffer.byteLength)
          epubDataRef.current = arrayBuffer
          setEpubDataReady(true)
        } else {
          const url = createBlobUrl(blob, format)
          console.log('[ReaderPage] Created blob URL after download for PDF:', url)
          setBlobUrl(url)
        }

        setFileLoading(false)
      } catch (err) {
        console.error('[ReaderPage] File load error:', err)
        setFileError(err instanceof Error ? err.message : 'Failed to load book')
        setFileLoading(false)
      }
    }

    loadFile()

    return () => {
      if (blobUrl) revokeBlobUrl(blobUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, accessToken])

  // 阅读会话管理
  // 使用 ref 跟踪会话状态，确保在各种退出场景下都能正确关闭会话
  const sessionActiveRef = useRef(false)

  useEffect(() => {
    // 条件：文件加载完成（EPUB 用 epubDataReady，PDF 用 blobUrl）
    const isFileReady = fileFormat === 'epub' ? epubDataReady : !!blobUrl

    if (!fileLoading && isFileReady && bookId && !sessionActiveRef.current) {
      console.log('[ReaderPage] Starting reading session for book:', bookId)
      startSession().then((id) => {
        if (id) {
          console.log('[ReaderPage] Session started successfully:', id)
          sessionActiveRef.current = true
        }
      }).catch((err) => {
        console.error('[ReaderPage] Failed to start reading session:', err)
      })
    }

    // 处理页面可见性变化：用户切换到其他标签页时结束会话
    const handleVisibilityChange = () => {
      if (document.hidden && sessionActiveRef.current) {
        console.log('[ReaderPage] Page hidden, ending session')
        endSession()
        sessionActiveRef.current = false
      } else if (!document.hidden && bookId && !sessionActiveRef.current) {
        // 用户回到页面，重新开始会话
        console.log('[ReaderPage] Page visible again, restarting session')
        startSession().then((id) => {
          if (id) {
            sessionActiveRef.current = true
          }
        })
      }
    }

    // 处理页面卸载：用户关闭标签页/刷新页面
    const handleBeforeUnload = () => {
      if (sessionActiveRef.current) {
        console.log('[ReaderPage] Page unloading, ending session')
        endSession()
        sessionActiveRef.current = false
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)

      // 组件卸载时结束会话（用户导航到其他页面）
      if (sessionActiveRef.current && bookId) {
        console.log('[ReaderPage] Component unmounting, ending reading session for book:', bookId)
        endSession()
        sessionActiveRef.current = false
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileLoading, epubDataReady, blobUrl, bookId, fileFormat])


  // 返回按钮处理
  const handleBack = useCallback(() => {
    navigate(-1)
  }, [navigate])

  // EPUB 位置变更处理
  const handleEpubLocationChanged = useCallback((cfi: string, percentage: number) => {
    console.log('[ReaderPage] EPUB progress update:', { cfi, percentage })
    saveProgress({
      currentCfi: cfi,
      percentage: typeof percentage === 'number' ? percentage : 0,
    })
  }, [saveProgress])

  // PDF 页面变更处理
  const handlePdfPageChanged = useCallback((page: number, totalPages: number, percentage: number) => {
    console.log('[ReaderPage] PDF progress update:', { page, totalPages, percentage })
    saveProgress({
      currentPage: page,
      percentage: percentage,
      totalPages: totalPages
    })
  }, [saveProgress])

  // 解析初始位置
  const getInitialLocation = useCallback(() => {
    if (!progress) return undefined

    const isPdf = book?.originalFormat === 'pdf' || fileFormat === 'pdf'
    if (isPdf) {
      const loc = parsePdfLocation(progress.currentCfi || progress.currentPage)
      return loc?.page || 1
    } else {
      const loc = parseEpubLocation(progress.currentCfi)
      return loc || undefined
    }
  }, [progress, book, fileFormat])

  // 渲染加载中
  if (isMetaLoading || fileLoading || isProgressLoading || (!book && !metaError && !fileError)) {
    return (
      <div className="flex items-center justify-center h-[100dvh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">准备阅读器...</span>
      </div>
    )
  }

  // 获取书籍标题
  const bookTitle = book?.title || '未知书籍'
  const isPdf = book?.originalFormat === 'pdf' || fileFormat === 'pdf'

  // 渲染错误 - 检查元数据错误、文件错误，或文件未加载完成
  if (metaError || fileError || !book || (isPdf ? !blobUrl : !epubDataReady)) {
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] gap-4">
        <AlertCircle className="h-12 w-12 text-red-500" />
        <p className="text-red-500">{metaError?.message || fileError || '书籍加载失败'}</p>
        <Button onClick={handleBack} variant="outline">
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回
        </Button>
      </div>
    )
  }

  // 根据格式渲染对应阅读器
  if (isPdf) {
    return (
      <PdfReader
        url={blobUrl!}
        bookId={bookId || ''}
        bookTitle={bookTitle}
        initialPage={getInitialLocation() as number}
        onPageChanged={handlePdfPageChanged}
        onBack={handleBack}
      />
    )
  }

  // 关键：epubDataRef.current 的引用永远不变，避免 EpubReader 重新挂载
  return (
    <EpubReader
      data={epubDataRef.current!}
      bookId={bookId || ''}
      bookTitle={bookTitle}
      initialLocation={getInitialLocation() as string}
      onLocationChanged={handleEpubLocationChanged}
      onBack={handleBack}
    />
  )
}

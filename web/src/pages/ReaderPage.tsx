/**
 * ReaderPage - 电子书阅读器页面 (App-First 版)
 *
 * 架构:
 * 1. 元数据: PowerSync (useBookData)
 * 2. 进度: PowerSync (useProgressData)
 * 3. 文件: IndexedDB (useLocalBookCache + getBookFile)
 * 4. OCR: IndexedDB (useOcrData)
 *
 * 纯响应式，无心跳，无 API 轮询
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { Document, pdfjs } from 'react-pdf'
import { ReactReader } from 'react-reader'
import type { Rendition } from 'epubjs'
import { Button } from '@/components/ui/button'
import { ChevronLeft, Loader2, AlertCircle } from 'lucide-react'
import { useBookData } from '@/hooks/useBooksData'
import { useProgressData, useReadingSession } from '@/hooks/useProgressData'
import { useBookFileCache } from '@/hooks/useBookFileCache'
import { getBookFile, createBlobUrl, revokeBlobUrl } from '@/lib/bookStorage'
import { useOcrData } from '@/hooks/useOcrData'
import { PdfPageWithOcr } from '@/components/reader/PdfPageWithOcr'
import { parseEpubLocation, parsePdfLocation, formatProgress } from '@/lib/reading-utils'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// 配置 PDF worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

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
  const [fileLoading, setFileLoading] = useState(true)
  const [fileError, setFileError] = useState<string | null>(null)

  // 4. OCR 数据（预加载）
  useOcrData({
    bookId: bookId || '',
    autoDownload: true
  })

  // PDF 状态
  const [numPages, setNumPages] = useState<number>(0)
  const [pageNumber, setPageNumber] = useState(1)
  
  // EPUB 状态
  const [rendition, setRendition] = useState<Rendition | null>(null)
  const [epubLocation, setEpubLocation] = useState<string | number | null>(null)

  // 初始化：加载文件
  useEffect(() => {
    if (!bookId) return

    const loadFile = async () => {
      console.log('[ReaderPage] Loading file for book:', bookId)
      console.log('[ReaderPage] Book metadata:', book)
      setFileLoading(true)
      setFileError(null) // 重置错误状态
      try {
        // 检查缓存
        const cached = await getBookFile(bookId)
        console.log('[ReaderPage] Cached file:', cached ? { format: cached.format, size: cached.size, blobType: cached.blob?.type, blobSize: cached.blob?.size } : null)
        if (cached && cached.blob && cached.blob.size > 0) {
          const format = cached.format as 'epub' | 'pdf'
          // 统一使用 Blob URL，但确保 MIME 类型正确
          const url = createBlobUrl(cached.blob, format)
          console.log('[ReaderPage] Created blob URL from cache:', url, 'format:', format)
          setBlobUrl(url)
          setFileLoading(false)
          return
        } else if (cached) {
          console.warn('[ReaderPage] Cached file is invalid, will re-download')
        }

        // 未缓存，尝试下载
        const token = accessToken || localStorage.getItem('access_token') || ''
        if (!token) throw new Error('No access token')

        markDownloading(bookId)
        const contentUrl = `/api/v1/books/${bookId}/content?token=${encodeURIComponent(token)}`
        const response = await fetch(contentUrl)
        
        if (!response.ok) throw new Error(`Download failed: ${response.status}`)
        
        const blob = await response.blob()
        const contentType = response.headers.get('Content-Type') || ''
        const format = contentType.includes('pdf') ? 'pdf' : 'epub'
        
        // 保存到缓存
        const { saveBookFile } = await import('@/lib/bookStorage')
        await saveBookFile(bookId, blob, format, undefined)
        markDownloaded(bookId)

        // 统一使用 Blob URL
        const url = createBlobUrl(blob, format)
        console.log('[ReaderPage] Created blob URL after download:', url, 'format:', format)
        setBlobUrl(url)
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

  // 阅读会话管理 - 开始/结束阅读会话以记录阅读时长
  useEffect(() => {
    let sessionStarted = false
    
    // 只有在文件加载完成后才开始会话
    if (!fileLoading && blobUrl && bookId) {
      console.log('[ReaderPage] Starting reading session for book:', bookId)
      startSession().then((id) => {
        if (id) {
          sessionStarted = true
          console.log('[ReaderPage] Session started successfully:', id)
        }
      })
    }
    
    // 组件卸载或离开页面时结束会话
    return () => {
      if (bookId) {
        console.log('[ReaderPage] Ending reading session for book:', bookId)
        endSession()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileLoading, blobUrl, bookId])

  // 初始化进度 - 只有在进度加载完成后才恢复位置
  // 使用 ref 来追踪是否已经恢复过进度，防止重复恢复
  const progressRestoredRef = useRef(false)
  
  useEffect(() => {
    // 必须等待进度加载完成
    if (isProgressLoading) {
      console.log('[ReaderPage] Waiting for progress to load...')
      return
    }
    
    // 如果已经恢复过，不再重复
    if (progressRestoredRef.current) {
      return
    }
    
    console.log('[ReaderPage] Progress loaded, attempting to restore:', progress)
    progressRestoredRef.current = true
    
    if (progress && progress.currentCfi) {
      if (book?.originalFormat === 'pdf') {
        const loc = parsePdfLocation(progress.currentCfi || progress.currentPage)
        if (loc) {
          console.log('[ReaderPage] Restoring PDF page:', loc.page)
          setPageNumber(loc.page)
        }
      } else {
        const loc = parseEpubLocation(progress.currentCfi)
        if (loc) {
          console.log('[ReaderPage] Restoring EPUB location:', loc)
          setEpubLocation(loc)
        }
      }
    } else {
      console.log('[ReaderPage] No saved progress found, starting from beginning')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProgressLoading, progress, book])

  // EPUB 位置变更
  const onEpubLocationChanged = useCallback((loc: string | number) => {
    console.log('[ReaderPage] EPUB location changed:', loc, 'rendition:', !!rendition)
    setEpubLocation(loc)
    
    // 即使 rendition 未就绪，也尝试保存 CFI 位置
    if (typeof loc === 'string') {
      let percentage = 0
      
      // 方法1: 使用 rendition.book.locations.percentageFromCfi (最准确)
      if (rendition) {
        try {
          const book = (rendition as any).book
          if (book?.locations?.percentageFromCfi) {
            percentage = book.locations.percentageFromCfi(loc)
            console.log('[ReaderPage] Got percentage from locations:', percentage)
          }
        } catch (e) {
          console.warn('[ReaderPage] Failed to get percentage from locations:', e)
        }
      }
      
      // 方法2: 如果方法1失败，尝试从 currentLocation 获取
      if (percentage === 0 && rendition) {
        try {
          const currentLocation = (rendition as any).currentLocation()
          if (currentLocation) {
            const loc_any = currentLocation as any
            percentage = 
              loc_any?.start?.percentage ?? 
              loc_any?.atStart?.percentage ??
              loc_any?.percentage ?? 
              0
            console.log('[ReaderPage] Got percentage from currentLocation:', percentage, currentLocation)
          }
        } catch (e) {
          console.warn('[ReaderPage] Failed to get location percentage:', e)
        }
      }
      
      // 始终保存进度
      console.log('[ReaderPage] Saving EPUB progress:', { loc, percentage })
      saveProgress({
        currentCfi: loc,
        percentage: typeof percentage === 'number' ? percentage : 0,
      })
    }
  }, [rendition, saveProgress])

  // PDF 页面变更
  const onPdfPageChange = useCallback((page: number) => {
    console.log('[ReaderPage] PDF page changed:', page, '/', numPages)
    setPageNumber(page)
    const percentage = numPages > 0 ? page / numPages : 0
    console.log('[ReaderPage] Saving PDF progress:', { page, percentage, numPages })
    saveProgress({
      currentPage: page,
      percentage: percentage,
      totalPages: numPages
    })
  }, [numPages, saveProgress])

  // 渲染加载中 - 元数据加载或文件加载或进度正在加载或还没有 book 数据
  // 重要：必须等待进度加载完成，否则阅读器会以第一页初始化并覆盖真实进度
  if (isMetaLoading || fileLoading || isProgressLoading || (!book && !metaError)) {
    return (
      <div className="flex items-center justify-center h-[100dvh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">{isProgressLoading ? '正在同步进度...' : 'Loading...'}</span>
      </div>
    )
  }

  const isPdf = book?.originalFormat === 'pdf' || (book as any)?.format === 'pdf'

  // 渲染错误 - 只有在确定有错误或明确没有书籍时才显示
  if (metaError || fileError || !book || !blobUrl) {
    console.error('[ReaderPage] Rendering error state:', { metaError, fileError, book, blobUrl })
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] text-red-500">
        <AlertCircle className="h-12 w-12 mb-4" />
        <p>{metaError?.message || fileError || 'Book not found'}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate(-1)}>
          Go Back
        </Button>
      </div>
    )
  }

  console.log('[ReaderPage] Render:', { bookTitle: book.title, originalFormat: book.originalFormat, isPdf, blobUrl })

  return (
    <div className="h-[100dvh] flex flex-col bg-background overflow-hidden">
      {/* 顶部栏 - 固定高度 */}
      <div className="h-12 shrink-0 border-b flex items-center px-4 justify-between bg-card z-10">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <div className="font-medium truncate max-w-[50%]">{book.title}</div>
        <div className="text-sm text-muted-foreground">
          {formatProgress(progress?.percentage || 0)}
        </div>
      </div>

      {/* 阅读区域 - 使用剩余空间，不允许溢出 */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {isPdf ? (
          <div className="h-full flex flex-col bg-gray-100 dark:bg-gray-900">
            {/* PDF 内容区域 - 可滚动 */}
            <div className="flex-1 overflow-auto flex justify-center items-start py-4">
              <Document
                file={blobUrl}
                onLoadSuccess={({ numPages }) => {
                  console.log('[ReaderPage] PDF loaded successfully, pages:', numPages)
                  setNumPages(numPages)
                }}
                onLoadError={(error) => {
                  console.error('[ReaderPage] PDF load error:', error)
                }}
                loading={<Loader2 className="h-8 w-8 animate-spin mt-10" />}
                error={<div className="text-red-500 p-4">加载PDF失败</div>}
              >
                <PdfPageWithOcr
                  pageNumber={pageNumber}
                  width={Math.min(800, window.innerWidth - 32)}
                />
              </Document>
            </div>
            {/* 固定在底部的翻页控制 */}
            <div className="shrink-0 py-3 px-4 bg-white/90 dark:bg-gray-800/90 backdrop-blur border-t flex items-center justify-center gap-4">
              <Button 
                variant="outline" 
                size="icon" 
                disabled={pageNumber <= 1}
                onClick={() => onPdfPageChange(pageNumber - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium min-w-[80px] text-center">
                {pageNumber} / {numPages}
              </span>
              <Button 
                variant="outline" 
                size="icon" 
                disabled={pageNumber >= numPages}
                onClick={() => onPdfPageChange(pageNumber + 1)}
              >
                <ChevronLeft className="h-4 w-4 rotate-180" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="h-full">
            <ReactReader
              url={blobUrl!}
              location={epubLocation || undefined}
              locationChanged={onEpubLocationChanged}
              getRendition={setRendition}
              epubInitOptions={{
                openAs: 'epub',  // 必须：告诉 epub.js 这是文件而非目录
              }}
              epubOptions={{
                flow: 'paginated',  // 分页模式
                manager: 'default', // 使用默认管理器（更稳定）
              }}
              loadingView={
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <span className="ml-2">加载中...</span>
                </div>
              }
              errorView={
                <div className="flex flex-col items-center justify-center h-full text-red-500">
                  <AlertCircle className="h-12 w-12 mb-4" />
                  <p>EPUB 加载失败</p>
                  <p className="text-sm text-muted-foreground mt-2">请尝试重新打开或联系支持</p>
                </div>
              }
            />
          </div>
        )}
      </div>
    </div>
  )
}

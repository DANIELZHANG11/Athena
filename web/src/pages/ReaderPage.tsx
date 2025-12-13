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

import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { Document, pdfjs } from 'react-pdf'
import { ReactReader } from 'react-reader'
import type { Rendition } from 'epubjs'
import { Button } from '@/components/ui/button'
import { ChevronLeft, Loader2, AlertCircle } from 'lucide-react'
import { useBookData } from '@/hooks/useBooksData'
import { useProgressData } from '@/hooks/useProgressData'
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

  // 2. 获取阅读进度
  const { progress, saveProgress } = useProgressData(bookId || null)

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
      setFileLoading(true)
      try {
        // 检查缓存
        const cached = await getBookFile(bookId)
        if (cached) {
          const url = createBlobUrl(cached.blob)
          setBlobUrl(url)
          setFileLoading(false)
          return
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

        const url = createBlobUrl(blob)
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
  }, [bookId, accessToken])

  // 初始化进度
  useEffect(() => {
    if (progress && !epubLocation && !pageNumber) {
      if (book?.originalFormat === 'pdf') {
        const loc = parsePdfLocation(progress.currentCfi || progress.currentPage)
        if (loc) setPageNumber(loc.page)
      } else {
        const loc = parseEpubLocation(progress.currentCfi)
        if (loc) setEpubLocation(loc)
      }
    }
  }, [progress, book])

  // EPUB 位置变更
  const onEpubLocationChanged = useCallback((loc: string | number) => {
    setEpubLocation(loc)
    if (rendition && typeof loc === 'string') {
      try {
        const currentLocation = (rendition as any).currentLocation()
        if (currentLocation) {
          // 尝试从不同的位置结构获取百分比
          const loc_any = currentLocation as any
          const percentage = 
            loc_any?.start?.percentage ?? 
            loc_any?.percentage ?? 
            0
          saveProgress({
            currentCfi: loc,
            percentage: typeof percentage === 'number' ? percentage : 0,
          })
        }
      } catch (e) {
        console.warn('[ReaderPage] Failed to get location percentage:', e)
      }
    }
  }, [rendition, saveProgress])

  // PDF 页面变更
  const onPdfPageChange = useCallback((page: number) => {
    setPageNumber(page)
    const percentage = numPages > 0 ? page / numPages : 0
    saveProgress({
      currentPage: page,
      percentage: percentage,
      totalPages: numPages
    })
  }, [numPages, saveProgress])

  // 渲染加载中
  if (isMetaLoading || fileLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Loading...</span>
      </div>
    )
  }

  // 渲染错误
  if (metaError || fileError || !book) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-red-500">
        <AlertCircle className="h-12 w-12 mb-4" />
        <p>{metaError?.message || fileError || 'Book not found'}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate(-1)}>
          Go Back
        </Button>
      </div>
    )
  }

  const isPdf = book.originalFormat === 'pdf' || (book as any).format === 'pdf'

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* 顶部栏 */}
      <div className="h-12 border-b flex items-center px-4 justify-between bg-card z-10">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <div className="font-medium truncate max-w-[50%]">{book.title}</div>
        <div className="text-sm text-muted-foreground">
          {formatProgress(progress?.percentage || 0)}
        </div>
      </div>

      {/* 阅读区域 */}
      <div className="flex-1 relative overflow-hidden">
        {isPdf ? (
          <div className="h-full overflow-auto flex justify-center bg-gray-100 dark:bg-gray-900">
            <Document
              file={blobUrl}
              onLoadSuccess={({ numPages }) => setNumPages(numPages)}
              loading={<Loader2 className="h-8 w-8 animate-spin mt-10" />}
            >
              <PdfPageWithOcr
                pageNumber={pageNumber}
                width={800} // TODO: Implement responsive width
              />
              {/* 简单的翻页控制 (临时) */}
              <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex gap-4 bg-white/80 p-2 rounded-full shadow-lg backdrop-blur">
                <Button 
                  variant="outline" 
                  size="icon" 
                  disabled={pageNumber <= 1}
                  onClick={() => onPdfPageChange(pageNumber - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="flex items-center px-2">
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
            </Document>
          </div>
        ) : (
          <div className="h-full">
            <ReactReader
              url={blobUrl!}
              location={epubLocation || undefined}
              locationChanged={onEpubLocationChanged}
              getRendition={setRendition}
              epubOptions={{
                flow: 'scrolled', // or 'paginated'
                manager: 'continuous',
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

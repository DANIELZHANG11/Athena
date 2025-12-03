/**
 * ReaderPage - 电子书阅读器页面
 * 
 * 离线阅读架构:
 * 1. 用户点击阅读 → 检查 IndexedDB 缓存
 * 2. 如果未缓存 → 下载完整书籍到 IndexedDB
 * 3. 从 IndexedDB 读取 Blob → 本地渲染
 * 4. 服务器只负责心跳同步和进度记录
 * 
 * OCR 文字叠加:
 * 对于图片式 PDF：
 * 1. 一次性下载完整 OCR 数据（gzip 压缩）
 * 2. 存储到 IndexedDB 与书籍一起缓存
 * 3. 本地渲染透明文字层，零服务器请求
 * 4. 支持离线文字选择、复制和高亮
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { Document, pdfjs } from 'react-pdf'
import { ReactReader, type IReactReaderStyle } from 'react-reader'
import type { Rendition } from 'epubjs'
import { Virtuoso, type VirtuosoHandle, type ListRange } from 'react-virtuoso'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Loader2, ArrowLeft, Download, AlertCircle, Eye, EyeOff, Type } from 'lucide-react'
import { useReaderHeartbeat } from '@/hooks/useReaderHeartbeat'
import { useSmartHeartbeat, type PullRequired, type NoteResult } from '@/hooks/useSmartHeartbeat'
import { useReadingProgress, parsePdfLocation, parseEpubLocation, formatProgress } from '@/hooks/useReadingProgress'
import { useBookDownload, formatFileSize } from '@/hooks/useBookDownload'
import { PdfPageWithOcr } from '@/components/reader/PdfPageWithOcr'
import { useOcrData, preloadOcrToMemory, clearOcrMemoryCache } from '@/hooks/useOcrData'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// Configure PDF worker - 使用 unpkg CDN (比 cdnjs 更快更新)
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

type PdfPageMetrics = {
    originalWidth: number
    originalHeight: number
    renderedWidth: number
    renderedHeight: number
}

// React Reader 样式配置（保留供将来使用）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _readerStyles: IReactReaderStyle = {
    container: {},
    readerArea: {},
    containerExpanded: {},
    titleArea: { display: 'none' },
    reader: {},
    swipeWrapper: {},
    prev: { display: 'none' },
    next: { display: 'none' },
    arrow: { display: 'none' },
    arrowHover: {},
    tocBackground: {},
    toc: {},
    tocArea: { display: 'none' },
    tocAreaButton: {},
    tocButton: {},
    tocButtonExpanded: {},
    tocButtonBar: {},
    tocButtonBarTop: {},
    loadingView: {},
    errorView: {},
    tocButtonBottom: {}
}

const getPdfRenderWidth = () => {
    if (typeof window === 'undefined') return 800
    return Math.min(window.innerWidth * 0.9, 900)
}

export default function ReaderPage() {
    const { bookId } = useParams()
    const navigate = useNavigate()
    
    // 书籍信息
    const [book, setBook] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    
    // PDF 状态
    const [numPages, setNumPages] = useState<number>(0)
    const [pageNumber, setPageNumber] = useState(1)
    const virtuosoRef = useRef<VirtuosoHandle | null>(null)
    const pdfPageMetricsRef = useRef<Record<number, PdfPageMetrics>>({})
    const pdfLocationAppliedRef = useRef(false)
    
    // EPUB 状态
    const [rendition, setRendition] = useState<Rendition | null>(null)
    const [epubLocation, setEpubLocation] = useState<string | null>(null)
    
    // 阅读会话
    const [sessionId, setSessionId] = useState<string>('')
    const [currentProgress, setCurrentProgress] = useState(0)
    const currentProgressRef = useRef(0)  // 用于闭包中访问最新进度
    const [pendingPdfScroll, setPendingPdfScroll] = useState<number | null>(null)
    const [initialPdfPage, setInitialPdfPage] = useState<number | null>(null)
    const locationHydratedRef = useRef(false)
    const syncNowRef = useRef<() => Promise<void>>(() => Promise.resolve())
    
    // OCR 文字叠加层状态
    const [ocrLayerEnabled, setOcrLayerEnabled] = useState(false)
    const [ocrDebugMode, setOcrDebugMode] = useState(false)
    const [isImageBasedPdf, setIsImageBasedPdf] = useState(false)
    
    // 判断格式
    const isPdf = book?.original_format === 'pdf'
    const bookFormat = isPdf ? 'pdf' : 'epub'
    
    // OCR 数据管理 Hook（一次性下载 + 本地缓存）
    const {
        status: ocrStatus,
        info: ocrInfo,
        download: downloadOcrData,
        getPageRegionsSync,
    } = useOcrData({
        bookId: bookId || '',
        autoDownload: false,  // 手动触发下载
    })
    
    // 使用 IndexedDB 下载 Hook
    const {
        status: downloadStatus,
        progress: downloadProgress,
        blobUrl,
        error: downloadError,
        download,
        fileSize
    } = useBookDownload({
        bookId: bookId || '',
        format: bookFormat as 'epub' | 'pdf',
        enabled: !!bookId && !!book,
        autoDownload: true,
        onSuccess: (url) => {
            console.log('[Reader] Book ready from IndexedDB:', url)
        },
        onError: (err) => {
            console.error('[Reader] Download failed:', err)
            setError(err.message)
        }
    })
    
    // 获取保存的阅读进度
    const { progress: savedProgress } = useReadingProgress({
        bookId: bookId || '',
        enabled: !!bookId,
    })
    
    // 心跳同步（阅读会话时长）
    const { updateProgress, syncNow } = useReaderHeartbeat({
        sessionId,
        bookId: bookId || '',
        enabled: !!sessionId,
        onError: (err) => console.warn('[Reader] Heartbeat error:', err),
    })
    
    // 智能心跳同步（ADR-006: 版本对比、离线数据同步）
    const {
        state: syncState,
        updateProgress: updateSyncProgress,
        syncNow: smartSyncNow,
    } = useSmartHeartbeat({
        bookId: bookId || '',
        enabled: !!bookId && !!book,
        clientVersions: {
            ocr: ocrStatus.cached ? `cached_${bookId}` : undefined,
        },
        onPullRequired: (pull: PullRequired) => {
            // 当服务端有新的 OCR 数据时，自动下载
            if (pull.ocr && !ocrStatus.cached && !ocrStatus.downloading) {
                console.log('[Reader] Smart sync: OCR data available, downloading...')
                downloadOcrData()
            }
        },
        onNoteSyncResult: (results: NoteResult[]) => {
            // 处理笔记同步结果
            const conflicts = results.filter(r => r.status === 'conflict_copy')
            if (conflicts.length > 0) {
                console.log('[Reader] Smart sync: Note conflicts detected:', conflicts.length)
                // TODO: 显示冲突解决对话框
            }
        },
        onError: (err) => console.warn('[Reader] Smart sync error:', err),
    })
    
    useEffect(() => {
        syncNowRef.current = syncNow
    }, [syncNow])

    // 初始化：获取书籍信息和创建阅读会话
    useEffect(() => {
        const token = useAuthStore.getState().accessToken || localStorage.getItem('access_token') || ''

        const init = async () => {
            try {
                // 1. 获取书籍详情
                const res = await fetch(`/api/v1/books/${bookId}`, {
                    headers: { Authorization: `Bearer ${token}` }
                })
                if (!res.ok) throw new Error('Failed to load book info')
                const data = await res.json()
                const bookData = data.data
                console.log('[Reader] Book info loaded:', { 
                    id: bookData.id, 
                    title: bookData.title, 
                    format: bookData.original_format,
                    size: bookData.size
                })
                setBook(bookData)

                // 2. 创建阅读会话
                const sessionRes = await fetch('/api/v1/reading-sessions/start', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ book_id: bookId })
                })
                
                if (sessionRes.ok) {
                    const sessionData = await sessionRes.json()
                    const sid = sessionData.data?.id || sessionData.data?.session_id
                    if (sid) {
                        setSessionId(sid)
                        console.log('[Reader] Session started:', sid)
                    }
                }
                
                // 3. 检查是否是图片式 PDF（OCR 状态由 useOcrData hook 管理）
                if (bookData.original_format === 'pdf') {
                    try {
                        const ocrRes = await fetch(`/api/v1/books/${bookId}/ocr`, {
                            headers: { Authorization: `Bearer ${token}` }
                        })
                        if (ocrRes.ok) {
                            const ocrData = await ocrRes.json()
                            const isImageBased = ocrData.data?.is_image_based || false
                            setIsImageBasedPdf(isImageBased)
                            console.log('[Reader] PDF type:', { isImageBased })
                        }
                    } catch (e) {
                        console.log('[Reader] OCR check failed, using default text layer')
                    }
                }

            } catch (e: any) {
                console.error('[Reader] Init error:', e)
                setError(e.message)
            } finally {
                setLoading(false)
            }
        }

        if (bookId) init()
        
        return () => {
            syncNowRef.current()
            // 清理 OCR 内存缓存
            if (bookId) clearOcrMemoryCache(bookId)
        }
    }, [bookId])
    
    // OCR 数据加载：当检测到图片式 PDF 且有可用 OCR 数据时自动下载
    useEffect(() => {
        if (!bookId || !isImageBasedPdf) return
        
        // 如果已经有本地缓存，启用 OCR 层
        if (ocrStatus.cached) {
            setOcrLayerEnabled(true)
            console.log('[Reader] OCR data loaded from cache, enabling OCR layer')
            return
        }
        
        // 如果服务器有 OCR 数据但本地没有，自动下载
        if (ocrStatus.available && !ocrStatus.cached && !ocrStatus.downloading) {
            console.log('[Reader] Downloading OCR data...')
            downloadOcrData().then((success) => {
                if (success) {
                    setOcrLayerEnabled(true)
                    console.log('[Reader] OCR data downloaded and enabled')
                }
            })
        }
    }, [bookId, isImageBasedPdf, ocrStatus.available, ocrStatus.cached, ocrStatus.downloading, downloadOcrData])
    
    // 保存 updateProgress 的最新引用
    const updateProgressRef = useRef(updateProgress)
    useEffect(() => {
        updateProgressRef.current = updateProgress
    }, [updateProgress])

    // 恢复阅读进度
    useEffect(() => {
        if (locationHydratedRef.current) return
        if (!savedProgress) return
        
        console.log('[Reader] Restoring progress:', {
            progress: savedProgress.progress,
            lastLocation: savedProgress.lastLocation
        })
        
        // 恢复进度百分比显示
        if (typeof savedProgress.progress === 'number') {
            setCurrentProgress(savedProgress.progress)
            currentProgressRef.current = savedProgress.progress
        }
        
        if (savedProgress.lastLocation) {
            const epub = parseEpubLocation(savedProgress.lastLocation)
            if (epub?.cfi) {
                console.log('[Reader] Setting EPUB location:', epub.cfi)
                setEpubLocation(epub.cfi)
            }
            const pdf = parsePdfLocation(savedProgress.lastLocation)
            if (pdf?.page) {
                console.log('[Reader] Setting PDF page:', pdf.page)
                setInitialPdfPage(pdf.page)
                pdfLocationAppliedRef.current = false
            }
        } else {
            // 没有 lastLocation 但有 progress，尝试从 progress 计算页码
            setInitialPdfPage(null)
            pdfLocationAppliedRef.current = false
        }
        locationHydratedRef.current = true
    }, [savedProgress])

    // bookId 变化时重置状态
    useEffect(() => {
        locationHydratedRef.current = false
        pdfLocationAppliedRef.current = false
        setInitialPdfPage(null)
        setEpubLocation(null)
        setPendingPdfScroll(null)
    }, [bookId])

    // EPUB rendition 事件绑定
    useEffect(() => {
        if (!rendition) return
        console.log('[Reader] Binding EPUB relocated event')
        
        // 用于跟踪是否已初始化 locations
        let locationsReady = false
        
        const handleRelocated = (location: any) => {
            console.log('[Reader] EPUB relocated:', location)
            
            // 尝试从多个来源获取进度
            let progress = 0
            
            // 优先使用 start.percentage（需要 locations 已生成）
            if (typeof location?.start?.percentage === 'number' && location.start.percentage > 0) {
                progress = location.start.percentage
            }
            // 备选：尝试从 book.locations 计算
            else if (locationsReady && rendition.book?.locations?.percentageFromCfi && location?.start?.cfi) {
                try {
                    const pct = rendition.book.locations.percentageFromCfi(location.start.cfi)
                    if (typeof pct === 'number' && pct >= 0) {
                        progress = pct
                    }
                } catch (e) {
                    console.log('[Reader] Could not get percentage from CFI:', e)
                }
            }
            // 备选：使用 atEnd 标记
            else if (location?.atEnd) {
                progress = 1
            }
            
            console.log('[Reader] EPUB progress:', progress, 'locationsReady:', locationsReady)
            
            // 只有当进度有效时才更新（避免用 0 覆盖已恢复的进度）
            if (progress > 0 || location?.atStart) {
                setCurrentProgress(progress)
                currentProgressRef.current = progress
            }
            
            // 始终发送位置信息到心跳，即使 progress 是 0
            if (location?.start?.cfi) {
                const locationData = JSON.stringify({ cfi: location.start.cfi })
                // 如果 progress 是 0 但我们有保存的进度，使用保存的进度
                const progressToSend = progress > 0 ? progress : currentProgressRef.current
                updateProgressRef.current(progressToSend, locationData)
            }
        }
        
        rendition.on('relocated', handleRelocated)
        
        // 生成 locations 以支持精确进度计算
        if (rendition.book?.locations) {
            const locationsCount = rendition.book.locations.length ? rendition.book.locations.length() : 0
            if (locationsCount === 0) {
                console.log('[Reader] Generating EPUB locations...')
                rendition.book.locations.generate(1024).then(() => {
                    locationsReady = true
                    console.log('[Reader] EPUB locations generated, count:', rendition.book.locations.length())
                    // 重新获取当前位置，这次应该有正确的 percentage
                    try {
                        const currentLoc = rendition.currentLocation()
                        if (currentLoc) {
                            console.log('[Reader] Recalculating progress after locations generated')
                            handleRelocated(currentLoc)
                        }
                    } catch (e) {
                        console.log('[Reader] Could not recalculate location:', e)
                    }
                }).catch((e: any) => {
                    console.log('[Reader] Failed to generate locations:', e)
                })
            } else {
                locationsReady = true
            }
        }
        
        return () => {
            rendition.off?.('relocated', handleRelocated)
        }
    }, [rendition])
    
    // PDF 进度同步
    const syncPdfProgress = useCallback((page: number, total: number) => {
        if (total <= 0) return
        const progress = page / total
        setCurrentProgress(progress)
        currentProgressRef.current = progress
        const locationData = JSON.stringify({ page })
        updateProgressRef.current(progress, locationData)
    }, [])

    const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
        console.log('[Reader] PDF loaded, pages:', numPages)
        setNumPages(numPages)
        pdfLocationAppliedRef.current = false
    }

    const handlePrev = () => {
        if (isPdf) {
            scrollToPdfPage(pageNumber - 1)
        } else {
            rendition?.prev()
        }
    }

    const handleNext = () => {
        if (isPdf) {
            scrollToPdfPage(pageNumber + 1)
        } else {
            rendition?.next()
        }
    }

    const scrollToPdfPage = useCallback((targetPage: number, behavior: 'auto' | 'smooth' = 'smooth') => {
        if (!numPages || !virtuosoRef.current) return
        const clamped = Math.min(Math.max(targetPage, 1), numPages)
        virtuosoRef.current.scrollToIndex({ index: clamped - 1, align: 'start', behavior })
    }, [numPages])

    useEffect(() => {
        if (!pendingPdfScroll) return
        scrollToPdfPage(pendingPdfScroll, 'auto')
        setPendingPdfScroll(null)
    }, [pendingPdfScroll, scrollToPdfPage])

    useEffect(() => {
        if (!numPages || pdfLocationAppliedRef.current) return
        const target = initialPdfPage && initialPdfPage > 0 ? Math.min(initialPdfPage, numPages) : 1
        setPageNumber(target)
        setPendingPdfScroll(target)
        syncPdfProgress(target, numPages)
        pdfLocationAppliedRef.current = true
    }, [initialPdfPage, numPages, syncPdfProgress])

    const handleEpubLocationChanged = useCallback((location: string) => {
        console.log('[Reader] EPUB location changed:', location)
        if (typeof location === 'string') {
            setEpubLocation(location)
        }
    }, [])

    const handleGetRendition = useCallback((instance: Rendition) => {
        console.log('[Reader] EPUB rendition ready:', instance)
        setRendition((prev) => (prev === instance ? prev : instance))
    }, [])

    const handlePageRenderSuccess = useCallback((page: { pageNumber: number; originalWidth: number; originalHeight: number }, renderWidth: number) => {
        pdfPageMetricsRef.current[page.pageNumber] = {
            originalWidth: page.originalWidth,
            originalHeight: page.originalHeight,
            renderedWidth: renderWidth,
            renderedHeight: (page.originalHeight / page.originalWidth) * renderWidth
        }
    }, [])

    const handlePdfRangeChanged = useCallback((range: ListRange) => {
        if (!numPages) return
        const visiblePage = Math.min(range.startIndex + 1, numPages)
        if (visiblePage !== pageNumber) {
            setPageNumber(visiblePage)
            syncPdfProgress(visiblePage, numPages)
            
            // OCR 数据已一次性加载到本地，无需预加载
        }
    }, [numPages, pageNumber, syncPdfProgress])

    // 加载中状态
    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center flex-col gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-system-blue" />
                <span className="text-sm text-secondary-label">Loading book info...</span>
            </div>
        )
    }

    // 错误状态
    if (error) {
        return (
            <div className="flex h-screen flex-col items-center justify-center gap-4 p-4">
                <AlertCircle className="h-12 w-12 text-red-500" />
                <p className="text-red-500 text-center">{error}</p>
                <Button onClick={() => navigate(-1)}>Go Back</Button>
            </div>
        )
    }

    // 下载中状态
    if (downloadStatus === 'checking' || downloadStatus === 'downloading' || downloadStatus === 'saving') {
        return (
            <div className="flex h-screen flex-col items-center justify-center gap-6 p-4">
                <div className="text-center">
                    <h2 className="text-lg font-medium mb-2">{book?.title}</h2>
                    <p className="text-sm text-secondary-label">
                        {downloadStatus === 'checking' && 'Checking local cache...'}
                        {downloadStatus === 'downloading' && 'Downloading book...'}
                        {downloadStatus === 'saving' && 'Saving to local storage...'}
                    </p>
                </div>
                
                {/* 下载进度条 */}
                <div className="w-64">
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-system-blue transition-all duration-300"
                            style={{ width: `${downloadProgress}%` }}
                        />
                    </div>
                    <div className="flex justify-between mt-2 text-xs text-secondary-label">
                        <span>{downloadProgress}%</span>
                        {fileSize && <span>{formatFileSize(fileSize)}</span>}
                    </div>
                </div>
                
                <Download className="h-6 w-6 text-system-blue animate-bounce" />
            </div>
        )
    }

    // 下载失败
    if (downloadStatus === 'error' || downloadError) {
        return (
            <div className="flex h-screen flex-col items-center justify-center gap-4 p-4">
                <AlertCircle className="h-12 w-12 text-red-500" />
                <p className="text-red-500 text-center">{downloadError || 'Failed to download book'}</p>
                <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => navigate(-1)}>Go Back</Button>
                    <Button onClick={() => download()}>Retry Download</Button>
                </div>
            </div>
        )
    }

    // 书籍未就绪
    if (!blobUrl || (downloadStatus !== 'ready' && downloadStatus !== 'cached')) {
        return (
            <div className="flex h-screen items-center justify-center flex-col gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-system-blue" />
                <span className="text-sm text-secondary-label">Preparing book...</span>
            </div>
        )
    }

    // 渲染阅读器
    return (
        <div className="flex h-screen flex-col bg-system-background">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-4 py-2 shadow-sm bg-white dark:bg-gray-800">
                <Button variant="ghost" size="sm" onClick={() => { syncNow(); navigate(-1); }}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                </Button>
                <div className="flex flex-col items-center">
                    <h1 className="text-sm font-medium truncate max-w-[200px]">{book?.title}</h1>
                    <span className="text-xs text-secondary-label">{formatProgress(currentProgress)}</span>
                </div>
                {/* OCR 文字层开关（仅图片式 PDF 显示） */}
                {isPdf && isImageBasedPdf ? (
                    <div className="flex items-center gap-2">
                        {ocrStatus.downloading && (
                            <span className="text-xs text-secondary-label flex items-center">
                                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                {ocrStatus.progress}%
                            </span>
                        )}
                        {ocrStatus.cached && ocrInfo && (
                            <span className="text-xs text-secondary-label hidden sm:block">
                                {ocrInfo.totalRegions.toLocaleString()} 区域
                            </span>
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setOcrLayerEnabled(!ocrLayerEnabled)}
                            disabled={!ocrStatus.cached}
                            title={ocrLayerEnabled ? '关闭文字选择层' : '开启文字选择层'}
                        >
                            {ocrLayerEnabled ? <Type className="h-4 w-4 text-system-blue" /> : <Type className="h-4 w-4" />}
                        </Button>
                    </div>
                ) : (
                    <div className="w-[70px]" />
                )}
            </div>

            {/* Content - 使用 flex-1 和 min-h-0 确保正确计算高度 */}
            <div className="flex-1 min-h-0 overflow-hidden relative bg-gray-100 dark:bg-gray-900">
                {isPdf ? (
                    // PDF 阅读器 - 使用绝对定位确保填满容器
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                        <Document
                            file={blobUrl}
                            onLoadSuccess={onDocumentLoadSuccess}
                            onLoadError={(err) => {
                                console.error('[Reader] PDF load error:', err)
                                setError('Failed to load PDF: ' + (err?.message || 'Unknown error'))
                            }}
                            loading={
                                <div className="flex items-center justify-center h-64">
                                    <Loader2 className="h-8 w-8 animate-spin text-system-blue" />
                                    <span className="ml-2">Loading PDF...</span>
                                </div>
                            }
                        >
                            {numPages > 0 ? (
                                <Virtuoso
                                    ref={virtuosoRef}
                                    style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                                    totalCount={numPages}
                                    rangeChanged={handlePdfRangeChanged}
                                    itemContent={(index) => {
                                        const pageIndex = index + 1
                                        const renderWidth = getPdfRenderWidth()
                                        // 从本地缓存同步获取当前页的 OCR 区域
                                        const pageRegions = ocrLayerEnabled && isImageBasedPdf 
                                            ? getPageRegionsSync(pageIndex)
                                            : []
                                        return (
                                            <div
                                                key={`page-${pageIndex}`}
                                                className="mb-8 flex justify-center"
                                            >
                                                <PdfPageWithOcr
                                                    bookId={bookId!}
                                                    pageNumber={pageIndex}
                                                    width={renderWidth}
                                                    enableOcrLayer={ocrLayerEnabled && isImageBasedPdf}
                                                    ocrRegions={pageRegions}
                                                    ocrImageWidth={ocrInfo?.imageWidth || 1240}
                                                    ocrImageHeight={ocrInfo?.imageHeight || 1754}
                                                    debugOcr={ocrDebugMode}
                                                    onRenderSuccess={(page) => handlePageRenderSuccess(page, renderWidth)}
                                                />
                                            </div>
                                        )
                                    }}
                                />
                            ) : (
                                <div className="flex h-full items-center justify-center">
                                    <Loader2 className="h-8 w-8 animate-spin text-system-blue" />
                                </div>
                            )}
                        </Document>
                    </div>
                ) : (
                    // EPUB 阅读器 - 必须有明确的固定高度（不能是百分比）
                    // Header 高度约 52px
                    <div style={{ 
                        height: 'calc(100vh - 52px)',
                        width: '100%',
                        position: 'relative'
                    }}>
                        <ReactReader
                            url={blobUrl!}
                            location={epubLocation || undefined}
                            locationChanged={handleEpubLocationChanged}
                            getRendition={handleGetRendition}
                            showToc={false}
                            // 关键：告诉 epub.js 这是 EPUB 文件（Blob URL 没有 .epub 后缀）
                            epubInitOptions={{
                                openAs: 'epub',
                            }}
                            epubOptions={{
                                flow: 'paginated',
                                manager: 'default'
                            }}
                            loadingView={
                                <div className="flex h-full items-center justify-center">
                                    <Loader2 className="h-8 w-8 animate-spin text-system-blue" />
                                    <span className="ml-2">Loading EPUB...</span>
                                </div>
                            }
                            errorView={
                                <div className="flex h-full flex-col items-center justify-center gap-4 p-4">
                                    <AlertCircle className="h-12 w-12 text-red-500" />
                                    <p className="text-red-500 text-center">Failed to load EPUB</p>
                                    <Button onClick={() => navigate(-1)}>Go Back</Button>
                                </div>
                            }
                        />
                    </div>
                )}

                {/* Navigation Controls */}
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-white/90 dark:bg-black/90 px-6 py-2 rounded-full shadow-lg backdrop-blur">
                    <Button variant="ghost" size="sm" onClick={handlePrev} disabled={isPdf && pageNumber <= 1}>
                        <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <span className="text-sm font-medium min-w-20 text-center">
                        {isPdf ? `${pageNumber} / ${numPages || '-'}` : formatProgress(currentProgress)}
                    </span>
                    <Button variant="ghost" size="sm" onClick={handleNext} disabled={isPdf && pageNumber >= numPages}>
                        <ChevronRight className="h-5 w-5" />
                    </Button>
                </div>
            </div>
        </div>
    )
}

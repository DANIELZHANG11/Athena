/**
 * PdfReader - PDF 专用阅读器组件
 * 
 * 从 ReaderPage 拆分，专注于 PDF 阅读功能
 * 使用 react-pdf 渲染，支持 OCR overlay
 * 
 * 【2026-01-30 修复】完全自适应视口，禁止整体滚动
 * - 阅读器固定在视口内，不允许上下左右滚动
 * - PDF 页面自适应可用空间高度
 * - 只允许通过翻页按钮或热区切换页面
 * 
 * 【2026-01-31 新增】PDF 目录（TOC）侧边栏
 * - 支持从 PDF 内置 outline/bookmarks 提取的目录
 * - 点击目录项跳转到对应页面
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { Document, pdfjs } from 'react-pdf'
import { Button } from '@/components/ui/button'
import {
    ChevronLeft,
    ChevronRight,
    Loader2,
    AlertCircle,
    ZoomIn,
    ZoomOut,
    List,
    X
} from 'lucide-react'
import { PdfPageWithOcr } from '@/components/reader/PdfPageWithOcr'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import './PdfReader.css'

// 配置 PDF worker - 使用本地导入方式（推荐，避免 CDN 网络问题）
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString()

// 顶部工具栏高度（py-2 + 内容）约 48px
const HEADER_HEIGHT = 48
// 底部导航栏高度（py-3 + 内容）约 52px  
const FOOTER_HEIGHT = 52
// 安全边距
const VERTICAL_PADDING = 16

/**
 * PDF 目录项类型（与 EPUB TocItem 兼容）
 * 后端通过 PyMuPDF get_toc() 提取
 */
export interface PdfTocItem {
    label: string      // 章节标题
    page: number       // 目标页码 (1-based)
    subitems?: PdfTocItem[]  // 子章节
}

export interface PdfReaderProps {
    url: string
    bookId: string
    bookTitle: string
    initialPage?: number
    /** PDF 目录（从书籍元数据 API 获取） */
    toc?: PdfTocItem[] | null
    onPageChanged?: (page: number, totalPages: number, percentage: number) => void
    onBack?: () => void
}

// PDF.js 配置选项 - 必须在组件外部定义以避免重复创建
const pdfOptions = {
    // 支持中文等非拉丁字符
    cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
    cMapPacked: true,
    // 标准字体支持
    standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/standard_fonts/`,
}

export default function PdfReader({
    url,
    bookId,
    bookTitle,
    initialPage = 1,
    toc,
    onPageChanged,
    onBack,
}: PdfReaderProps) {
    const [numPages, setNumPages] = useState<number>(0)
    const [pageNumber, setPageNumber] = useState(initialPage)
    const [scale, setScale] = useState(1.0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    // 目录侧边栏显示状态
    const [showToc, setShowToc] = useState(false)
    
    // 容器尺寸追踪
    const containerRef = useRef<HTMLDivElement>(null)
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })

    // 添加调试日志
    useEffect(() => {
        console.log('[PdfReader] Component mounted with URL:', url?.substring(0, 50))
        console.log('[PdfReader] Worker URL:', pdfjs.GlobalWorkerOptions.workerSrc)
        if (toc) {
            console.log('[PdfReader] TOC loaded:', toc.length, 'top-level items')
        }
    }, [url, toc])
    }, [url])
    
    // 监听容器尺寸变化
    useEffect(() => {
        const updateSize = () => {
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect()
                setContainerSize({
                    width: rect.width,
                    height: rect.height
                })
                console.log('[PdfReader] Container size updated:', rect.width, 'x', rect.height)
            }
        }
        
        // 初始化
        updateSize()
        
        // 监听窗口大小变化
        window.addEventListener('resize', updateSize)
        
        // 使用 ResizeObserver 监听容器变化
        const resizeObserver = new ResizeObserver(updateSize)
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current)
        }
        
        return () => {
            window.removeEventListener('resize', updateSize)
            resizeObserver.disconnect()
        }
    }, [])

    // PDF 加载成功
    const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
        console.log('[PdfReader] Document loaded, pages:', numPages)
        setNumPages(numPages)
        setLoading(false)
        // 恢复到初始页面
        if (initialPage > 1 && initialPage <= numPages) {
            setPageNumber(initialPage)
        }
    }, [initialPage])

    // PDF 加载失败
    const onDocumentLoadError = useCallback((error: Error) => {
        console.error('[PdfReader] Document load error:', error)
        console.error('[PdfReader] Error stack:', error.stack)
        setError(error.message || 'Failed to load PDF')
        setLoading(false)
    }, [])

    // 页面变更
    const goToPage = useCallback((page: number) => {
        const targetPage = Math.max(1, Math.min(page, numPages))
        console.log('[PdfReader] Going to page:', targetPage)
        setPageNumber(targetPage)

        if (onPageChanged && numPages > 0) {
            const percentage = targetPage / numPages
            onPageChanged(targetPage, numPages, percentage)
        }
    }, [numPages, onPageChanged])

    const goNext = useCallback(() => goToPage(pageNumber + 1), [pageNumber, goToPage])
    const goPrev = useCallback(() => goToPage(pageNumber - 1), [pageNumber, goToPage])

    // 缩放
    const zoomIn = useCallback(() => setScale(s => Math.min(s + 0.25, 3.0)), [])
    const zoomOut = useCallback(() => setScale(s => Math.max(s - 0.25, 0.5)), [])

    // TOC 导航：跳转到指定页
    const handleTocClick = useCallback((page: number) => {
        console.log('[PdfReader] TOC navigation to page:', page)
        goToPage(page)
        setShowToc(false)
    }, [goToPage])

    // 渲染 TOC 项（递归支持子章节）
    const renderTocItems = useCallback((items: PdfTocItem[], depth = 0) => {
        return items.map((item, index) => (
            <div key={`${depth}-${index}`}>
                <button
                    className="pdf-reader__toc-item"
                    style={{ paddingLeft: `${16 + depth * 16}px` }}
                    onClick={() => handleTocClick(item.page)}
                >
                    <span className="pdf-reader__toc-label">{item.label}</span>
                    <span className="pdf-reader__toc-page">{item.page}</span>
                </button>
                {item.subitems && item.subitems.length > 0 && (
                    renderTocItems(item.subitems, depth + 1)
                )}
            </div>
        ))
    }, [handleTocClick])

    // 键盘导航
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowRight' || e.key === ' ') {
                e.preventDefault()
                goNext()
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault()
                goPrev()
            } else if (e.key === '+' || e.key === '=') {
                e.preventDefault()
                zoomIn()
            } else if (e.key === '-') {
                e.preventDefault()
                zoomOut()
            } else if (e.key === 'Escape') {
                // ESC 关闭目录
                setShowToc(false)
            } else if (e.key === 't' || e.key === 'T') {
                // T 键切换目录显示
                if (toc && toc.length > 0) {
                    setShowToc(prev => !prev)
                }
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [goNext, goPrev, zoomIn, zoomOut, toc])

    // 【关键修复】计算 PDF 页面应该使用的高度
    // 基于容器实际可用高度，减去垂直边距，并应用缩放
    const pageHeight = Math.max(
        200, // 最小高度
        (containerSize.height - VERTICAL_PADDING) * scale
    )

    // 是否有目录可显示
    const hasToc = toc && toc.length > 0

    // 错误 - 只有在出错时才显示错误界面
    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-red-500">
                <AlertCircle className="h-12 w-12 mb-4" />
                <p>PDF 加载失败</p>
                <p className="text-sm text-muted-foreground mt-2">{error}</p>
            </div>
        )
    }

    return (
        // 【修复】使用固定定位，确保阅读器填满整个视口，禁止滚动
        <div className="fixed inset-0 flex flex-col bg-background overflow-hidden">
            {/* 顶部工具栏 - 固定高度 */}
            <header 
                className="flex-none flex items-center justify-between px-4 py-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-10"
                style={{ height: HEADER_HEIGHT }}
            >
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={onBack}>
                        <ChevronLeft className="h-5 w-5" />
                    </Button>
                    {/* 目录按钮 - 仅在有目录时显示 */}
                    {hasToc && (
                        <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => setShowToc(prev => !prev)}
                            className={showToc ? 'bg-accent' : ''}
                            aria-label="目录"
                        >
                            <List className="h-5 w-5" />
                        </Button>
                    )}
                </div>
                <h1 className="text-sm font-medium truncate max-w-[200px] md:max-w-md">
                    {bookTitle}
                </h1>
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={zoomOut}>
                        <ZoomOut className="h-4 w-4" />
                    </Button>
                    <span className="text-xs text-muted-foreground min-w-[40px] text-center">
                        {Math.round(scale * 100)}%
                    </span>
                    <Button variant="ghost" size="icon" onClick={zoomIn}>
                        <ZoomIn className="h-4 w-4" />
                    </Button>
                </div>
            </header>

            {/* TOC 侧边栏 */}
            {showToc && hasToc && (
                <>
                    {/* 遮罩层 */}
                    <div 
                        className="pdf-reader__toc-overlay" 
                        onClick={() => setShowToc(false)} 
                    />
                    {/* 目录面板 */}
                    <aside className="pdf-reader__toc">
                        <div className="pdf-reader__toc-header">
                            <h2 className="pdf-reader__toc-title">目录</h2>
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => setShowToc(false)}
                                className="h-8 w-8"
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                        <nav className="pdf-reader__toc-list">
                            {renderTocItems(toc)}
                        </nav>
                    </aside>
                </>
            )}

            {/* PDF 阅读区域 - 自适应剩余高度，禁止滚动 */}
            <div 
                ref={containerRef}
                className="flex-1 relative overflow-hidden flex items-center justify-center"
            >
                <Document
                    file={url}
                    options={pdfOptions}
                    onLoadSuccess={onDocumentLoadSuccess}
                    onLoadError={onDocumentLoadError}
                    loading={
                        <div className="flex items-center justify-center p-8">
                            <Loader2 className="h-8 w-8 animate-spin" />
                            <span className="ml-2">正在解析 PDF...</span>
                        </div>
                    }
                    error={
                        <div className="flex flex-col items-center justify-center p-8 text-red-500">
                            <AlertCircle className="h-8 w-8 mb-2" />
                            <span>PDF 文件解析失败</span>
                        </div>
                    }
                >
                    {/* 【关键】使用 height 约束 PDF 页面，使其自适应容器高度 */}
                    <PdfPageWithOcr
                        bookId={bookId}
                        pageNumber={pageNumber}
                        height={pageHeight}
                    />
                </Document>

                {/* 左右翻页热区 - 只在加载完成后显示 */}
                {!loading && numPages > 0 && (
                    <>
                        <button
                            className="absolute left-0 top-0 w-1/4 h-full opacity-0 hover:opacity-10 bg-black transition-opacity cursor-pointer z-10"
                            onClick={goPrev}
                            disabled={pageNumber <= 1}
                            aria-label="上一页"
                        />
                        <button
                            className="absolute right-0 top-0 w-1/4 h-full opacity-0 hover:opacity-10 bg-black transition-opacity cursor-pointer z-10"
                            onClick={goNext}
                            disabled={pageNumber >= numPages}
                            aria-label="下一页"
                        />
                    </>
                )}
            </div>

            {/* 底部导航 - 固定高度，只在加载完成后显示 */}
            {!loading && numPages > 0 && (
                <footer 
                    className="flex-none flex items-center justify-center gap-4 px-4 py-3 border-t bg-background/95 backdrop-blur"
                    style={{ height: FOOTER_HEIGHT }}
                >
                    <Button
                        variant="ghost"
                        size="icon"
                        disabled={pageNumber <= 1}
                        onClick={goPrev}
                    >
                        <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <span className="text-sm font-medium min-w-[80px] text-center">
                        {pageNumber} / {numPages}
                    </span>
                    <Button
                        variant="ghost"
                        size="icon"
                        disabled={pageNumber >= numPages}
                        onClick={goNext}
                    >
                        <ChevronRight className="h-5 w-5" />
                    </Button>
                </footer>
            )}
        </div>
    )
}

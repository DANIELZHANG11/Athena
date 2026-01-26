/**
 * PdfReader - PDF 专用阅读器组件
 * 
 * 从 ReaderPage 拆分，专注于 PDF 阅读功能
 * 使用 react-pdf 渲染，支持 OCR overlay
 */

import { useState, useCallback, useEffect } from 'react'
import { Document, pdfjs } from 'react-pdf'
import { Button } from '@/components/ui/button'
import {
    ChevronLeft,
    ChevronRight,
    Loader2,
    AlertCircle,
    ZoomIn,
    ZoomOut
} from 'lucide-react'
import { PdfPageWithOcr } from '@/components/reader/PdfPageWithOcr'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// 配置 PDF worker - 使用本地导入方式（推荐，避免 CDN 网络问题）
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString()

export interface PdfReaderProps {
    url: string
    bookId: string
    bookTitle: string
    initialPage?: number
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
    onPageChanged,
    onBack,
}: PdfReaderProps) {
    const [numPages, setNumPages] = useState<number>(0)
    const [pageNumber, setPageNumber] = useState(initialPage)
    const [scale, setScale] = useState(1.0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // 添加调试日志
    useEffect(() => {
        console.log('[PdfReader] Component mounted with URL:', url?.substring(0, 50))
        console.log('[PdfReader] Worker URL:', pdfjs.GlobalWorkerOptions.workerSrc)
    }, [url])

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
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [goNext, goPrev, zoomIn, zoomOut])

    // 计算页面宽度（基于缩放比例）
    const pageWidth = Math.min(800, typeof window !== 'undefined' ? window.innerWidth - 32 : 768) * scale

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
        <div className="flex flex-col h-full bg-background">
            {/* 顶部工具栏 */}
            <header className="flex items-center justify-between px-4 py-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-10">
                <Button variant="ghost" size="icon" onClick={onBack}>
                    <ChevronLeft className="h-5 w-5" />
                </Button>
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

            {/* PDF 阅读区域 */}
            <div className="flex-1 overflow-auto relative">
                <div className="min-h-full flex justify-center py-4">
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
                        <PdfPageWithOcr
                            bookId={bookId}
                            pageNumber={pageNumber}
                            width={pageWidth}
                        />
                    </Document>
                </div>

                {/* 左右翻页热区 - 只在加载完成后显示 */}
                {!loading && numPages > 0 && (
                    <>
                        <button
                            className="absolute left-0 top-0 w-1/4 h-full opacity-0 hover:opacity-10 bg-black transition-opacity cursor-pointer"
                            onClick={goPrev}
                            disabled={pageNumber <= 1}
                            aria-label="上一页"
                        />
                        <button
                            className="absolute right-0 top-0 w-1/4 h-full opacity-0 hover:opacity-10 bg-black transition-opacity cursor-pointer"
                            onClick={goNext}
                            disabled={pageNumber >= numPages}
                            aria-label="下一页"
                        />
                    </>
                )}
            </div>

            {/* 底部导航 - 只在加载完成后显示 */}
            {!loading && numPages > 0 && (
                <footer className="flex items-center justify-center gap-4 px-4 py-3 border-t bg-background/95 backdrop-blur">
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

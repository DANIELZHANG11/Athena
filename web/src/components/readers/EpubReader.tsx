/**
 * EpubReader - EPUB 阅读器（使用 foliate-js）
 *
 * 全屏沉浸式阅读体验：
 * 1. 透明翻页区域（左右两侧）
 * 2. 自动隐藏的顶部/底部栏（点击中间区域显示/隐藏）
 * 3. 全屏阅读容器
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronLeft, Menu, X } from 'lucide-react'
import './EpubReader.css'

export interface EpubReaderProps {
    data: ArrayBuffer
    bookTitle: string
    initialLocation?: string | number | null
    onLocationChanged?: (cfi: string, percentage: number) => void
    onBack?: () => void
}

interface TocItem {
    label: string
    href: string
    subitems?: TocItem[]
}

// 声明 foliate-view 元素类型
interface FoliateViewElement extends HTMLElement {
    open: (file: File | Blob | string) => Promise<void>
    init: (options: { lastLocation?: string; showTextStart?: boolean }) => Promise<void>
    goTo: (target: string | number) => Promise<void>
    goLeft: () => Promise<void>
    goRight: () => Promise<void>
    book?: {
        metadata?: { title?: string }
        toc?: TocItem[]
        dir?: string
    }
    renderer?: {
        setStyles?: (css: string) => void
        next: () => void
    }
}

// 脚本加载状态
let scriptsLoaded = false
let scriptsLoading: Promise<void> | null = null

// 动态加载 foliate-js 脚本
const loadFoliateScripts = async (): Promise<void> => {
    if (scriptsLoaded) return
    if (scriptsLoading) return scriptsLoading

    scriptsLoading = new Promise<void>((resolve) => {
        const script = document.createElement('script')
        script.type = 'module'
        script.textContent = `
            import '/foliate-js/view.js';
            window.foliateReady = true;
            window.dispatchEvent(new Event('foliate-ready'));
        `
        document.head.appendChild(script)

        const checkReady = () => {
            if ((window as any).foliateReady) {
                scriptsLoaded = true
                resolve()
            } else {
                window.addEventListener('foliate-ready', () => {
                    scriptsLoaded = true
                    resolve()
                }, { once: true })
            }
        }

        setTimeout(checkReady, 100)
        setTimeout(() => {
            if (!scriptsLoaded) checkReady()
        }, 1000)
        setTimeout(() => {
            if (!scriptsLoaded) {
                scriptsLoaded = true
                resolve()
            }
        }, 3000)
    })

    return scriptsLoading
}

export default function EpubReader({
    data,
    bookTitle,
    initialLocation,
    onLocationChanged,
    onBack,
}: EpubReaderProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<FoliateViewElement | null>(null)
    const hideTimeoutRef = useRef<number | null>(null)

    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [currentPercentage, setCurrentPercentage] = useState(0)
    const [toc, setToc] = useState<TocItem[]>([])
    const [showToc, setShowToc] = useState(false)
    const [currentChapter, setCurrentChapter] = useState('')

    // 页面/位置信息（EPUB没有固定页码，使用section索引）
    const [currentSection, setCurrentSection] = useState(1)
    const [totalSections, setTotalSections] = useState(1)

    // 控制顶部/底部栏的显示隐藏
    const [showBars, setShowBars] = useState(true)

    // 自动隐藏定时器
    const startAutoHideTimer = useCallback(() => {
        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current)
        }
        hideTimeoutRef.current = window.setTimeout(() => {
            if (!showToc) {
                setShowBars(false)
            }
        }, 3000) // 3秒后自动隐藏
    }, [showToc])

    // 清除定时器
    const clearAutoHideTimer = useCallback(() => {
        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current)
            hideTimeoutRef.current = null
        }
    }, [])

    // 切换显示/隐藏
    const toggleBars = useCallback(() => {
        setShowBars(prev => !prev)
        if (!showBars) {
            startAutoHideTimer()
        }
    }, [showBars, startAutoHideTimer])

    // 初始化 foliate-js
    useEffect(() => {
        if (!containerRef.current || !data) return

        let mounted = true

        const init = async () => {
            try {
                console.log('[EpubReader] 1. Loading foliate-js scripts...')
                await loadFoliateScripts()

                if (!mounted || !containerRef.current) return
                console.log('[EpubReader] 2. Creating foliate-view element...')

                const view = document.createElement('foliate-view') as FoliateViewElement
                view.style.width = '100%'
                view.style.height = '100%'

                view.addEventListener('relocate', ((e: CustomEvent) => {
                    const { fraction, tocItem, cfi, section } = e.detail
                    console.log('[EpubReader] Relocated:', ((fraction || 0) * 100).toFixed(2) + '%', e.detail)

                    setCurrentPercentage(fraction || 0)
                    if (tocItem?.label) {
                        setCurrentChapter(tocItem.label)
                    }

                    // 更新section位置信息
                    if (section) {
                        setCurrentSection((section.current || 0) + 1)  // 转为1-indexed
                        setTotalSections(section.total || 1)
                    }

                    if (onLocationChanged && cfi) {
                        onLocationChanged(cfi, fraction || 0)
                    }
                }) as EventListener)

                containerRef.current.appendChild(view)
                viewRef.current = view

                const blob = new Blob([data], { type: 'application/epub+zip' })
                const file = new File([blob], 'book.epub', { type: 'application/epub+zip' })

                console.log('[EpubReader] 3. Opening book...')
                await view.open(file)

                if (!mounted) return
                console.log('[EpubReader] 4. Book opened:', view.book?.metadata?.title)

                if (view.book?.toc) {
                    setToc(view.book.toc)
                }

                view.renderer?.setStyles?.(`
                    @namespace epub "http://www.idpf.org/2007/ops";
                    html { color-scheme: light dark; }
                    p, li, blockquote, dd {
                        line-height: 1.6;
                        text-align: justify;
                        -webkit-hyphens: auto;
                        hyphens: auto;
                    }
                `)

                console.log('[EpubReader] 5. Initializing position...')
                if (initialLocation && typeof initialLocation === 'string') {
                    await view.init({ lastLocation: initialLocation })
                } else {
                    await view.init({ showTextStart: true })
                }

                if (!mounted) return
                setIsLoading(false)
                console.log('[EpubReader] 6. Initialization complete!')

                // 开始自动隐藏计时
                startAutoHideTimer()

            } catch (err) {
                console.error('[EpubReader] Error:', err)
                if (mounted) {
                    setError(err instanceof Error ? err.message : 'Failed to load book')
                    setIsLoading(false)
                }
            }
        }

        init()

        return () => {
            mounted = false
            clearAutoHideTimer()
            if (viewRef.current) {
                viewRef.current.remove()
                viewRef.current = null
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data])

    // 翻页函数
    const handlePrev = useCallback(() => {
        const view = viewRef.current
        if (!view || isLoading) return
        console.log('[EpubReader] goLeft()')
        view.goLeft()
    }, [isLoading])

    const handleNext = useCallback(() => {
        const view = viewRef.current
        if (!view || isLoading) return
        console.log('[EpubReader] goRight()')
        view.goRight()
    }, [isLoading])

    const handleTocClick = useCallback((href: string) => {
        const view = viewRef.current
        if (!view) return
        console.log('[EpubReader] goTo:', href)
        view.goTo(href)
        setShowToc(false)
        setShowBars(false)
    }, [])

    // 键盘导航
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft' || e.key === 'h') handlePrev()
            else if (e.key === 'ArrowRight' || e.key === 'l') handleNext()
            else if (e.key === 'Escape') {
                setShowToc(false)
                setShowBars(prev => !prev)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [handlePrev, handleNext])

    // 渲染 TOC 项
    const renderTocItems = (items: TocItem[]) => {
        return items.map((item, index) => (
            <div key={index}>
                <button
                    className="epub-reader__toc-item"
                    onClick={() => handleTocClick(item.href)}
                >
                    {item.label}
                </button>
                {item.subitems && item.subitems.length > 0 && (
                    <div style={{ paddingLeft: '16px' }}>
                        {renderTocItems(item.subitems)}
                    </div>
                )}
            </div>
        ))
    }

    if (error) {
        return (
            <div className="epub-reader">
                <header className="epub-reader__header epub-reader__header--visible">
                    <button className="epub-reader__back-btn" onClick={onBack}>
                        <ChevronLeft size={24} />
                    </button>
                    <div className="epub-reader__title">
                        <span className="epub-reader__book-title">{bookTitle}</span>
                    </div>
                    <div style={{ width: 40 }} />
                </header>
                <div className="epub-reader__content" style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexDirection: 'column', gap: '16px'
                }}>
                    <p style={{ color: 'red' }}>加载失败: {error}</p>
                    <button onClick={onBack}>返回</button>
                </div>
            </div>
        )
    }

    return (
        <div className="epub-reader">
            {/* 顶部栏 - 可隐藏 */}
            <header className={`epub-reader__header ${showBars ? 'epub-reader__header--visible' : ''}`}>
                <button className="epub-reader__back-btn" onClick={onBack}>
                    <ChevronLeft size={24} />
                </button>
                <div className="epub-reader__title">
                    <span className="epub-reader__book-title">{bookTitle}</span>
                    {currentChapter && <span className="epub-reader__chapter">{currentChapter}</span>}
                </div>
                <button className="epub-reader__menu-btn" onClick={() => setShowToc(!showToc)}>
                    {showToc ? <X size={24} /> : <Menu size={24} />}
                </button>
            </header>

            {/* 阅读区域 - 全屏 */}
            <main className="epub-reader__content">
                {/* 左侧透明翻页区域 */}
                <div
                    className="epub-reader__nav-zone epub-reader__nav-zone--left"
                    onClick={handlePrev}
                    aria-label="上一页"
                />

                {/* 中间点击区域 - 切换显示/隐藏 */}
                <div
                    className="epub-reader__center-zone"
                    onClick={toggleBars}
                />

                {/* 右侧透明翻页区域 */}
                <div
                    className="epub-reader__nav-zone epub-reader__nav-zone--right"
                    onClick={handleNext}
                    aria-label="下一页"
                />

                {/* foliate-view 容器 */}
                <div ref={containerRef} className="epub-reader__viewer" />

                {isLoading && (
                    <div className="epub-reader__loading">
                        <div className="epub-reader__spinner" />
                        <span>加载中...</span>
                    </div>
                )}
            </main>

            {/* 目录侧边栏 */}
            {showToc && (
                <aside className="epub-reader__toc">
                    <h2 className="epub-reader__toc-title">目录</h2>
                    <nav className="epub-reader__toc-list">
                        {renderTocItems(toc)}
                    </nav>
                </aside>
            )}

            {/* 底部进度栏 - 与顶部栏同步显示/隐藏 */}
            <footer className={`epub-reader__footer ${showBars ? 'epub-reader__footer--visible' : ''}`}>
                <span className="epub-reader__page-info">
                    {currentSection}/{totalSections} · {(currentPercentage * 100).toFixed(1)}%
                </span>
            </footer>
        </div>
    )
}

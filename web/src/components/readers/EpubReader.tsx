/**
 * EpubReader - EPUB 阅读器（使用 foliate-js）
 *
 * 全屏沉浸式阅读体验：
 * 1. 透明翻页区域（左右两侧）
 * 2. 自动隐藏的顶部/底部栏（点击中间区域显示/隐藏）
 * 3. 全屏阅读容器
 * 4. 高亮和笔记功能（Apple Books 风格）
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Menu, X, Settings, BookMarked, Headphones, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { DEFAULT_SETTINGS, type ReadingSettings, useReadingSettings, type FontFamily } from '@/hooks/useReadingSettings'
import { useFontDownload } from '@/hooks/useFontDownload'
import { fontService } from '@/services/fontService'
import { ReaderSettingsSheet, FontDownloadToast, HighlightToolbar, NoteEditor, AnnotationList } from '@/components/reader'
import { useBookAnnotations, type TextSelection } from '@/hooks/useBookAnnotations'
import { type HighlightColor, DEFAULT_HIGHLIGHT_COLOR } from '@/lib/highlightColors'
import './EpubReader.css'

// 根据阅读设置生成CSS字符串（使用自托管字体）
function generateReaderCSS(settings: ReadingSettings): string {
    const fontFamilyMap: Record<string, string> = {
        'system': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
        'noto-serif-sc': '"Noto Serif SC", serif',
        'noto-sans-sc': '"Noto Sans SC", sans-serif',
        'lxgw-wenkai': '"LXGW WenKai", cursive',
        'georgia': 'Georgia, serif',
        'helvetica': 'Helvetica, Arial, sans-serif',
    }

    const fontFamily = fontFamilyMap[settings.fontFamily] || fontFamilyMap['system']
    const hyphenation = settings.hyphenation ? 'auto' : 'none'
    const textAlign = settings.textAlign === 'justify' ? 'justify' : 'left'

    // 使用自托管字体生成 @font-face 规则
    // 字体文件位于 /fonts/ 目录，由 fontService 管理
    const fontFaceRules = fontService.generateFontFaceCSS(settings.fontFamily as FontFamily)

    return `
        @namespace epub "http://www.idpf.org/2007/ops";
        ${fontFaceRules}
        
        /* 强制启用文本选择 - 修复鼠标无法选择文字的问题 */
        *, *::before, *::after {
            -webkit-user-select: text !important;
            -moz-user-select: text !important;
            -ms-user-select: text !important;
            user-select: text !important;
            -webkit-touch-callout: default !important;
        }
        
        /* 选中文本的高亮样式 */
        ::selection {
            background-color: rgba(0, 122, 255, 0.3) !important;
            color: inherit !important;
        }
        ::-moz-selection {
            background-color: rgba(0, 122, 255, 0.3) !important;
            color: inherit !important;
        }
        
        html {
            background: ${settings.backgroundColor} !important;
            color: ${settings.textColor} !important;
        }
        body {
            background: ${settings.backgroundColor} !important;
            color: ${settings.textColor} !important;
            font-family: ${fontFamily} !important;
            font-size: ${settings.fontSize}px !important;
            font-weight: ${settings.fontWeight} !important;
            line-height: ${settings.lineHeight} !important;
            padding: 0 ${settings.marginHorizontal}px !important;
            /* 确保 body 也可选择 */
            cursor: text;
        }
        p, li, blockquote, dd, div {
            line-height: ${settings.lineHeight} !important;
            text-align: ${textAlign} !important;
            -webkit-hyphens: ${hyphenation} !important;
            hyphens: ${hyphenation} !important;
        }
        a { color: ${settings.textColor} !important; }
    `
}

export interface EpubReaderProps {
    data: ArrayBuffer
    bookId?: string  // 用于保存每本书的阅读设置
    bookTitle: string
    initialLocation?: string | number | { type: 'section', index: number } | null
    onLocationChanged?: (cfi: string, percentage: number) => void
    onBack?: () => void
    /** foliate-view 元素准备就绪回调（用于 TTS 初始化） */
    onViewReady?: (view: FoliateViewElement) => void
}

interface TocItem {
    label: string
    href: string
    subitems?: TocItem[]
}

// 声明 foliate-view 元素类型（导出供 TTS 使用）
export interface FoliateViewElement extends HTMLElement {
    open: (file: File | Blob | string) => Promise<void>
    init: (options: { lastLocation?: string; showTextStart?: boolean }) => Promise<void>
    goTo: (target: string | number) => Promise<void>
    goLeft: () => Promise<void>
    goRight: () => Promise<void>
    /** 初始化 TTS (foliate-js 内置) */
    initTTS?: (granularity?: 'word' | 'sentence', highlight?: (range: Range) => void) => Promise<void>
    /** TTS 实例 (foliate-js 内置) */
    tts?: {
        doc: Document
        highlight: (range: Range) => void
        start: () => string | undefined
        resume: () => string | undefined
        prev: (paused?: boolean) => string | undefined
        next: (paused?: boolean) => string | undefined
        from: (range: Range) => string | undefined
        setMark: (mark: string) => void
    }
    book?: {
        metadata?: { title?: string; language?: string }
        toc?: TocItem[]
        dir?: string
        sections?: Array<{
            id: string
            linear: string
            createDocument: () => Promise<Document>
        }>
    }
    renderer?: {
        setStyles?: (css: string) => void
        next: () => void
        getContents?: () => Array<{ doc: Document; index: number }>
        scrollToAnchor?: (range: Range, smooth?: boolean) => void
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
    bookId,
    bookTitle,
    initialLocation,
    onLocationChanged,
    onBack,
    onViewReady,
}: EpubReaderProps) {
    const { t } = useTranslation('reader')
    const navigate = useNavigate()
    const containerRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<FoliateViewElement | null>(null)
    const hideTimeoutRef = useRef<number | null>(null)

    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [currentPercentage, setCurrentPercentage] = useState(0)
    const [toc, setToc] = useState<TocItem[]>([])
    const [showToc, setShowToc] = useState(false)
    const [showSettings, setShowSettings] = useState(false)
    const [currentChapter, setCurrentChapter] = useState('')

    // 页面/位置信息（EPUB没有固定页码，使用section索引）
    const [currentSection, setCurrentSection] = useState(1)
    const [totalSections, setTotalSections] = useState(1)

    // 控制顶部/底部栏的显示隐藏
    const [showBars, setShowBars] = useState(true)

    // 字体下载状态（需要显示进度）
    const [showFontDownload, setShowFontDownload] = useState(false)

    // === 高亮和笔记状态 ===
    const [showAnnotations, setShowAnnotations] = useState(false)
    const [showNoteEditor, setShowNoteEditor] = useState(false)
    const [currentSelection, setCurrentSelection] = useState<TextSelection | null>(null)
    const [toolbarPosition, setToolbarPosition] = useState<{ x: number; y: number } | null>(null)
    const [editingNote, setEditingNote] = useState<{ id: string; content: string; color: HighlightColor } | null>(null)

    // PowerSync 设置持久化
    const { settings: savedSettings, updateSettings: persistSettings } = useReadingSettings(bookId)

    // 本地阅读设置（实时预览用）
    const [localSettings, setLocalSettings] = useState<ReadingSettings>(DEFAULT_SETTINGS)

    // 自托管字体下载（选中字体时自动触发下载）
    const { isLoading: isFontLoading, isLoaded: isFontLoaded, needsDownload } =
        useFontDownload(localSettings.fontFamily as FontFamily, true)

    // === 高亮和笔记 Hook ===
    const {
        notes,
        highlights,
        isLoading: annotationsLoading,
        addHighlight,
        deleteHighlight,
        addNote,
        updateNote,
        deleteNote,
    } = useBookAnnotations({ bookId: bookId || '' })

    // 跟踪是否已初始化，防止 PowerSync 同步后覆盖用户的本地修改
    const settingsInitializedRef = useRef(false)
    // 跟踪保存后不再响应 savedSettings 变化
    const hasSavedRef = useRef(false)

    // 判断当前主题是否为深色（dark 或 black 主题）
    // 深色模式下浮动按钮使用浅色背景+深色图标，与浅色模式相反
    const isDarkTheme = useMemo(() => {
        return localSettings.themeId === 'dark' || localSettings.themeId === 'black'
    }, [localSettings.themeId])

    // 浮动按钮样式：深色主题使用浅色按钮，浅色主题使用深色按钮
    const fabBtnClass = useMemo(() => {
        if (isDarkTheme) {
            // 深色主题：浅色按钮 + 深色图标
            return 'epub-reader__fab-btn w-11 h-11 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center shadow-lg hover:bg-white/90 active:scale-95 active:bg-white/70 transition-all duration-150'
        } else {
            // 浅色主题：深色按钮 + 浅色图标
            return 'epub-reader__fab-btn w-11 h-11 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center shadow-lg hover:bg-black/80 active:scale-95 active:bg-black/40 transition-all duration-150'
        }
    }, [isDarkTheme])

    // 浮动按钮图标颜色
    const fabIconClass = useMemo(() => {
        return isDarkTheme ? 'text-gray-800' : 'text-white'
    }, [isDarkTheme])

    // 显示字体下载进度（当选择新字体且需要下载时）
    useEffect(() => {
        if (isFontLoading && needsDownload) {
            setShowFontDownload(true)
        } else if (isFontLoaded) {
            // 延迟隐藏，让用户看到完成状态
            const timer = setTimeout(() => setShowFontDownload(false), 500)
            return () => clearTimeout(timer)
        }
    }, [isFontLoading, isFontLoaded, needsDownload])

    // 初始化时从 PowerSync 加载已保存的设置
    // 策略：等待 PowerSync 查询返回有效数据（非空），然后只初始化一次
    useEffect(() => {
        // 如果已保存过，不再更新
        if (hasSavedRef.current) {
            console.log('[EpubReader] Skipping settings update - already saved locally')
            return
        }

        // 如果已初始化，不再更新
        if (settingsInitializedRef.current) {
            return
        }

        // 检查 savedSettings 是否是真正从数据库加载的（非默认值）
        // 如果是默认值，可能是数据库还没加载完成
        if (savedSettings && savedSettings.themeId !== 'white') {
            console.log('[EpubReader] Initializing settings from saved:', savedSettings.themeId)
            setLocalSettings(savedSettings)
            settingsInitializedRef.current = true
        }
    }, [savedSettings])

    // 处理设置变化（实时预览）
    const handleSettingsChange = useCallback((partial: Partial<ReadingSettings>) => {
        setLocalSettings(prev => ({ ...prev, ...partial }))
    }, [])

    // 保存设置到 PowerSync
    const handleSaveSettings = useCallback(async () => {
        console.log('[EpubReader] Saving settings:', localSettings)
        try {
            await persistSettings(localSettings)
            // 标记已保存，防止后续 PowerSync 同步覆盖本地设置
            hasSavedRef.current = true
            toast.success(t('settings.saveSuccess'))
            console.log('[EpubReader] Settings saved successfully, hasSavedRef set to true')
        } catch (err) {
            console.error('[EpubReader] Failed to save settings:', err)
            toast.error('保存失败')
        }
    }, [localSettings, persistSettings, t])

    // === 高亮和笔记处理函数 ===

    // 关闭高亮工具栏
    const closeToolbar = useCallback(() => {
        setToolbarPosition(null)
        setCurrentSelection(null)
    }, [])

    // 创建高亮
    const handleCreateHighlight = useCallback(async (color: HighlightColor) => {
        if (!currentSelection) return
        try {
            await addHighlight(currentSelection, color)
            closeToolbar()
        } catch (error) {
            console.error('[EpubReader] Failed to create highlight:', error)
        }
    }, [currentSelection, addHighlight, closeToolbar])

    // 打开笔记编辑器
    const handleOpenNoteEditor = useCallback(() => {
        setShowNoteEditor(true)
        setToolbarPosition(null) // 关闭工具栏但保留选区信息
    }, [])

    // 保存笔记
    const handleSaveNote = useCallback(async (content: string, color: HighlightColor) => {
        try {
            if (editingNote) {
                // 更新现有笔记
                await updateNote(editingNote.id, content, color)
            } else if (currentSelection) {
                // 创建新笔记（同时创建高亮）
                await addHighlight(currentSelection, color)
                await addNote(content, color, currentSelection)
            }
            setShowNoteEditor(false)
            setEditingNote(null)
            setCurrentSelection(null)
        } catch (error) {
            console.error('[EpubReader] Failed to save note:', error)
        }
    }, [editingNote, currentSelection, addHighlight, addNote, updateNote])

    // 删除笔记
    const handleDeleteNote = useCallback(async (noteId: string) => {
        try {
            await deleteNote(noteId)
            setShowNoteEditor(false)
            setEditingNote(null)
        } catch (error) {
            console.error('[EpubReader] Failed to delete note:', error)
        }
    }, [deleteNote])

    // 复制选中文本
    const handleCopyText = useCallback(() => {
        if (!currentSelection) return
        navigator.clipboard.writeText(currentSelection.text)
        toast.success(t('toolbar.copiedToast', '已复制'))
        closeToolbar()
    }, [currentSelection, closeToolbar, t])

    // 翻译选中文本（占位功能）
    const handleTranslate = useCallback(() => {
        // TODO: 实现翻译功能
        toast.info('翻译功能开发中...')
        closeToolbar()
    }, [closeToolbar])

    // 标注列表项点击 - 跳转到标注位置
    const handleAnnotationClick = useCallback((cfi: string) => {
        const view = viewRef.current
        if (!view) return
        view.goTo(cfi)
        setShowAnnotations(false)
    }, [])

    // 编辑标注
    const handleEditAnnotation = useCallback((id: string, content: string, color: HighlightColor) => {
        setEditingNote({ id, content, color })
        setShowNoteEditor(true)
        setShowAnnotations(false)
    }, [])

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

    // 切换显示/隐藏 (通过 Escape 键触发)
    const _toggleBars = useCallback(() => {
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

                    // 位置变化时关闭高亮工具栏
                    setToolbarPosition(null)
                    setCurrentSelection(null)
                }) as EventListener)

                // load 事件 - 每个 section 加载时触发，用于设置文本选择监听
                view.addEventListener('load', ((e: CustomEvent) => {
                    const { doc, index } = e.detail
                    console.log('[EpubReader] Section loaded:', index)

                    // 追踪用户是否正在选择文本（拖拽状态）
                    let isSelecting = false
                    let pointerStartPos = { x: 0, y: 0 }
                    let lastClickTime = 0

                    // pointerdown - 记录起始位置
                    doc.addEventListener('pointerdown', (event: PointerEvent) => {
                        pointerStartPos = { x: event.clientX, y: event.clientY }
                        isSelecting = false

                        // 如果有选区且点击的不是选区内容，关闭工具栏
                        setTimeout(() => {
                            const selection = doc.getSelection()
                            if (!selection || selection.isCollapsed) {
                                setToolbarPosition(null)
                                setCurrentSelection(null)
                            }
                        }, 50)
                    })

                    // pointermove - 检测是否在拖拽
                    doc.addEventListener('pointermove', (event: PointerEvent) => {
                        const dx = Math.abs(event.clientX - pointerStartPos.x)
                        const dy = Math.abs(event.clientY - pointerStartPos.y)
                        // 如果移动超过 10px，认为是在拖拽/翻页
                        if (dx > 10 || dy > 10) {
                            isSelecting = true
                        }
                    })

                    // === click 事件 - 仅用于切换顶部/底部工具栏 ===
                    // 翻页完全由 foliate-js 原生交互处理（拖动翻页）
                    doc.addEventListener('click', (_event: MouseEvent) => {
                        // 防止重复触发
                        const now = Date.now()
                        if (now - lastClickTime < 100) return
                        lastClickTime = now

                        // 如果正在拖拽，不处理点击
                        if (isSelecting) {
                            isSelecting = false
                            return
                        }

                        // 检查是否有文本选中
                        const selection = doc.getSelection()
                        if (selection && !selection.isCollapsed && selection.toString().trim().length >= 2) {
                            // 有选中文本，不处理点击，让 selectionchange 处理
                            return
                        }

                        // 任何点击都切换顶部/底部栏（foliate-js 处理翻页）
                        console.log('[EpubReader] Click - toggle bars')
                        setShowBars(prev => {
                            if (!prev) {
                                // 显示后开始自动隐藏计时
                                startAutoHideTimer()
                            }
                            return !prev
                        })
                    })

                    // pointerup - 仅用于检测文本选择完成
                    doc.addEventListener('pointerup', () => {
                        const selection = doc.getSelection()
                        const hasSelection = selection && !selection.isCollapsed && selection.toString().trim().length >= 2

                        if (hasSelection) {
                            // 用户完成了文本选择，显示高亮工具栏
                            setTimeout(() => {
                                const text = selection.toString().trim()
                                if (text.length < 2) return

                                // 获取选区的 Range
                                const range = selection.getRangeAt(0)
                                const rect = range.getBoundingClientRect()

                                // 获取 iframe 的位置偏移
                                const iframe = containerRef.current?.querySelector('iframe')
                                const iframeRect = iframe?.getBoundingClientRect() || { left: 0, top: 0 }

                                // 计算工具栏位置（相对于视口）
                                const x = iframeRect.left + rect.left + rect.width / 2
                                const y = iframeRect.top + rect.top - 10

                                // 使用 foliate-js 的 getCFI 方法获取 CFI
                                let startCfi = ''
                                let endCfi = ''
                                try {
                                    const cfi = (view as any).getCFI?.(index, range)
                                    if (cfi) {
                                        startCfi = cfi
                                        endCfi = cfi
                                    }
                                } catch (err) {
                                    console.warn('[EpubReader] Failed to get CFI:', err)
                                }

                                setCurrentSelection({ text, startCfi, endCfi })
                                setToolbarPosition({ x, y })
                                console.log('[EpubReader] Text selected:', text.substring(0, 50) + '...', 'CFI:', startCfi)
                            }, 100)
                        }

                        isSelecting = false
                    })

                    // touchend - 移动端触摸结束
                    doc.addEventListener('touchend', () => {
                        setTimeout(() => {
                            const selection = doc.getSelection()
                            if (selection && !selection.isCollapsed && selection.toString().trim().length >= 2) {
                                const text = selection.toString().trim()
                                const range = selection.getRangeAt(0)
                                const rect = range.getBoundingClientRect()
                                const iframe = containerRef.current?.querySelector('iframe')
                                const iframeRect = iframe?.getBoundingClientRect() || { left: 0, top: 0 }
                                const x = iframeRect.left + rect.left + rect.width / 2
                                const y = iframeRect.top + rect.top - 10

                                let startCfi = ''
                                let endCfi = ''
                                try {
                                    const cfi = (view as any).getCFI?.(index, range)
                                    if (cfi) {
                                        startCfi = cfi
                                        endCfi = cfi
                                    }
                                } catch (err) {
                                    console.warn('[EpubReader] Failed to get CFI:', err)
                                }

                                setCurrentSelection({ text, startCfi, endCfi })
                                setToolbarPosition({ x, y })
                            }
                        }, 100)
                    })

                    // === 新增：selectionchange 监听器 - 更可靠的选区检测 ===
                    // 使用防抖避免频繁触发
                    let selectionChangeTimer: ReturnType<typeof setTimeout> | null = null
                    doc.addEventListener('selectionchange', () => {
                        // 清除之前的定时器
                        if (selectionChangeTimer) {
                            clearTimeout(selectionChangeTimer)
                        }

                        // 延迟处理，等待选区稳定
                        selectionChangeTimer = setTimeout(() => {
                            const selection = doc.getSelection()
                            if (!selection || selection.isCollapsed) {
                                return // 选区已折叠，不处理
                            }

                            const text = selection.toString().trim()
                            if (text.length < 2) return

                            console.log('[EpubReader] selectionchange detected:', text.substring(0, 30) + '...')

                            // 只有当没有工具栏显示时才更新
                            // 避免在工具栏已显示时重复更新
                            try {
                                const range = selection.getRangeAt(0)
                                const rect = range.getBoundingClientRect()
                                const iframe = containerRef.current?.querySelector('iframe')
                                const iframeRect = iframe?.getBoundingClientRect() || { left: 0, top: 0 }

                                const x = iframeRect.left + rect.left + rect.width / 2
                                const y = iframeRect.top + rect.top - 10

                                let startCfi = ''
                                let endCfi = ''
                                try {
                                    const cfi = (view as any).getCFI?.(index, range)
                                    if (cfi) {
                                        startCfi = cfi
                                        endCfi = cfi
                                    }
                                } catch (err) {
                                    console.warn('[EpubReader] Failed to get CFI:', err)
                                }

                                setCurrentSelection({ text, startCfi, endCfi })
                                setToolbarPosition({ x, y })
                            } catch (err) {
                                console.warn('[EpubReader] selectionchange handler error:', err)
                            }
                        }, 300) // 300ms 防抖
                    })

                    // === 新增：mouseup 备选方案 - 确保桌面端正常工作 ===
                    doc.addEventListener('mouseup', () => {
                        // 延迟以确保选区已稳定
                        requestAnimationFrame(() => {
                            const selection = doc.getSelection()
                            if (!selection || selection.isCollapsed) return

                            const text = selection.toString().trim()
                            if (text.length < 2) return

                            console.log('[EpubReader] mouseup selection:', text.substring(0, 30) + '...')
                        })
                    })

                    // 添加键盘事件支持（左右箭头翻页）
                    doc.addEventListener('keydown', (event: KeyboardEvent) => {
                        if (event.key === 'ArrowLeft' || event.key === 'h') {
                            view.goLeft()
                        } else if (event.key === 'ArrowRight' || event.key === 'l') {
                            view.goRight()
                        } else if (event.key === 'Escape') {
                            setToolbarPosition(null)
                            setCurrentSelection(null)
                            setShowBars(prev => !prev)
                        }
                    })
                }) as EventListener)

                // show-annotation 事件 - 点击已有高亮时触发
                view.addEventListener('show-annotation', ((e: CustomEvent) => {
                    const { value, index, range: _range } = e.detail || {}
                    console.log('[EpubReader] show-annotation:', value, index)
                    // TODO: 显示高亮编辑菜单
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

                // 初始化时应用默认样式
                const initialCSS = generateReaderCSS(DEFAULT_SETTINGS)
                view.renderer?.setStyles?.(initialCSS)
                console.log('[EpubReader] Applied initial styles')

                console.log('[EpubReader] 5. Initializing position...')

                // 处理不同类型的 initialLocation
                if (initialLocation && typeof initialLocation === 'object' && 'type' in initialLocation && initialLocation.type === 'section') {
                    // 来自AI引用的章节索引跳转
                    console.log('[EpubReader] Jumping to section index:', initialLocation.index)
                    await view.init({ showTextStart: true })
                    // 使用 foliate-js 的 goTo(index) 跳转到指定章节
                    await view.goTo(initialLocation.index)
                } else if (initialLocation && typeof initialLocation === 'string') {
                    await view.init({ lastLocation: initialLocation })
                } else {
                    await view.init({ showTextStart: true })
                }

                if (!mounted) return
                setIsLoading(false)
                console.log('[EpubReader] 6. Initialization complete!')

                // 通知父组件 view 已准备就绪（用于 TTS）
                if (onViewReady && viewRef.current) {
                    onViewReady(viewRef.current)
                }

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

    // 监听设置变化，实时应用到 foliate-js
    useEffect(() => {
        const view = viewRef.current
        if (!view || !view.renderer || isLoading) return

        const css = generateReaderCSS(localSettings)
        view.renderer.setStyles?.(css)
        console.log('[EpubReader] Applied settings:', localSettings.themeId, localSettings.fontSize)
    }, [localSettings, isLoading])

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
                    <button className="epub-reader__back-btn" onClick={onBack} aria-label="返回">
                        <ChevronLeft size={24} />
                    </button>
                    <div className="epub-reader__title">
                        <span className="epub-reader__book-title">{bookTitle}</span>
                    </div>
                    <div className="w-10" />
                </header>
                <div className="epub-reader__content flex flex-col items-center justify-center gap-4">
                    <p className="text-red-500">加载失败: {error}</p>
                    <button onClick={onBack}>返回</button>
                </div>
            </div>
        )
    }

    return (
        <div className="epub-reader">
            {/* 顶部栏 - 可隐藏 */}
            <header className={`epub-reader__header ${showBars ? 'epub-reader__header--visible' : ''}`}>
                <button className="epub-reader__back-btn" onClick={onBack} aria-label="返回">
                    <ChevronLeft size={24} />
                </button>
                <div className="epub-reader__title">
                    <span className="epub-reader__book-title">{bookTitle}</span>
                    {currentChapter && <span className="epub-reader__chapter">{currentChapter}</span>}
                </div>
                <div className="w-10" />
            </header>

            {/* 阅读区域 - 全屏 */}
            <main className="epub-reader__content">
                {/* foliate-view 容器 - 直接使用，不添加任何遮挡层 */}
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
                <>
                    {/* 遮罩层 - 点击关闭目录 */}
                    <div
                        className="epub-reader__toc-overlay"
                        onClick={() => {
                            setShowToc(false)
                            startAutoHideTimer()
                        }}
                    />
                    <aside className="epub-reader__toc">
                        <div className="epub-reader__toc-header">
                            <h2 className="epub-reader__toc-title">目录</h2>
                            <button
                                className="epub-reader__toc-close-btn"
                                onClick={() => {
                                    setShowToc(false)
                                    startAutoHideTimer()
                                }}
                                aria-label="关闭目录"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <nav className="epub-reader__toc-list">
                            {renderTocItems(toc)}
                        </nav>
                    </aside>
                </>
            )}

            {/* 底部进度栏 - 与顶部栏同步显示/隐藏 */}
            <footer className={`epub-reader__footer ${showBars ? 'epub-reader__footer--visible' : ''}`}>
                <span className="epub-reader__page-info">
                    {currentSection}/{totalSections} · {(currentPercentage * 100).toFixed(1)}%
                </span>
            </footer>

            {/* 右下角悬浮工具栏 - 与顶部/底部栏同步显示/隐藏 */}
            <div
                className={`fixed right-4 bottom-20 z-30 flex flex-col gap-2 transition-all duration-300 ${showBars ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
                    }`}
            >
                {/* AI 对话按钮 - 跳转到 AI 对话页面，预设书籍 QA 模式 */}
                <button
                    className={fabBtnClass}
                    onClick={() => {
                        // 跳转到 AI 对话页面，带上当前书籍 ID 和 QA 模式参数
                        const params = new URLSearchParams()
                        params.set('mode', 'qa')
                        if (bookId) {
                            params.set('bookId', bookId)
                        }
                        navigate(`/app/ai-conversations?${params.toString()}`)
                    }}
                    aria-label={t('toolbar.aiChat')}
                >
                    <Sparkles size={20} className={fabIconClass} />
                </button>

                {/* 笔记按钮 */}
                <button
                    className={fabBtnClass}
                    onClick={() => setShowAnnotations(!showAnnotations)}
                    aria-label={t('toolbar.annotations')}
                >
                    <BookMarked size={20} className={fabIconClass} />
                </button>

                {/* 外观设置按钮 */}
                <button
                    className={fabBtnClass}
                    onClick={() => setShowSettings(true)}
                    aria-label={t('toolbar.settings')}
                >
                    <Settings size={20} className={fabIconClass} />
                </button>

                {/* 目录按钮 */}
                <button
                    className={fabBtnClass}
                    onClick={() => setShowToc(!showToc)}
                    aria-label={t('toolbar.toc')}
                >
                    <Menu size={20} className={fabIconClass} />
                </button>

                {/* 听书按钮 - 触发 TTS */}
                <button
                    className={fabBtnClass}
                    onClick={() => {
                        // 通知父组件触发 TTS（通过 onViewReady 传递的 view）
                        console.log('[EpubReader] TTS button clicked')
                        // TTS 由 ReaderPage 控制，这里使用自定义事件通知
                        window.dispatchEvent(new CustomEvent('epub-reader-tts-request'))
                    }}
                    aria-label={t('toolbar.listen')}
                >
                    <Headphones size={20} className={fabIconClass} />
                </button>
            </div>

            {/* 阅读设置面板 */}
            <ReaderSettingsSheet
                open={showSettings}
                onClose={() => setShowSettings(false)}
                settings={localSettings}
                onSettingsChange={handleSettingsChange}
                onSave={handleSaveSettings}
            />

            {/* 字体下载进度提示 */}
            {showFontDownload && (
                <FontDownloadToast
                    fontFamily={localSettings.fontFamily as FontFamily}
                    onComplete={() => {
                        console.log('[EpubReader] Font download complete')
                    }}
                />
            )}

            {/* === 高亮和笔记 UI === */}

            {/* 高亮工具栏 - 选中文本时显示 */}
            {toolbarPosition && currentSelection && (
                <HighlightToolbar
                    visible={true}
                    position={toolbarPosition}
                    selectedText={currentSelection.text}
                    onHighlight={handleCreateHighlight}
                    onAddNote={handleOpenNoteEditor}
                    onCopy={handleCopyText}
                    onTranslate={handleTranslate}
                    onClose={closeToolbar}
                />
            )}

            {/* 笔记编辑器 */}
            <NoteEditor
                open={showNoteEditor}
                onClose={() => {
                    setShowNoteEditor(false)
                    setEditingNote(null)
                    setCurrentSelection(null)
                }}
                highlightedText={currentSelection?.text}
                existingNote={editingNote?.content}
                existingColor={editingNote?.color || DEFAULT_HIGHLIGHT_COLOR}
                noteId={editingNote?.id}
                onSave={handleSaveNote}
                onDelete={editingNote ? () => handleDeleteNote(editingNote.id) : undefined}
            />

            {/* 标注列表面板 */}
            <AnnotationList
                open={showAnnotations}
                onClose={() => setShowAnnotations(false)}
                bookTitle={bookTitle}
                notes={notes.map(n => ({
                    id: n.id,
                    type: 'note' as const,
                    bookId: n.bookId,
                    content: n.content,
                    color: n.color as HighlightColor,
                    pageNumber: n.pageNumber,
                    positionCfi: n.cfiRange,
                    createdAt: n.createdAt,
                    updatedAt: n.updatedAt,
                }))}
                highlights={highlights.map(h => ({
                    id: h.id,
                    type: 'highlight' as const,
                    bookId: h.bookId,
                    text: h.textContent,
                    color: h.color as HighlightColor,
                    pageNumber: h.pageNumber,
                    positionStartCfi: h.cfiRange,
                    positionEndCfi: h.cfiRangeEnd,
                    createdAt: h.createdAt,
                    updatedAt: h.updatedAt,
                }))}
                onNavigate={handleAnnotationClick}
                onEditNote={(note) => handleEditAnnotation(note.id, note.content, note.color)}
                onDeleteNote={async (noteId) => { await deleteNote(noteId) }}
                onEditHighlight={(highlight) => handleEditAnnotation(highlight.id, '', highlight.color)}
                onDeleteHighlight={async (highlightId) => { await deleteHighlight(highlightId) }}
                isLoading={annotationsLoading}
            />
        </div>
    )
}

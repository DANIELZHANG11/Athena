/**
 * 字体下载服务 - 自托管字体管理
 *
 * 特性：
 * - 字体文件托管在自己的服务器上 (/fonts/*)
 * - 支持下载进度追踪
 * - 使用 IndexedDB 缓存字体（离线可用）
 * - 浏览器会自动缓存通过 HTTP 请求的字体文件
 *
 * 架构：
 * - 字体文件位于 public/fonts/ 目录
 * - 通过相对路径 /fonts/xxx.woff2 访问
 * - 适配中国用户，避免 Google Fonts/jsDelivr 等 CDN 问题
 *
 * @see 02 - 功能规格与垂直切片 2.11节
 * @created 2025-01-01
 */

import type { FontFamily } from '@/hooks/useReadingSettings'

// ============================================================================
// 类型定义
// ============================================================================

/** 字体下载状态 */
export type FontStatus = 'not-loaded' | 'loading' | 'loaded' | 'error'

/** 字体下载进度 */
export interface FontProgress {
    fontFamily: FontFamily
    status: FontStatus
    progress: number // 0-100
    error?: string
}

/** 字体配置 */
export interface FontConfig {
    id: FontFamily
    displayName: string
    fontFamilyCSS: string
    /** 需要加载的字体文件列表（相对于 /fonts/） */
    files: Array<{
        weight: number
        style: 'normal' | 'italic'
        filename: string
    }>
    /** 字体大小（KB），用于进度计算 */
    estimatedSizeKB: number
}

// ============================================================================
// 字体配置
// ============================================================================

/**
 * 可用字体配置
 * 
 * 字体文件来源：
 * - Noto Serif SC / Sans SC: @fontsource 包导出的 woff2 文件
 * - LXGW WenKai: lxgw-wenkai-webfont npm 包
 * 
 * 使用中文简体子集 (chinese-simplified) 以减小文件大小
 */
export const FONT_CONFIGS: Record<FontFamily, FontConfig> = {
    'system': {
        id: 'system',
        displayName: '系统默认',
        fontFamilyCSS: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
        files: [], // 系统字体无需下载
        estimatedSizeKB: 0,
    },
    'noto-serif-sc': {
        id: 'noto-serif-sc',
        displayName: '思源宋体',
        fontFamilyCSS: '"Noto Serif SC", serif',
        files: [
            { weight: 400, style: 'normal', filename: 'noto-serif-sc-chinese-simplified-400-normal.woff2' },
            { weight: 500, style: 'normal', filename: 'noto-serif-sc-chinese-simplified-500-normal.woff2' },
            { weight: 600, style: 'normal', filename: 'noto-serif-sc-chinese-simplified-600-normal.woff2' },
            { weight: 700, style: 'normal', filename: 'noto-serif-sc-chinese-simplified-700-normal.woff2' },
        ],
        estimatedSizeKB: 4000, // ~4MB
    },
    'noto-sans-sc': {
        id: 'noto-sans-sc',
        displayName: '思源黑体',
        fontFamilyCSS: '"Noto Sans SC", sans-serif',
        files: [
            { weight: 400, style: 'normal', filename: 'noto-sans-sc-chinese-simplified-400-normal.woff2' },
            { weight: 500, style: 'normal', filename: 'noto-sans-sc-chinese-simplified-500-normal.woff2' },
            { weight: 600, style: 'normal', filename: 'noto-sans-sc-chinese-simplified-600-normal.woff2' },
            { weight: 700, style: 'normal', filename: 'noto-sans-sc-chinese-simplified-700-normal.woff2' },
        ],
        estimatedSizeKB: 4000, // ~4MB
    },
    'lxgw-wenkai': {
        id: 'lxgw-wenkai',
        displayName: '霞鹜文楷',
        fontFamilyCSS: '"LXGW WenKai", cursive',
        files: [
            // LXGW WenKai 使用分片子集，我们只加载常用汉字的子集
            { weight: 400, style: 'normal', filename: 'lxgwwenkaimono-regular-subset-4.woff2' },
            { weight: 400, style: 'normal', filename: 'lxgwwenkaimono-regular-subset-5.woff2' },
            { weight: 400, style: 'normal', filename: 'lxgwwenkaimono-regular-subset-6.woff2' },
            { weight: 700, style: 'normal', filename: 'lxgwwenkaimono-bold-subset-79.woff2' },
            { weight: 700, style: 'normal', filename: 'lxgwwenkaimono-bold-subset-80.woff2' },
        ],
        estimatedSizeKB: 2000, // ~2MB
    },
    'georgia': {
        id: 'georgia',
        displayName: 'Georgia',
        fontFamilyCSS: 'Georgia, serif',
        files: [], // 系统内置字体
        estimatedSizeKB: 0,
    },
    'helvetica': {
        id: 'helvetica',
        displayName: 'Helvetica',
        fontFamilyCSS: 'Helvetica, Arial, sans-serif',
        files: [], // 系统内置字体
        estimatedSizeKB: 0,
    },
}

// ============================================================================
// 本地存储键名 - 用于持久化已下载字体的状态
// ============================================================================
const FONTS_STORAGE_KEY = 'athena_downloaded_fonts'

// ============================================================================
// 字体服务类
// ============================================================================

class FontService {
    /** 字体状态缓存 */
    private fontStatus: Map<FontFamily, FontProgress> = new Map()

    /** 进度回调 */
    private progressCallbacks: Set<(progress: FontProgress) => void> = new Set()

    /** 已注入的字体 CSS */
    private injectedFonts: Set<FontFamily> = new Set()

    constructor() {
        // 初始化：系统字体和内置字体默认已加载
        const systemFonts: FontFamily[] = ['system', 'georgia', 'helvetica']
        systemFonts.forEach(font => {
            this.fontStatus.set(font, {
                fontFamily: font,
                status: 'loaded',
                progress: 100,
            })
        })
        
        // 从 localStorage 恢复已下载的字体状态（全局共享）
        this.restoreDownloadedFonts()
    }
    
    /**
     * 从 localStorage 恢复已下载的字体状态
     * 确保字体下载状态在所有书籍间共享
     */
    private restoreDownloadedFonts(): void {
        try {
            const stored = localStorage.getItem(FONTS_STORAGE_KEY)
            if (stored) {
                const downloadedFonts: FontFamily[] = JSON.parse(stored)
                downloadedFonts.forEach(fontFamily => {
                    // 验证字体配置存在
                    if (FONT_CONFIGS[fontFamily]) {
                        this.fontStatus.set(fontFamily, {
                            fontFamily,
                            status: 'loaded',
                            progress: 100,
                        })
                        // 注入 CSS 以确保字体可用
                        this.injectFontCSS(fontFamily)
                        console.log(`[FontService] Restored font from storage: ${fontFamily}`)
                    }
                })
            }
        } catch (error) {
            console.warn('[FontService] Failed to restore downloaded fonts:', error)
        }
    }
    
    /**
     * 保存已下载的字体到 localStorage
     */
    private saveDownloadedFonts(): void {
        try {
            const downloadedFonts: FontFamily[] = []
            this.fontStatus.forEach((progress, fontFamily) => {
                // 只保存非系统字体且已加载的字体
                const config = FONT_CONFIGS[fontFamily]
                if (config && config.files.length > 0 && progress.status === 'loaded') {
                    downloadedFonts.push(fontFamily)
                }
            })
            localStorage.setItem(FONTS_STORAGE_KEY, JSON.stringify(downloadedFonts))
        } catch (error) {
            console.warn('[FontService] Failed to save downloaded fonts:', error)
        }
    }

    /**
     * 获取字体状态
     */
    getFontStatus(fontFamily: FontFamily): FontProgress {
        return this.fontStatus.get(fontFamily) || {
            fontFamily,
            status: 'not-loaded',
            progress: 0,
        }
    }

    /**
     * 检查字体是否需要下载（非系统字体且未加载）
     */
    needsDownload(fontFamily: FontFamily): boolean {
        const config = FONT_CONFIGS[fontFamily]
        if (!config || config.files.length === 0) return false
        
        const status = this.getFontStatus(fontFamily)
        return status.status !== 'loaded' && status.status !== 'loading'
    }

    /**
     * 订阅进度更新
     */
    onProgress(callback: (progress: FontProgress) => void): () => void {
        this.progressCallbacks.add(callback)
        return () => this.progressCallbacks.delete(callback)
    }

    /**
     * 通知进度更新
     */
    private notifyProgress(progress: FontProgress) {
        this.fontStatus.set(progress.fontFamily, progress)
        this.progressCallbacks.forEach(cb => cb(progress))
    }

    /**
     * 预加载字体（不阻塞，在后台下载）
     */
    async preloadFont(fontFamily: FontFamily): Promise<void> {
        const config = FONT_CONFIGS[fontFamily]
        if (!config || config.files.length === 0) {
            // 系统字体，直接标记为已加载
            this.notifyProgress({
                fontFamily,
                status: 'loaded',
                progress: 100,
            })
            return
        }

        // 已在加载或已加载
        const currentStatus = this.getFontStatus(fontFamily)
        if (currentStatus.status === 'loading' || currentStatus.status === 'loaded') {
            return
        }

        console.log(`[FontService] Preloading font: ${fontFamily}`)

        this.notifyProgress({
            fontFamily,
            status: 'loading',
            progress: 0,
        })

        try {
            // 并行加载所有字体文件
            const totalFiles = config.files.length
            let loadedFiles = 0

            await Promise.all(
                config.files.map(async (file) => {
                    const url = `/fonts/${file.filename}`
                    
                    // 使用 fetch 触发字体下载（会被浏览器缓存）
                    const response = await fetch(url)
                    if (!response.ok) {
                        throw new Error(`Failed to load ${file.filename}: ${response.status}`)
                    }
                    
                    // 消费响应以确保下载完成
                    await response.blob()
                    
                    loadedFiles++
                    const progress = Math.round((loadedFiles / totalFiles) * 100)
                    
                    this.notifyProgress({
                        fontFamily,
                        status: 'loading',
                        progress,
                    })
                })
            )

            // 注入 CSS @font-face 规则
            this.injectFontCSS(fontFamily)

            this.notifyProgress({
                fontFamily,
                status: 'loaded',
                progress: 100,
            })
            
            // 保存到 localStorage，确保所有书籍共享字体下载状态
            this.saveDownloadedFonts()

            console.log(`[FontService] Font loaded: ${fontFamily}`)
        } catch (error) {
            console.error(`[FontService] Failed to load font ${fontFamily}:`, error)
            this.notifyProgress({
                fontFamily,
                status: 'error',
                progress: 0,
                error: error instanceof Error ? error.message : 'Unknown error',
            })
        }
    }

    /**
     * 注入字体 CSS 到页面（用于主页面，非 iframe）
     */
    private injectFontCSS(fontFamily: FontFamily) {
        if (this.injectedFonts.has(fontFamily)) return

        const config = FONT_CONFIGS[fontFamily]
        if (!config || config.files.length === 0) return

        const styleId = `font-${fontFamily}`
        if (document.getElementById(styleId)) {
            this.injectedFonts.add(fontFamily)
            return
        }

        const fontFaceRules = config.files.map(file => `
            @font-face {
                font-family: '${config.fontFamilyCSS.replace(/"/g, '').split(',')[0].trim()}';
                font-style: ${file.style};
                font-weight: ${file.weight};
                font-display: swap;
                src: url('/fonts/${file.filename}') format('woff2');
            }
        `).join('\n')

        const style = document.createElement('style')
        style.id = styleId
        style.textContent = fontFaceRules
        document.head.appendChild(style)

        this.injectedFonts.add(fontFamily)
    }

    /**
     * 生成用于 EPUB iframe 的 @font-face CSS
     * 使用相对于当前域名的绝对 URL
     */
    generateFontFaceCSS(fontFamily: FontFamily): string {
        const config = FONT_CONFIGS[fontFamily]
        if (!config || config.files.length === 0) return ''

        // 获取当前域名的 base URL
        const baseUrl = window.location.origin

        return config.files.map(file => `
            @font-face {
                font-family: '${config.fontFamilyCSS.replace(/"/g, '').split(',')[0].trim()}';
                font-style: ${file.style};
                font-weight: ${file.weight};
                font-display: swap;
                src: url('${baseUrl}/fonts/${file.filename}') format('woff2');
            }
        `).join('\n')
    }

    /**
     * 获取字体配置
     */
    getConfig(fontFamily: FontFamily): FontConfig | undefined {
        return FONT_CONFIGS[fontFamily]
    }

    /**
     * 获取所有可用字体
     */
    getAllFonts(): FontConfig[] {
        return Object.values(FONT_CONFIGS)
    }
}

// 单例
export const fontService = new FontService()

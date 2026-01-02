/**
 * useFontLoader - 阅读器字体管理
 *
 * APP FIRST 架构：字体作为 NPM 依赖打包进 APP，100% 离线可用
 * 
 * 字体来源（全部 SIL Open Font License，免费商用）：
 * - @fontsource/noto-serif-sc (思源宋体)
 * - @fontsource/noto-sans-sc (思源黑体)
 * - lxgw-wenkai-webfont (霞鹜文楷)
 *
 * @see 02 - 功能规格与垂直切片 2.11节
 * @updated 2025-12-31 - 从 CDN 改为 NPM 包打包
 */

import { useEffect } from 'react'
import type { FontFamily } from './useReadingSettings'

// ============ 字体静态导入 ============
// 在构建时打包进 APP，无需网络加载
// 使用中文简体子集，减小包大小

// 思源宋体 (Noto Serif SC) - 只加载 400/500/600/700 权重的中文简体子集
import '@fontsource/noto-serif-sc/chinese-simplified-400.css'
import '@fontsource/noto-serif-sc/chinese-simplified-500.css'
import '@fontsource/noto-serif-sc/chinese-simplified-600.css'
import '@fontsource/noto-serif-sc/chinese-simplified-700.css'

// 思源黑体 (Noto Sans SC)
import '@fontsource/noto-sans-sc/chinese-simplified-400.css'
import '@fontsource/noto-sans-sc/chinese-simplified-500.css'
import '@fontsource/noto-sans-sc/chinese-simplified-600.css'
import '@fontsource/noto-sans-sc/chinese-simplified-700.css'

// 霞鹜文楷 (LXGW WenKai)
import 'lxgw-wenkai-webfont/style.css'

// 已初始化标记
let fontsInitialized = false

/**
 * 初始化字体（APP 启动时调用一次）
 * 由于使用静态导入，字体在构建时已打包，此函数仅用于日志
 */
export function initializeFonts() {
    if (fontsInitialized) return
    fontsInitialized = true
    console.log('[FontLoader] Fonts bundled and ready (offline-capable)')
}

/**
 * 字体加载 Hook
 * 
 * 由于字体已通过静态 import 打包，此 Hook 仅用于：
 * 1. 确保字体已初始化
 * 2. 记录当前使用的字体
 * 
 * @param fontFamily - 字体 ID
 */
export function useFontLoader(fontFamily: FontFamily | string) {
    useEffect(() => {
        // 确保字体已初始化
        initializeFonts()

        // 系统字体无需额外处理
        if (fontFamily === 'system' || fontFamily === 'georgia' || fontFamily === 'helvetica') {
            return
        }

        console.log('[FontLoader] Using font:', fontFamily)
    }, [fontFamily])
}

/**
 * 检查字体是否可用
 * 由于字体已打包，始终返回 true（除非是系统字体）
 */
export function isFontLoaded(fontFamily: string): boolean {
    const bundledFonts = ['noto-serif-sc', 'noto-sans-sc', 'lxgw-wenkai']
    return bundledFonts.includes(fontFamily) || fontFamily === 'system' || fontFamily === 'georgia' || fontFamily === 'helvetica'
}

/**
 * 预加载字体（兼容旧 API，实际已无需预加载）
 * @deprecated 字体已通过静态导入打包，无需预加载
 */
export function preloadFonts(_fonts: FontFamily[]) {
    console.log('[FontLoader] preloadFonts is deprecated - fonts are bundled at build time')
}

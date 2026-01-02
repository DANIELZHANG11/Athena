/**
 * useFontDownload - 字体下载状态 Hook
 *
 * 提供字体下载进度追踪和控制
 * 配合 fontService 使用
 *
 * @see 02 - 功能规格与垂直切片 2.11节
 * @created 2025-01-01
 */

import { useState, useEffect, useCallback } from 'react'
import { fontService, type FontProgress, type FontStatus } from '@/services/fontService'
import type { FontFamily } from '@/hooks/useReadingSettings'

export interface UseFontDownloadResult {
    /** 当前字体的状态 */
    status: FontStatus
    /** 下载进度 (0-100) */
    progress: number
    /** 错误信息 */
    error?: string
    /** 是否正在加载 */
    isLoading: boolean
    /** 是否已加载 */
    isLoaded: boolean
    /** 是否需要下载（非系统字体且未加载） */
    needsDownload: boolean
    /** 触发下载 */
    download: () => Promise<void>
}

/**
 * 字体下载 Hook
 * 
 * @param fontFamily - 字体 ID
 * @param autoDownload - 是否自动下载（默认 false）
 */
export function useFontDownload(
    fontFamily: FontFamily,
    autoDownload = false
): UseFontDownloadResult {
    const [fontProgress, setFontProgress] = useState<FontProgress>(() => 
        fontService.getFontStatus(fontFamily)
    )

    // 订阅进度更新
    useEffect(() => {
        // 获取初始状态
        setFontProgress(fontService.getFontStatus(fontFamily))

        // 订阅更新
        const unsubscribe = fontService.onProgress((progress) => {
            if (progress.fontFamily === fontFamily) {
                setFontProgress(progress)
            }
        })

        return unsubscribe
    }, [fontFamily])

    // 自动下载
    useEffect(() => {
        if (autoDownload && fontService.needsDownload(fontFamily)) {
            fontService.preloadFont(fontFamily)
        }
    }, [fontFamily, autoDownload])

    // 手动触发下载
    const download = useCallback(async () => {
        await fontService.preloadFont(fontFamily)
    }, [fontFamily])

    return {
        status: fontProgress.status,
        progress: fontProgress.progress,
        error: fontProgress.error,
        isLoading: fontProgress.status === 'loading',
        isLoaded: fontProgress.status === 'loaded',
        needsDownload: fontService.needsDownload(fontFamily),
        download,
    }
}

/**
 * 批量字体状态 Hook
 * 用于同时追踪多个字体的状态
 */
export function useFontDownloadAll(): {
    fonts: Record<FontFamily, FontProgress>
    downloadFont: (fontFamily: FontFamily) => Promise<void>
    downloadAll: () => Promise<void>
} {
    const [fonts, setFonts] = useState<Record<FontFamily, FontProgress>>(() => {
        const allFonts = fontService.getAllFonts()
        const initial: Record<string, FontProgress> = {}
        allFonts.forEach(f => {
            initial[f.id] = fontService.getFontStatus(f.id)
        })
        return initial as Record<FontFamily, FontProgress>
    })

    useEffect(() => {
        const unsubscribe = fontService.onProgress((progress) => {
            setFonts(prev => ({
                ...prev,
                [progress.fontFamily]: progress,
            }))
        })

        return unsubscribe
    }, [])

    const downloadFont = useCallback(async (fontFamily: FontFamily) => {
        await fontService.preloadFont(fontFamily)
    }, [])

    const downloadAll = useCallback(async () => {
        const allFonts = fontService.getAllFonts()
        await Promise.all(
            allFonts
                .filter(f => fontService.needsDownload(f.id))
                .map(f => fontService.preloadFont(f.id))
        )
    }, [])

    return { fonts, downloadFont, downloadAll }
}

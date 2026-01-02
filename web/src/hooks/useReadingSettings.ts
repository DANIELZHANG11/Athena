/**
 * useReadingSettings - 阅读模式设置 Hook (PowerSync Only)
 *
 * 直接使用 PowerSync SQLite 作为唯一数据源
 * 支持每本书独立设置，可跨设备同步
 *
 * 设置优先级：
 * 1. 书籍独立设置 (book_id = 具体ID)
 * 2. 全局默认设置 (book_id = NULL)
 * 3. 系统默认值
 *
 * @see 02 - 功能规格与垂直切片 2.11节
 * @see docker/powersync/sync_rules.yaml
 * @created 2025-12-30
 */

import { useMemo, useCallback } from 'react'
import { useQuery } from '@powersync/react'
import { usePowerSyncDatabase } from '@/lib/powersync'
import { useAuthStore } from '@/stores/auth'
import { generateUUID, getDeviceId } from '@/lib/utils'

// ============================================================================
// 类型定义
// ============================================================================

/** 预设主题 ID */
export type ThemeId = 'white' | 'sepia' | 'toffee' | 'gray' | 'dark' | 'black' | 'custom'

/** 预设字体 ID */
export type FontFamily = 'system' | 'noto-serif-sc' | 'noto-sans-sc' | 'lxgw-wenkai' | 'georgia' | 'helvetica'

/** 文字对齐方式 */
export type TextAlign = 'left' | 'justify'

/** 阅读设置数据 */
export interface ReadingSettings {
    themeId: ThemeId
    backgroundColor: string
    textColor: string
    fontFamily: FontFamily
    fontSize: number         // 12-32
    fontWeight: number       // 400/500/600/700
    lineHeight: number       // 1.0-2.5
    paragraphSpacing: number // 倍数
    marginHorizontal: number // px
    textAlign: TextAlign
    hyphenation: boolean
}

/** 预设主题配置 */
export const THEME_PRESETS: Record<ThemeId, { backgroundColor: string; textColor: string }> = {
    white: { backgroundColor: '#FFFFFF', textColor: '#1D1D1F' },
    sepia: { backgroundColor: '#F4ECD8', textColor: '#3D3D3D' },
    toffee: { backgroundColor: '#E8D5B5', textColor: '#4A4A4A' },
    gray: { backgroundColor: '#E8E8E8', textColor: '#2D2D2D' },
    dark: { backgroundColor: '#1C1C1E', textColor: '#FFFFFF' },
    black: { backgroundColor: '#000000', textColor: '#FFFFFF' },
    custom: { backgroundColor: '#FFFFFF', textColor: '#1D1D1F' },
}

/** 系统默认设置 */
export const DEFAULT_SETTINGS: ReadingSettings = {
    themeId: 'white',
    backgroundColor: '#FFFFFF',
    textColor: '#1D1D1F',
    fontFamily: 'system',
    fontSize: 18,
    fontWeight: 400,
    lineHeight: 1.6,
    paragraphSpacing: 1.0,
    marginHorizontal: 24,
    textAlign: 'justify',
    hyphenation: true,
}

/** PowerSync reading_settings 表原始行结构 */
interface SettingsRow {
    id: string
    user_id: string
    book_id: string | null
    device_id: string | null
    theme_id: string | null
    background_color: string | null
    text_color: string | null
    font_family: string | null
    font_size: number | null
    font_weight: number | null
    line_height: number | null
    paragraph_spacing: number | null
    margin_horizontal: number | null
    text_align: string | null
    hyphenation: number | null  // 0/1
    is_deleted: number | null
    deleted_at: string | null
    created_at: string
    updated_at: string
}

// ============================================================================
// Hook 实现
// ============================================================================

/**
 * 获取阅读设置
 * @param bookId - 书籍 ID，为空时获取全局设置
 */
export function useReadingSettings(bookId?: string | null) {
    const db = usePowerSyncDatabase()
    const { user } = useAuthStore()
    const userId = user?.id

    // 查询书籍独立设置
    const { data: bookSettings } = useQuery<SettingsRow>(
        bookId && userId
            ? `SELECT * FROM reading_settings WHERE user_id = ? AND book_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`
            : '',
        bookId && userId ? [userId, bookId] : []
    )

    // 查询全局默认设置
    const { data: globalSettings } = useQuery<SettingsRow>(
        userId
            ? `SELECT * FROM reading_settings WHERE user_id = ? AND book_id IS NULL AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`
            : '',
        userId ? [userId] : []
    )

    // localStorage key 生成函数
    const getLocalStorageKey = useCallback((bid?: string | null) => {
        const bookPart = bid ? `book_${bid}` : 'global'
        return `athena_reading_settings_${bookPart}`
    }, [])

    // 从 localStorage 读取设置
    const getLocalSettings = useCallback((bid?: string | null): ReadingSettings | null => {
        try {
            const key = getLocalStorageKey(bid)
            const stored = localStorage.getItem(key)
            if (stored) {
                return JSON.parse(stored) as ReadingSettings
            }
        } catch (e) {
            console.warn('[useReadingSettings] Failed to read from localStorage:', e)
        }
        return null
    }, [getLocalStorageKey])

    // 保存到 localStorage
    const saveLocalSettings = useCallback((settings: ReadingSettings, bid?: string | null) => {
        try {
            const key = getLocalStorageKey(bid)
            localStorage.setItem(key, JSON.stringify(settings))
            console.log('[useReadingSettings] Saved to localStorage:', { key, themeId: settings.themeId })
        } catch (e) {
            console.warn('[useReadingSettings] Failed to save to localStorage:', e)
        }
    }, [getLocalStorageKey])

    // 合并设置（优先级：PowerSync书籍 > PowerSync全局 > localStorage > 默认）
    const settings = useMemo<ReadingSettings>(() => {
        console.log('[useReadingSettings] Computing settings:', {
            bookId,
            bookSettingsCount: bookSettings?.length ?? 0,
            globalSettingsCount: globalSettings?.length ?? 0,
            bookSettingsTheme: bookSettings?.[0]?.theme_id,
            globalSettingsTheme: globalSettings?.[0]?.theme_id,
        })

        const row = (bookSettings?.[0] || globalSettings?.[0]) as SettingsRow | undefined

        // 如果 PowerSync 有数据，使用它
        if (row) {
            const themeId = (row.theme_id as ThemeId) || DEFAULT_SETTINGS.themeId
            const preset = THEME_PRESETS[themeId] || THEME_PRESETS.white

            return {
                themeId,
                backgroundColor: row.background_color || preset.backgroundColor,
                textColor: row.text_color || preset.textColor,
                fontFamily: (row.font_family as FontFamily) || DEFAULT_SETTINGS.fontFamily,
                fontSize: row.font_size ?? DEFAULT_SETTINGS.fontSize,
                fontWeight: row.font_weight ?? DEFAULT_SETTINGS.fontWeight,
                lineHeight: row.line_height ?? DEFAULT_SETTINGS.lineHeight,
                paragraphSpacing: row.paragraph_spacing ?? DEFAULT_SETTINGS.paragraphSpacing,
                marginHorizontal: row.margin_horizontal ?? DEFAULT_SETTINGS.marginHorizontal,
                textAlign: (row.text_align as TextAlign) || DEFAULT_SETTINGS.textAlign,
                hyphenation: row.hyphenation === 0 ? false : DEFAULT_SETTINGS.hyphenation,
            }
        }

        // PowerSync 没有数据，尝试 localStorage fallback
        const localSettings = getLocalSettings(bookId)
        if (localSettings) {
            console.log('[useReadingSettings] Using localStorage fallback:', localSettings.themeId)
            return localSettings
        }

        return DEFAULT_SETTINGS
    }, [bookSettings, globalSettings, bookId, getLocalSettings])

    // 更新设置
    const updateSettings = useCallback(async (partial: Partial<ReadingSettings>) => {
        console.log('[useReadingSettings] updateSettings called:', { userId, bookId, partial })

        if (!db || !userId) {
            console.warn('[useReadingSettings] Cannot save - db or userId missing:', { db: !!db, userId })
            return
        }

        const targetBookId = bookId ?? null
        const now = new Date().toISOString()
        const deviceId = getDeviceId()

        // 检查是否已有设置记录
        const existingResult = await db.getAll<SettingsRow>(
            `SELECT id FROM reading_settings WHERE user_id = ? AND ${targetBookId ? 'book_id = ?' : 'book_id IS NULL'} LIMIT 1`,
            targetBookId ? [userId, targetBookId] : [userId]
        )

        // 处理主题切换时的颜色更新
        let finalColors = { backgroundColor: partial.backgroundColor, textColor: partial.textColor }
        if (partial.themeId && partial.themeId !== 'custom') {
            const preset = THEME_PRESETS[partial.themeId]
            finalColors = { backgroundColor: preset.backgroundColor, textColor: preset.textColor }
        }

        if (existingResult.length > 0) {
            // UPDATE 现有记录
            const updateFields: string[] = []
            const updateValues: (string | number | null)[] = []

            if (partial.themeId !== undefined) {
                updateFields.push('theme_id = ?')
                updateValues.push(partial.themeId)
            }
            if (finalColors.backgroundColor !== undefined) {
                updateFields.push('background_color = ?')
                updateValues.push(finalColors.backgroundColor || null)
            }
            if (finalColors.textColor !== undefined) {
                updateFields.push('text_color = ?')
                updateValues.push(finalColors.textColor || null)
            }
            if (partial.fontFamily !== undefined) {
                updateFields.push('font_family = ?')
                updateValues.push(partial.fontFamily)
            }
            if (partial.fontSize !== undefined) {
                updateFields.push('font_size = ?')
                updateValues.push(partial.fontSize)
            }
            if (partial.fontWeight !== undefined) {
                updateFields.push('font_weight = ?')
                updateValues.push(partial.fontWeight)
            }
            if (partial.lineHeight !== undefined) {
                updateFields.push('line_height = ?')
                updateValues.push(partial.lineHeight)
            }
            if (partial.paragraphSpacing !== undefined) {
                updateFields.push('paragraph_spacing = ?')
                updateValues.push(partial.paragraphSpacing)
            }
            if (partial.marginHorizontal !== undefined) {
                updateFields.push('margin_horizontal = ?')
                updateValues.push(partial.marginHorizontal)
            }
            if (partial.textAlign !== undefined) {
                updateFields.push('text_align = ?')
                updateValues.push(partial.textAlign)
            }
            if (partial.hyphenation !== undefined) {
                updateFields.push('hyphenation = ?')
                updateValues.push(partial.hyphenation ? 1 : 0)
            }

            updateFields.push('device_id = ?', 'updated_at = ?')
            updateValues.push(deviceId, now, existingResult[0].id)

            await db.execute(
                `UPDATE reading_settings SET ${updateFields.join(', ')} WHERE id = ?`,
                updateValues
            )
        } else {
            // INSERT 新记录
            const id = generateUUID()
            const themeId = partial.themeId ?? DEFAULT_SETTINGS.themeId
            const preset = THEME_PRESETS[themeId]

            await db.execute(
                `INSERT INTO reading_settings (
          id, user_id, book_id, device_id,
          theme_id, background_color, text_color,
          font_family, font_size, font_weight,
          line_height, paragraph_spacing, margin_horizontal,
          text_align, hyphenation,
          is_deleted, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
                [
                    id, userId, targetBookId, deviceId,
                    themeId,
                    finalColors.backgroundColor ?? preset.backgroundColor,
                    finalColors.textColor ?? preset.textColor,
                    partial.fontFamily ?? DEFAULT_SETTINGS.fontFamily,
                    partial.fontSize ?? DEFAULT_SETTINGS.fontSize,
                    partial.fontWeight ?? DEFAULT_SETTINGS.fontWeight,
                    partial.lineHeight ?? DEFAULT_SETTINGS.lineHeight,
                    partial.paragraphSpacing ?? DEFAULT_SETTINGS.paragraphSpacing,
                    partial.marginHorizontal ?? DEFAULT_SETTINGS.marginHorizontal,
                    partial.textAlign ?? DEFAULT_SETTINGS.textAlign,
                    (partial.hyphenation ?? DEFAULT_SETTINGS.hyphenation) ? 1 : 0,
                    now, now
                ]
            )
        }

        // 同时保存到 localStorage 作为 fallback
        // 合并当前设置与更新部分
        const fullSettings: ReadingSettings = {
            ...settings,
            ...partial,
            backgroundColor: finalColors.backgroundColor ?? settings.backgroundColor,
            textColor: finalColors.textColor ?? settings.textColor,
        }
        saveLocalSettings(fullSettings, bookId)
    }, [db, userId, bookId, settings, saveLocalSettings])

    // 重置为默认
    const resetToDefault = useCallback(async () => {
        if (!db || !userId) return

        const targetBookId = bookId ?? null

        // 软删除现有设置
        await db.execute(
            `UPDATE reading_settings 
       SET is_deleted = 1, deleted_at = ?, updated_at = ?
       WHERE user_id = ? AND ${targetBookId ? 'book_id = ?' : 'book_id IS NULL'}`,
            targetBookId
                ? [new Date().toISOString(), new Date().toISOString(), userId, targetBookId]
                : [new Date().toISOString(), new Date().toISOString(), userId]
        )
    }, [db, userId, bookId])

    // 应用到所有书籍（将当前设置保存为全局默认）
    const applyToAllBooks = useCallback(async () => {
        if (!db || !userId) return

        // 将当前设置保存为全局默认（book_id = NULL）
        const now = new Date().toISOString()
        const deviceId = getDeviceId()

        // 删除现有全局设置
        await db.execute(
            `UPDATE reading_settings 
       SET is_deleted = 1, deleted_at = ?, updated_at = ?
       WHERE user_id = ? AND book_id IS NULL`,
            [now, now, userId]
        )

        // 创建新的全局设置
        const id = generateUUID()
        const preset = THEME_PRESETS[settings.themeId]

        await db.execute(
            `INSERT INTO reading_settings (
        id, user_id, book_id, device_id,
        theme_id, background_color, text_color,
        font_family, font_size, font_weight,
        line_height, paragraph_spacing, margin_horizontal,
        text_align, hyphenation,
        is_deleted, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            [
                id, userId, deviceId,
                settings.themeId,
                settings.backgroundColor ?? preset.backgroundColor,
                settings.textColor ?? preset.textColor,
                settings.fontFamily,
                settings.fontSize,
                settings.fontWeight,
                settings.lineHeight,
                settings.paragraphSpacing,
                settings.marginHorizontal,
                settings.textAlign,
                settings.hyphenation ? 1 : 0,
                now, now
            ]
        )
    }, [db, userId, settings])

    // 判断是否有书籍独立设置
    const hasBookSettings = !!bookSettings?.[0]

    // 是否正在加载
    const isLoading = !bookSettings && !globalSettings

    return {
        settings,
        isLoading,
        hasBookSettings,
        updateSettings,
        resetToDefault,
        applyToAllBooks,
    }
}

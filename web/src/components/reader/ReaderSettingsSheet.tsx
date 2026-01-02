/**
 * 阅读设置面板（Apple Books 风格）
 * - 半透明背景覆盖在阅读内容上
 * - 右上角勾号关闭并保存
 * - 设置即时生效，实时预览
 *
 * @see 06 - UIUX设计系统
 * @modified 2025-12-30
 */

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { cn } from '@/components/ui/utils'
import { Slider } from '@/components/ui/slider'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    type ReadingSettings,
    type ThemeId,
    type FontFamily,
    THEME_PRESETS,
} from '@/hooks/useReadingSettings'
import { FontDownloadIndicator } from './FontDownloadIndicator'

interface ReaderSettingsSheetProps {
    open: boolean
    onClose: () => void
    settings: ReadingSettings
    onSettingsChange: (partial: Partial<ReadingSettings>) => void
    onSave?: () => void // 保存设置回调
}

// 主题选项 - 3x2 两排
const THEME_OPTIONS: ThemeId[] = ['white', 'sepia', 'toffee', 'gray', 'dark', 'black']

// 字体选项 - 包含中文字体（按 PRD 2.11 规格）
const FONT_OPTIONS: FontFamily[] = [
    'system',
    'noto-serif-sc',  // 思源宋体
    'noto-sans-sc',   // 思源黑体
    'lxgw-wenkai',    // 霞鹜文楷
    'georgia',
    'helvetica',
]

export function ReaderSettingsSheet({
    open,
    onClose,
    settings,
    onSettingsChange,
    onSave,
}: ReaderSettingsSheetProps) {
    const { t } = useTranslation('reader')

    const handleThemeChange = useCallback((themeId: ThemeId) => {
        const preset = THEME_PRESETS[themeId]
        onSettingsChange({
            themeId,
            backgroundColor: preset.backgroundColor,
            textColor: preset.textColor,
        })
    }, [onSettingsChange])

    const handleClose = useCallback(() => {
        onSave?.()
        onClose()
    }, [onSave, onClose])

    if (!open) return null

    return (
        <>
            {/* 遮罩层 - 点击关闭 */}
            <div
                className="fixed inset-0 z-50 bg-black/30"
                onClick={handleClose}
            />

            {/* 设置面板 - 底部弹出 */}
            <div className="fixed bottom-0 left-0 right-0 z-50 animate-in slide-in-from-bottom duration-300">
                <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl rounded-t-2xl shadow-2xl border-t border-gray-200/50 dark:border-white/10">
                    {/* 头部 - 标题 + 关闭按钮 */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200/50 dark:border-white/10">
                        <span className="text-base font-semibold">{t('settings.title')}</span>
                        <button
                            onClick={handleClose}
                            className="w-8 h-8 flex items-center justify-center rounded-full bg-system-blue/10 hover:bg-system-blue/20 transition-colors"
                            aria-label="完成"
                        >
                            <Check size={18} className="text-system-blue" />
                        </button>
                    </div>

                    {/* 内容区 */}
                    <div className="px-4 py-4 space-y-5 max-h-[60vh] overflow-y-auto">
                        {/* 主题选择 - 3x2 两排 */}
                        <div className="grid grid-cols-3 gap-3 justify-items-center">
                            {THEME_OPTIONS.map((themeId) => {
                                const preset = THEME_PRESETS[themeId]
                                const isSelected = settings.themeId === themeId

                                return (
                                    <button
                                        key={themeId}
                                        onClick={() => handleThemeChange(themeId)}
                                        className={cn(
                                            'w-14 h-14 rounded-xl flex items-center justify-center text-sm font-medium',
                                            'border-2 transition-all shadow-sm',
                                            isSelected
                                                ? 'border-system-blue ring-2 ring-system-blue/30 scale-105'
                                                : 'border-gray-200 dark:border-gray-700'
                                        )}
                                        style={{
                                            backgroundColor: preset.backgroundColor,
                                            color: preset.textColor,
                                        }}
                                    >
                                        Aa
                                    </button>
                                )
                            })}
                        </div>

                        {/* 字体大小 */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-medium">{t('settings.fontSize')}</span>
                                <span className="text-muted-foreground tabular-nums">{settings.fontSize}</span>
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="text-sm text-muted-foreground font-medium w-4 text-center">A</span>
                                <Slider
                                    value={[settings.fontSize]}
                                    min={12}
                                    max={32}
                                    step={1}
                                    onValueChange={([v]) => onSettingsChange({ fontSize: v })}
                                    className="flex-1"
                                />
                                <span className="text-xl text-muted-foreground font-medium w-4 text-center">A</span>
                            </div>
                        </div>

                        {/* 字体选择 */}
                        <div className="space-y-2">
                            <span className="text-sm font-medium">{t('settings.fontFamily')}</span>
                            <Select
                                value={settings.fontFamily}
                                onValueChange={(v) => onSettingsChange({ fontFamily: v as FontFamily })}
                            >
                                <SelectTrigger className="w-full bg-white/95 dark:bg-gray-800/95">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-xl border border-gray-200 dark:border-gray-700">
                                    {FONT_OPTIONS.map((font) => (
                                        <SelectItem key={font} value={font} className="flex items-center justify-between">
                                            <div className="flex items-center justify-between w-full gap-2">
                                                <span>{t(`settings.fonts.${font}`)}</span>
                                                <FontDownloadIndicator 
                                                    fontFamily={font} 
                                                    isSelected={settings.fontFamily === font}
                                                    compact 
                                                />
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {/* 当前字体下载状态 */}
                            <FontDownloadIndicator 
                                fontFamily={settings.fontFamily}
                                isSelected
                            />
                        </div>

                        {/* 行间距 */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-medium">{t('settings.lineHeight')}</span>
                                <span className="text-muted-foreground tabular-nums">{settings.lineHeight.toFixed(1)}</span>
                            </div>
                            <div className="flex items-center gap-4">
                                {/* 紧凑行距图标 */}
                                <svg className="w-5 h-5 text-muted-foreground flex-shrink-0" viewBox="0 0 24 24" fill="none">
                                    <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                                <Slider
                                    value={[settings.lineHeight * 10]}
                                    min={10}
                                    max={25}
                                    step={1}
                                    onValueChange={([v]) => onSettingsChange({ lineHeight: v / 10 })}
                                    className="flex-1"
                                />
                                {/* 宽松行距图标 */}
                                <svg className="w-5 h-5 text-muted-foreground flex-shrink-0" viewBox="0 0 24 24" fill="none">
                                    <path d="M4 4h16M4 12h16M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                            </div>
                        </div>

                        {/* 页边距 */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-medium">{t('settings.marginHorizontal')}</span>
                                <span className="text-muted-foreground tabular-nums">{settings.marginHorizontal}px</span>
                            </div>
                            <div className="flex items-center gap-4">
                                {/* 窄边距图标 */}
                                <svg className="w-5 h-5 text-muted-foreground flex-shrink-0" viewBox="0 0 24 24" fill="none">
                                    <rect x="6" y="4" width="12" height="16" rx="1" stroke="currentColor" strokeWidth="2" fill="none" />
                                </svg>
                                <Slider
                                    value={[settings.marginHorizontal]}
                                    min={8}
                                    max={48}
                                    step={4}
                                    onValueChange={([v]) => onSettingsChange({ marginHorizontal: v })}
                                    className="flex-1"
                                />
                                {/* 宽边距图标 */}
                                <svg className="w-5 h-5 text-muted-foreground flex-shrink-0" viewBox="0 0 24 24" fill="none">
                                    <rect x="2" y="4" width="20" height="16" rx="1" stroke="currentColor" strokeWidth="2" fill="none" />
                                </svg>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

/**
 * FontDownloadIndicator - 字体下载进度指示器
 *
 * 在字体选择时显示下载状态和进度
 * Apple Books 风格的简洁设计
 *
 * @see 06 - UIUX设计系统
 * @created 2025-01-01
 */

import { useEffect } from 'react'
import { Check, Download, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/components/ui/utils'
import { useFontDownload } from '@/hooks/useFontDownload'
import { FONT_CONFIGS } from '@/services/fontService'
import type { FontFamily } from '@/hooks/useReadingSettings'

interface FontDownloadIndicatorProps {
    fontFamily: FontFamily
    /** 是否是当前选中的字体（选中时自动下载） */
    isSelected?: boolean
    /** 紧凑模式（只显示图标） */
    compact?: boolean
    className?: string
}

/**
 * 字体下载状态指示器
 * 
 * 状态：
 * - 未加载：显示下载图标
 * - 加载中：显示进度条
 * - 已加载：显示勾号
 * - 错误：显示错误图标
 */
export function FontDownloadIndicator({
    fontFamily,
    isSelected = false,
    compact = false,
    className,
}: FontDownloadIndicatorProps) {
    const { status, progress, error: _error, isLoading, isLoaded, needsDownload, download } = 
        useFontDownload(fontFamily, isSelected)

    const config = FONT_CONFIGS[fontFamily]

    // 系统字体不显示指示器
    if (!config || config.files.length === 0) {
        return null
    }

    // 紧凑模式：只显示状态图标
    if (compact) {
        return (
            <div className={cn('flex items-center justify-center w-5 h-5', className)}>
                {isLoading && (
                    <Loader2 size={14} className="animate-spin text-system-blue" />
                )}
                {isLoaded && (
                    <Check size={14} className="text-green-500" />
                )}
                {status === 'error' && (
                    <AlertCircle size={14} className="text-red-500" />
                )}
                {needsDownload && !isLoading && (
                    <Download size={14} className="text-muted-foreground" />
                )}
            </div>
        )
    }

    // 完整模式：显示进度条和文字
    return (
        <div className={cn('flex items-center gap-2', className)}>
            {isLoading && (
                <>
                    <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-system-blue transition-all duration-300 ease-out rounded-full"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                    <span className="text-xs text-muted-foreground min-w-10 text-right">
                        {progress}%
                    </span>
                </>
            )}
            {isLoaded && (
                <span className="text-xs text-green-500 flex items-center gap-1">
                    <Check size={12} />
                    已下载
                </span>
            )}
            {status === 'error' && (
                <span className="text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle size={12} />
                    下载失败
                </span>
            )}
            {needsDownload && !isLoading && (
                <button
                    onClick={(e) => {
                        e.stopPropagation()
                        download()
                    }}
                    className="text-xs text-system-blue flex items-center gap-1 hover:underline"
                >
                    <Download size={12} />
                    下载 (~{Math.round(config.estimatedSizeKB / 1024)}MB)
                </button>
            )}
        </div>
    )
}

/**
 * 字体下载 Toast
 * 在阅读界面选择字体时显示下载进度
 */
interface FontDownloadToastProps {
    fontFamily: FontFamily
    onComplete?: () => void
    onError?: (error: string) => void
}

export function FontDownloadToast({
    fontFamily,
    onComplete,
    onError,
}: FontDownloadToastProps) {
    const { status: _status, progress, error, isLoaded } = useFontDownload(fontFamily, true)
    const config = FONT_CONFIGS[fontFamily]

    useEffect(() => {
        if (isLoaded) {
            onComplete?.()
        }
    }, [isLoaded, onComplete])

    useEffect(() => {
        if (error) {
            onError?.(error)
        }
    }, [error, onError])

    // 系统字体不显示
    if (!config || config.files.length === 0) {
        return null
    }

    // 已加载不显示
    if (isLoaded) {
        return null
    }

    return (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl rounded-full shadow-lg border border-gray-200/50 dark:border-white/10 px-4 py-2.5 flex items-center gap-3">
                <Loader2 size={16} className="animate-spin text-system-blue" />
                <span className="text-sm font-medium">
                    正在下载 {config.displayName}
                </span>
                <div className="w-20 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div 
                        className="h-full bg-system-blue transition-all duration-300 ease-out rounded-full"
                        style={{ width: `${progress}%` }}
                    />
                </div>
                <span className="text-xs text-muted-foreground">{progress}%</span>
            </div>
        </div>
    )
}

/**
 * 主题选择器组件
 * 6 种预设主题 + 自定义选项
 *
 * @see 02 - 功能规格与垂直切片 2.11节
 * @created 2025-12-30
 */

import { cn } from '@/components/ui/utils'
import { type ThemeId, THEME_PRESETS } from '@/hooks/useReadingSettings'

interface ThemeSelectorProps {
    value: ThemeId
    onChange: (themeId: ThemeId) => void
}

const THEME_OPTIONS: ThemeId[] = ['white', 'sepia', 'toffee', 'gray', 'dark', 'black']

export function ThemeSelector({ value, onChange }: ThemeSelectorProps) {

    return (
        <div className="flex gap-2 overflow-x-auto pb-2">
            {THEME_OPTIONS.map((themeId) => {
                const preset = THEME_PRESETS[themeId]
                const isSelected = value === themeId

                return (
                    <button
                        key={themeId}
                        onClick={() => onChange(themeId)}
                        className={cn(
                            'flex-shrink-0 w-14 h-14 rounded-lg flex flex-col items-center justify-center',
                            'border-2 transition-all duration-fast',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            isSelected
                                ? 'border-primary ring-2 ring-primary/20'
                                : 'border-border hover:border-muted-foreground/50'
                        )}
                        style={{ backgroundColor: preset.backgroundColor }}
                    >
                        <span
                            className="text-sm font-medium"
                            style={{ color: preset.textColor }}
                        >
                            Aa
                        </span>
                    </button>
                )
            })}
        </div>
    )
}

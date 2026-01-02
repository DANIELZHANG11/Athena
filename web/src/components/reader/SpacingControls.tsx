/**
 * 间距控制组件
 * 行间距、页边距滑块
 *
 * @see 02 - 功能规格与垂直切片 2.11节
 * @created 2025-12-30
 */

import { useTranslation } from 'react-i18next'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'

interface SpacingControlsProps {
    lineHeight: number
    marginHorizontal: number
    onLineHeightChange: (lineHeight: number) => void
    onMarginHorizontalChange: (margin: number) => void
}

export function SpacingControls({
    lineHeight,
    marginHorizontal,
    onLineHeightChange,
    onMarginHorizontalChange,
}: SpacingControlsProps) {
    const { t } = useTranslation('reader')

    return (
        <div className="space-y-4">
            {/* 行间距 */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">
                        {t('settings.lineHeight')}
                    </Label>
                    <span className="text-sm text-muted-foreground">
                        {lineHeight.toFixed(1)}
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 16 16" fill="none">
                        <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                    <Slider
                        value={[lineHeight * 10]} // 转换为整数范围 10-25
                        min={10}
                        max={25}
                        step={1}
                        onValueChange={([v]) => onLineHeightChange(v / 10)}
                        className="flex-1"
                    />
                    <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 16 16" fill="none">
                        <path d="M2 2h12M2 8h12M2 14h12" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                </div>
            </div>

            {/* 页边距 */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">
                        {t('settings.marginHorizontal')}
                    </Label>
                    <span className="text-sm text-muted-foreground">{marginHorizontal}px</span>
                </div>
                <div className="flex items-center gap-3">
                    <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 16 16" fill="none">
                        <rect x="4" y="2" width="8" height="12" stroke="currentColor" strokeWidth="1.5" fill="none" />
                    </svg>
                    <Slider
                        value={[marginHorizontal]}
                        min={8}
                        max={48}
                        step={4}
                        onValueChange={([v]) => onMarginHorizontalChange(v)}
                        className="flex-1"
                    />
                    <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 16 16" fill="none">
                        <rect x="2" y="2" width="12" height="12" stroke="currentColor" strokeWidth="1.5" fill="none" />
                    </svg>
                </div>
            </div>
        </div>
    )
}

/**
 * 字体和文字控制组件
 * 字体选择、字体大小滑块
 *
 * @see 02 - 功能规格与垂直切片 2.11节
 * @created 2025-12-30
 */

import { useTranslation } from 'react-i18next'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { type FontFamily } from '@/hooks/useReadingSettings'

interface FontControlsProps {
    fontFamily: FontFamily
    fontSize: number
    onFontFamilyChange: (fontFamily: FontFamily) => void
    onFontSizeChange: (fontSize: number) => void
}

const FONT_OPTIONS: FontFamily[] = [
    'system',
    'noto-serif-sc',
    'noto-sans-sc',
    'lxgw-wenkai',
    'georgia',
    'helvetica',
]

export function FontControls({
    fontFamily,
    fontSize,
    onFontFamilyChange,
    onFontSizeChange,
}: FontControlsProps) {
    const { t } = useTranslation('reader')

    return (
        <div className="space-y-4">
            {/* 字体大小 */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">
                        {t('settings.fontSize')}
                    </Label>
                    <span className="text-sm text-muted-foreground">{fontSize}</span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-xs">A</span>
                    <Slider
                        value={[fontSize]}
                        min={12}
                        max={32}
                        step={1}
                        onValueChange={([v]) => onFontSizeChange(v)}
                        className="flex-1"
                    />
                    <span className="text-lg">A</span>
                </div>
            </div>

            {/* 字体选择 */}
            <div className="space-y-2">
                <Label className="text-sm font-medium">
                    {t('settings.fontFamily')}
                </Label>
                <Select value={fontFamily} onValueChange={(v) => onFontFamilyChange(v as FontFamily)}>
                    <SelectTrigger className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {FONT_OPTIONS.map((font) => (
                            <SelectItem key={font} value={font}>
                                {t(`settings.fonts.${font}`)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        </div>
    )
}

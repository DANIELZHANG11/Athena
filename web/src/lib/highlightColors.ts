/**
 * highlightColors - 高亮颜色配置
 * 
 * Apple Books 风格的高亮颜色系统
 * 每种颜色有特定的语义含义
 * 
 * @see 06 - UIUX设计系统 - 2.1 色彩系统
 * @see figma.css - --highlight-* 变量
 */

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple'

export interface HighlightColorConfig {
  id: HighlightColor
  name: string
  nameKey: string  // i18n key
  /** 实色 (用于图标/边框) */
  color: string
  /** 背景色 (带透明度, 用于文本高亮) */
  backgroundColor: string
  /** CSS 变量名 (实色) */
  cssVar: string
  /** CSS 变量名 (背景色) */
  cssVarBg: string
  /** 语义描述 */
  meaning: string
}

/**
 * 高亮颜色配置列表
 * 顺序决定了颜色选择器中的显示顺序
 */
export const HIGHLIGHT_COLORS: HighlightColorConfig[] = [
  {
    id: 'yellow',
    name: '黄色',
    nameKey: 'highlight.colors.yellow',
    color: 'var(--highlight-yellow)',
    backgroundColor: 'var(--highlight-yellow-bg)',
    cssVar: '--highlight-yellow',
    cssVarBg: '--highlight-yellow-bg',
    meaning: '想法/灵感',
  },
  {
    id: 'green',
    name: '绿色',
    nameKey: 'highlight.colors.green',
    color: 'var(--highlight-green)',
    backgroundColor: 'var(--highlight-green-bg)',
    cssVar: '--highlight-green',
    cssVarBg: '--highlight-green-bg',
    meaning: '事实/数据',
  },
  {
    id: 'blue',
    name: '蓝色',
    nameKey: 'highlight.colors.blue',
    color: 'var(--highlight-blue)',
    backgroundColor: 'var(--highlight-blue-bg)',
    cssVar: '--highlight-blue',
    cssVarBg: '--highlight-blue-bg',
    meaning: '引用/优美',
  },
  {
    id: 'pink',
    name: '粉色',
    nameKey: 'highlight.colors.pink',
    color: 'var(--highlight-pink)',
    backgroundColor: 'var(--highlight-pink-bg)',
    cssVar: '--highlight-pink',
    cssVarBg: '--highlight-pink-bg',
    meaning: '重要/关键',
  },
  {
    id: 'purple',
    name: '紫色',
    nameKey: 'highlight.colors.purple',
    color: 'var(--highlight-purple)',
    backgroundColor: 'var(--highlight-purple-bg)',
    cssVar: '--highlight-purple',
    cssVarBg: '--highlight-purple-bg',
    meaning: '问题/疑问',
  },
]

/** 默认高亮颜色 */
export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = 'yellow'

/**
 * 根据颜色ID获取配置
 */
export function getHighlightColorConfig(colorId: HighlightColor | string): HighlightColorConfig {
  return HIGHLIGHT_COLORS.find(c => c.id === colorId) || HIGHLIGHT_COLORS[0]
}

/**
 * 获取颜色的CSS值 (用于内联样式)
 * 需要在运行时从CSS变量获取实际值
 */
export function getHighlightColorValue(colorId: HighlightColor | string): string {
  const config = getHighlightColorConfig(colorId)
  return config.color
}

/**
 * 获取颜色的背景CSS值
 */
export function getHighlightBackgroundValue(colorId: HighlightColor | string): string {
  const config = getHighlightColorConfig(colorId)
  return config.backgroundColor
}

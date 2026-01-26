/**
 * TTS 文本处理器
 *
 * @description 处理书籍文本，进行分段、分句、清洗
 * 为TTS引擎准备合适的文本输入
 *
 * @see 对话记录.md - 2.11 TTS 听书功能实施计划 - Phase 3
 * @ai-generated Claude Opus 4.5 (2026-01-20)
 */

import type { TTSChapter, TTSParagraph } from './types'

/**
 * 文本清洗选项
 */
export interface TextNormalizerOptions {
  /** 移除Markdown标记 */
  removeMarkdown?: boolean
  /** 移除代码块 */
  removeCodeBlocks?: boolean
  /** 移除URL链接 */
  removeUrls?: boolean
  /** 移除数学公式 */
  removeMathFormulas?: boolean
  /** 最大段落长度（超过将分割） */
  maxParagraphLength?: number
}

const DEFAULT_OPTIONS: TextNormalizerOptions = {
  removeMarkdown: true,
  removeCodeBlocks: true,
  removeUrls: true,
  removeMathFormulas: true,
  maxParagraphLength: 500,
}

/**
 * 清洗单个文本
 */
export function normalizeText(text: string, options: TextNormalizerOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  let result = text

  // 移除代码块 (```...``` 或 `...`)
  if (opts.removeCodeBlocks) {
    result = result.replace(/```[\s\S]*?```/g, '')
    result = result.replace(/`[^`]+`/g, '')
  }

  // 移除数学公式 ($...$ 或 $$...$$)
  if (opts.removeMathFormulas) {
    result = result.replace(/\$\$[\s\S]*?\$\$/g, '')
    result = result.replace(/\$[^$]+\$/g, '')
  }

  // 移除URL
  if (opts.removeUrls) {
    result = result.replace(/https?:\/\/[^\s]+/g, '')
  }

  // 移除Markdown标记
  if (opts.removeMarkdown) {
    // 标题
    result = result.replace(/^#{1,6}\s+/gm, '')
    // 粗体/斜体
    result = result.replace(/\*\*([^*]+)\*\*/g, '$1')
    result = result.replace(/\*([^*]+)\*/g, '$1')
    result = result.replace(/__([^_]+)__/g, '$1')
    result = result.replace(/_([^_]+)_/g, '$1')
    // 链接
    result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // 图片
    result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    // 引用
    result = result.replace(/^>\s+/gm, '')
    // 列表标记
    result = result.replace(/^[\s]*[-*+]\s+/gm, '')
    result = result.replace(/^[\s]*\d+\.\s+/gm, '')
  }

  // 清理多余空白
  result = result.replace(/\s+/g, ' ').trim()

  return result
}

/**
 * 将文本分割为句子
 */
export function splitIntoSentences(text: string): string[] {
  if (!text.trim()) return []

  // 中文句号、问号、感叹号分句
  // 英文句号后跟空格分句
  const sentences: string[] = []
  let current = ''

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    current += char

    // 中文标点
    if ('。！？'.includes(char)) {
      sentences.push(current.trim())
      current = ''
    }
    // 英文标点 + 空格
    else if ('.!?'.includes(char) && (i + 1 >= text.length || text[i + 1] === ' ')) {
      sentences.push(current.trim())
      current = ''
    }
  }

  // 处理剩余文本
  if (current.trim()) {
    sentences.push(current.trim())
  }

  return sentences.filter((s) => s.length > 0)
}

/**
 * 将文本分割为段落
 */
export function splitIntoParagraphs(
  text: string,
  maxLength: number = 500
): TTSParagraph[] {
  // 按换行符分割
  const rawParagraphs = text.split(/\n\n+/).filter((p) => p.trim())
  const result: TTSParagraph[] = []

  rawParagraphs.forEach((raw, _idx) => {
    const normalized = normalizeText(raw)
    if (!normalized) return

    // 如果段落过长，进一步分割
    if (normalized.length > maxLength) {
      const sentences = splitIntoSentences(normalized)
      let current = ''
      // subIndex 预留用于后续实现段落内定位

      sentences.forEach((sentence) => {
        if (current.length + sentence.length > maxLength && current) {
          result.push({
            index: result.length,
            text: current,
            sentences: splitIntoSentences(current),
          })
          current = sentence
        } else {
          current += (current ? ' ' : '') + sentence
        }
      })

      if (current) {
        result.push({
          index: result.length,
          text: current,
          sentences: splitIntoSentences(current),
        })
      }
    } else {
      result.push({
        index: result.length,
        text: normalized,
        sentences: splitIntoSentences(normalized),
      })
    }
  })

  return result
}

/**
 * 从HTML内容提取纯文本
 */
export function extractTextFromHtml(html: string): string {
  // 使用 DOMParser 解析 HTML
  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')

    // 移除 script 和 style
    doc.querySelectorAll('script, style').forEach((el) => el.remove())

    // 获取文本内容
    return doc.body.textContent || ''
  }

  // 回退：简单正则移除标签
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

/**
 * 构建虚拟章节（用于无目录的PDF）
 */
export function buildVirtualChapters(
  totalPages: number,
  pagesPerChapter: number = 10
): TTSChapter[] {
  const chapters: TTSChapter[] = []
  const chapterCount = Math.ceil(totalPages / pagesPerChapter)

  for (let i = 0; i < chapterCount; i++) {
    const pageStart = i * pagesPerChapter + 1
    const pageEnd = Math.min((i + 1) * pagesPerChapter, totalPages)

    chapters.push({
      index: i,
      title: `第 ${pageStart}-${pageEnd} 页`,
      pageStart,
      pageEnd,
      paragraphs: [], // 将在加载时填充
    })
  }

  return chapters
}

/**
 * 估算朗读时长（毫秒）
 * 基于平均语速：中文约 250 字/分钟
 */
export function estimateDuration(text: string, speed: number = 1.0): number {
  const charsPerMinute = 250 * speed
  const minutes = text.length / charsPerMinute
  return Math.round(minutes * 60 * 1000)
}

/**
 * 格式化时长为 mm:ss 格式
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

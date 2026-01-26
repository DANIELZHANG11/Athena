/**
 * foliate-js TTS 桥接服务
 *
 * @description 利用 foliate-js 内置的 TTS 模块，桥接到 kokoro-js 或 Web Speech API
 *
 * foliate-js TTS 架构：
 * 1. view.initTTS(granularity, highlight) - 初始化 TTS
 * 2. view.tts.start() / .next() / .prev() - 返回 SSML 文档字符串
 * 3. SSML 需要外部语音合成器来朗读
 *
 * @see https://github.com/johnfactotum/foliate-js#text-to-speech-tts
 * @see 对话记录.md - 2.11 TTS 听书功能实施计划 (kokoro-js Client-Side)
 * @ai-generated Claude Opus 4.5 (2026-01-21)
 */

/**
 * foliate-view 元素类型（简化版）
 */
export interface FoliateViewElement extends HTMLElement {
  book?: {
    metadata?: {
      title?: string
      language?: string
    }
    toc?: Array<{ label: string; href: string; subitems?: unknown[] }>
    sections?: Array<{
      id: string
      linear: string
      createDocument: () => Promise<Document>
    }>
  }
  tts?: FoliateTTS
  /** 初始化 TTS (foliate-js 内置) - 可能不存在于旧版本 */
  initTTS?: (granularity?: 'word' | 'sentence', highlight?: (range: Range) => void) => Promise<void>
  /** 跳转到指定位置（href 或 CFI） */
  goTo?: (target: string) => Promise<void>
  renderer?: {
    getContents?: () => Array<{ doc: Document; index: number }>
    scrollToAnchor?: (range: Range, smooth?: boolean) => void
    /** 跳转到下一个章节 */
    nextSection?: () => Promise<boolean>
    /** 跳转到上一个章节 */
    prevSection?: () => Promise<boolean>
  }
}

/**
 * foliate-js TTS 类型
 */
export interface FoliateTTS {
  doc: Document
  highlight: (range: Range) => void
  start: () => string | undefined
  resume: () => string | undefined
  prev: (paused?: boolean) => string | undefined
  next: (paused?: boolean) => string | undefined
  from: (range: Range) => string | undefined
  setMark: (mark: string) => void
}

/**
 * SSML 解析结果
 */
export interface SSMLParseResult {
  text: string
  lang?: string
  marks: Array<{ name: string; offset: number }>
}

/**
 * 从 SSML 文档提取纯文本和标记
 *
 * @param ssmlString SSML 文档字符串
 * @returns 解析后的文本和标记位置
 */
export function parseSSML(ssmlString: string): SSMLParseResult {
  const parser = new DOMParser()
  const doc = parser.parseFromString(ssmlString, 'application/xml')
  const root = doc.documentElement

  const marks: Array<{ name: string; offset: number }> = []
  let text = ''

  // 递归遍历节点
  function traverse(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || ''
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element
      const tagName = el.localName

      // 处理 mark 元素
      if (tagName === 'mark') {
        const name = el.getAttribute('name')
        if (name) {
          marks.push({ name, offset: text.length })
        }
      }
      // 处理 break 元素
      else if (tagName === 'break') {
        text += ' '
      }

      // 递归处理子节点
      for (const child of Array.from(el.childNodes)) {
        traverse(child)
      }
    }
  }

  traverse(root)

  // 获取语言
  const lang = root.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang') || undefined

  return { text: text.trim(), lang, marks }
}

/**
 * TTS 桥接服务 - 连接 foliate-js TTS 和语音合成器
 */
export class TTSBridge {
  private view: FoliateViewElement | null = null
  private onHighlight?: (range: Range) => void
  private onMarkReached?: (mark: string) => void
  
  // 预览缓存：调用 next() 后缓存结果，以便 peekNextText 使用
  private nextTextCache: SSMLParseResult | null = null
  private hasConsumedCache = true  // true 表示缓存已被消费或不存在

  /**
   * 初始化 TTS 桥接
   *
   * @param view foliate-view 元素
   * @param options 选项
   */
  async init(
    view: FoliateViewElement,
    options?: {
      granularity?: 'word' | 'sentence'
      onHighlight?: (range: Range) => void
      onMarkReached?: (mark: string) => void
    }
  ): Promise<void> {
    this.view = view
    this.onHighlight = options?.onHighlight
    this.onMarkReached = options?.onMarkReached
    
    // 重置预览缓存
    this.nextTextCache = null
    this.hasConsumedCache = true

    const highlight = (range: Range) => {
      // 滚动到当前朗读位置
      view.renderer?.scrollToAnchor?.(range, true)
      // 触发高亮回调
      this.onHighlight?.(range)
    }

    // 使用 foliate-js 内置的 initTTS
    if (!view.initTTS) {
      throw new Error('foliate-view does not support TTS. Make sure tts.js is loaded.')
    }
    await view.initTTS(options?.granularity ?? 'sentence', highlight)
  }

  /**
   * 获取下一段 SSML 并解析为纯文本
   * 如果有预览缓存，直接返回缓存
   */
  getNextText(): SSMLParseResult | null {
    // 如果有未消费的缓存，返回缓存
    if (!this.hasConsumedCache && this.nextTextCache) {
      this.hasConsumedCache = true
      return this.nextTextCache
    }
    
    if (!this.view?.tts) return null
    const ssml = this.view.tts.next()
    if (!ssml) return null
    return parseSSML(ssml)
  }
  
  /**
   * 预览下一段文本（不推进位置）
   * 用于预加载下一段音频
   */
  peekNextText(): SSMLParseResult | null {
    // 如果已有缓存且未消费，直接返回
    if (!this.hasConsumedCache && this.nextTextCache) {
      return this.nextTextCache
    }
    
    if (!this.view?.tts) return null
    
    // 调用 next() 获取下一段
    const ssml = this.view.tts.next()
    if (!ssml) return null
    
    // 缓存结果
    this.nextTextCache = parseSSML(ssml)
    this.hasConsumedCache = false
    
    return this.nextTextCache
  }

  /**
   * 获取上一段 SSML 并解析为纯文本
   */
  getPrevText(): SSMLParseResult | null {
    if (!this.view?.tts) return null
    const ssml = this.view.tts.prev()
    if (!ssml) return null
    return parseSSML(ssml)
  }

  /**
   * 开始朗读
   */
  getStartText(): SSMLParseResult | null {
    if (!this.view?.tts) return null
    const ssml = this.view.tts.start()
    if (!ssml) return null
    return parseSSML(ssml)
  }

  /**
   * 恢复朗读
   */
  getResumeText(): SSMLParseResult | null {
    if (!this.view?.tts) return null
    const ssml = this.view.tts.resume()
    if (!ssml) return null
    return parseSSML(ssml)
  }

  /**
   * 通知 foliate-js 当前朗读到哪个标记
   * 这会触发高亮
   */
  setMark(mark: string): void {
    this.view?.tts?.setMark(mark)
    this.onMarkReached?.(mark)
  }

  /**
   * 检查 TTS 是否已初始化
   */
  isReady(): boolean {
    return !!this.view?.tts
  }

  /**
   * 获取书籍语言
   */
  getLanguage(): string | undefined {
    return this.view?.book?.metadata?.language
  }
}

// 导出单例
export const ttsBridge = new TTSBridge()

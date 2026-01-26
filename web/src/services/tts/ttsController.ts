/**
 * TTS 控制器 - 整合 foliate-js TTS 与语音合成
 *
 * @description 协调 foliate-js 的 TTS 文本分段与 Kokoro TTS 语音合成
 *
 * 架构流程：
 * 1. EpubReader 传递 foliate-view 引用
 * 2. TTSController 初始化 foliate-js TTS
 * 3. 获取 SSML 文本 -> 解析为纯文本
 * 4. 调用 Kokoro-82M-v1.1-zh 合成语音 (100% 浏览器端)
 * 5. 播放音频，监听 mark 事件触发高亮
 *
 * @see 对话记录.md - 2.11 TTS 听书功能实施计划 (Kokoro-82M)
 * @ai-generated Claude Opus 4.5 (2026-01-23)
 */

import { ttsBridge, type FoliateViewElement, type SSMLParseResult } from './epubExtractor'

/**
 * 语音合成器接口
 */
export interface SpeechSynthesizer {
  /** 合成并播放文本 */
  speak(text: string, options?: SpeakOptions): Promise<void>
  /** 停止播放 */
  stop(): void
  /** 暂停播放 */
  pause(): void
  /** 恢复播放 */
  resume(): void
  /** 是否正在播放 */
  isSpeaking(): boolean
  /** 设置语速 */
  setRate(rate: number): void
  /** 设置音量 */
  setVolume(volume: number): void
  /** 设置语音（可选） */
  setVoice?(voiceURI: string): void
}

export interface SpeakOptions {
  lang?: string
  rate?: number
  volume?: number
  onEnd?: () => void
  onBoundary?: (charIndex: number, charLength: number) => void
  onError?: (error: Error) => void
}

/**
 * Web Speech API 合成器实现（主要方案）
 * 支持语音选择、语速调节
 */
export class WebSpeechSynthesizer implements SpeechSynthesizer {
  private utterance: SpeechSynthesisUtterance | null = null
  private rate = 1.0
  private volume = 1.0
  private voiceURI: string = ''
  private voices: SpeechSynthesisVoice[] = []
  private isVoicesLoaded = false

  constructor() {
    // 在构造时加载语音列表
    this.loadVoices()
  }

  /**
   * 加载可用语音列表
   */
  private loadVoices(): void {
    const synth = window.speechSynthesis
    if (!synth) return

    const updateVoices = () => {
      this.voices = synth.getVoices()
      this.isVoicesLoaded = true
      console.log('[WebSpeechSynthesizer] 语音已加载:', this.voices.length)

      // 如果还没设置语音，选择默认中文语音
      if (!this.voiceURI && this.voices.length > 0) {
        const zhVoice = this.voices.find(v => v.lang.startsWith('zh'))
        if (zhVoice) {
          this.voiceURI = zhVoice.voiceURI
          console.log('[WebSpeechSynthesizer] 默认语音:', zhVoice.name)
        }
      }
    }

    // 尝试立即获取
    const existingVoices = synth.getVoices()
    if (existingVoices.length > 0) {
      this.voices = existingVoices
      this.isVoicesLoaded = true
    } else {
      // 等待 voiceschanged 事件
      synth.addEventListener('voiceschanged', updateVoices, { once: true })
    }
  }

  /**
   * 获取可用语音列表
   */
  getVoices(): SpeechSynthesisVoice[] {
    if (!this.isVoicesLoaded) {
      this.voices = window.speechSynthesis?.getVoices() || []
    }
    return this.voices
  }

  /**
   * 设置语音
   */
  setVoice(voiceURI: string): void {
    this.voiceURI = voiceURI
    console.log('[WebSpeechSynthesizer] 语音已设置:', voiceURI)
  }

  speak(text: string, options?: SpeakOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      // 取消之前的语音
      window.speechSynthesis.cancel()

      const utterance = new SpeechSynthesisUtterance(text)
      this.utterance = utterance

      // 设置语音
      if (this.voiceURI && this.voices.length > 0) {
        const voice = this.voices.find(v => v.voiceURI === this.voiceURI)
        if (voice) {
          utterance.voice = voice
          console.log('[WebSpeechSynthesizer] 使用语音:', voice.name)
        }
      }

      // 设置参数
      utterance.rate = options?.rate ?? this.rate
      utterance.volume = options?.volume ?? this.volume
      utterance.lang = options?.lang ?? 'zh-CN'

      // 事件处理
      utterance.onend = () => {
        options?.onEnd?.()
        resolve()
      }

      utterance.onerror = (event) => {
        const error = new Error(`Speech synthesis error: ${event.error}`)
        options?.onError?.(error)
        reject(error)
      }

      utterance.onboundary = (event) => {
        if (event.name === 'word' || event.name === 'sentence') {
          options?.onBoundary?.(event.charIndex, event.charLength ?? 1)
        }
      }

      // 开始播放
      window.speechSynthesis.speak(utterance)
    })
  }

  stop(): void {
    window.speechSynthesis.cancel()
    this.utterance = null
  }

  pause(): void {
    window.speechSynthesis.pause()
  }

  resume(): void {
    window.speechSynthesis.resume()
  }

  isSpeaking(): boolean {
    return window.speechSynthesis.speaking
  }

  setRate(rate: number): void {
    this.rate = Math.max(0.5, Math.min(2.0, rate))
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
  }
}

// EdgeSynthesizer 类已移除 - 改用 WebSpeechSynthesizer（基于浏览器原生 Web Speech API）

/**
 * TTS 播放状态
 */
export type TTSControllerState = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

/**
 * TTS 控制器事件
 */
export interface TTSControllerEvents {
  onStateChange?: (state: TTSControllerState) => void
  onHighlight?: (range: Range) => void
  onChapterChange?: (chapterTitle: string) => void
  onError?: (error: Error) => void
  onComplete?: () => void
  /** 当前章节朗读完毕，需要跳转到下一章 */
  onChapterEnd?: () => void
}

/**
 * TTS 控制器配置
 */
export interface TTSControllerConfig {
  /** 文本分段粒度 */
  granularity?: 'word' | 'sentence'
  /** 语速 */
  rate?: number
  /** 音量 */
  volume?: number
  /** 使用的合成器 */
  synthesizer?: SpeechSynthesizer
}

/**
 * TTS 控制器
 *
 * 整合 foliate-js TTS 与语音合成器
 */
export class TTSController {
  private synthesizer: SpeechSynthesizer
  private state: TTSControllerState = 'idle'
  private events: TTSControllerEvents = {}
  private currentText: SSMLParseResult | null = null
  private isInitialized = false
  private rate = 1.0
  private volume = 1.0
  private view: FoliateViewElement | null = null
  private granularity: 'word' | 'sentence' = 'sentence'
  /** 当前播放的章节索引 (0-based)，用于进度同步 */
  private currentChapterIndex = 0

  constructor(config?: TTSControllerConfig) {
    this.synthesizer = config?.synthesizer ?? new WebSpeechSynthesizer()
    this.rate = config?.rate ?? 1.0
    this.volume = config?.volume ?? 1.0
    this.granularity = config?.granularity ?? 'sentence'
    this.synthesizer.setRate(this.rate)
    this.synthesizer.setVolume(this.volume)
  }

  /**
   * 设置事件监听
   */
  setEvents(events: TTSControllerEvents): void {
    this.events = events
  }

  /**
   * 初始化 TTS（需要 foliate-view 引用）
   */
  async init(
    view: FoliateViewElement,
    config?: { granularity?: 'word' | 'sentence' }
  ): Promise<void> {
    this.setState('loading')
    this.view = view
    this.granularity = config?.granularity ?? 'sentence'

    try {
      await ttsBridge.init(view, {
        granularity: this.granularity,
        onHighlight: (range) => this.events.onHighlight?.(range),
      })
      this.isInitialized = true
      this.setState('idle')
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.setState('error')
      this.events.onError?.(err)
      throw err
    }
  }

  /**
   * 开始播放
   */
  async play(): Promise<void> {
    console.log('[TTSController] play() called', {
      isInitialized: this.isInitialized,
      currentState: this.state,
      hasCurrentText: !!this.currentText
    })

    if (!this.isInitialized) {
      throw new Error('TTS not initialized. Call init() first.')
    }

    // 获取第一段文本
    const text = this.currentText ?? ttsBridge.getStartText()
    console.log('[TTSController] getStartText result:', {
      hasText: !!text,
      text: text?.text?.substring(0, 50) || null
    })

    if (!text) {
      console.warn('[TTSController] No text to speak, calling onComplete')
      this.events.onComplete?.()
      return
    }

    await this.speakText(text)
  }

  /**
   * 恢复播放
   */
  async resume(): Promise<void> {
    if (this.state === 'paused') {
      this.synthesizer.resume()
      this.setState('playing')
    } else {
      // 从当前位置继续
      const text = ttsBridge.getResumeText()
      if (text) {
        await this.speakText(text)
      }
    }
  }

  /**
   * 暂停播放
   */
  pause(): void {
    this.synthesizer.pause()
    this.setState('paused')
  }

  /**
   * 停止播放
   */
  stop(): void {
    this.synthesizer.stop()
    this.currentText = null
    this.setState('idle')
  }

  /**
   * 下一段
   */
  async next(): Promise<void> {
    const text = ttsBridge.getNextText()
    if (!text) {
      // 章节朗读完毕，尝试自动跳转到下一章
      console.log('[TTSController] Chapter ended, trying to navigate to next chapter...')

      const success = await this.nextChapter()
      if (!success) {
        // 没有下一章了（可能是最后一章），触发完成事件
        console.log('[TTSController] No more chapters, playback complete')
        this.events.onComplete?.()
        this.stop()
      }
      return
    }
    await this.speakText(text)
  }

  /**
   * 上一段
   */
  async prev(): Promise<void> {
    const text = ttsBridge.getPrevText()
    if (text) {
      await this.speakText(text)
    }
  }

  /**
   * 跳转到指定章节（通过 href）并开始播放
   */
  async goToHref(href: string): Promise<boolean> {
    if (!this.view?.goTo) {
      console.warn('[TTSController] goTo not available')
      return false
    }

    console.log('[TTSController] Navigating to href:', href)
    this.setState('loading')

    try {
      // 先停止当前播放
      this.synthesizer.stop()

      // 跳转到指定位置
      await this.view.goTo(href)

      // 等待页面加载完成
      await new Promise(resolve => setTimeout(resolve, 300))

      // 重新初始化 TTS
      await ttsBridge.init(this.view, {
        granularity: this.granularity,
        onHighlight: (range) => this.events.onHighlight?.(range),
      })

      // 更新当前章节索引（从 renderer 获取）
      const contents = this.view.renderer?.getContents?.()
      if (contents && contents.length > 0) {
        const currentIndex = contents[0].index
        console.log('[TTSController] goToHref: chapter index:', currentIndex)
        this.currentChapterIndex = currentIndex
      }

      // 开始播放新章节
      const text = ttsBridge.getStartText()
      if (!text) {
        console.log('[TTSController] No text at target location')
        this.setState('paused')
        return false
      }

      await this.speakText(text)
      return true
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      console.error('[TTSController] Failed to navigate to href:', err)
      this.events.onError?.(err)
      this.setState('error')
      return false
    }
  }

  /**
   * 跳转到下一章并继续播放
   */
  async nextChapter(): Promise<boolean> {
    if (!this.view?.renderer?.nextSection) {
      console.warn('[TTSController] nextSection not available')
      return false
    }

    console.log('[TTSController] Navigating to next chapter...')
    this.setState('loading')

    try {
      // 跳转到下一章
      await this.view.renderer.nextSection()

      // 等待页面加载完成
      await new Promise(resolve => setTimeout(resolve, 300))

      // 重新初始化 TTS（foliate-js 会检测到新的 doc 并重新创建 TTS 对象）
      await ttsBridge.init(this.view, {
        granularity: this.granularity,
        onHighlight: (range) => this.events.onHighlight?.(range),
      })

      // 获取章节标题（如果可用）
      const contents = this.view.renderer.getContents?.()
      if (contents && contents.length > 0) {
        const currentIndex = contents[0].index
        const section = this.view.book?.sections?.[currentIndex]
        if (section) {
          console.log('[TTSController] New chapter:', currentIndex)
          // 更新当前章节索引（用于进度同步）
          this.currentChapterIndex = currentIndex
        }
      }

      // 开始播放新章节
      const text = ttsBridge.getStartText()
      if (!text) {
        // 新章节没有内容，触发完成事件
        console.log('[TTSController] No text in new chapter, completing')
        this.events.onComplete?.()
        this.stop()
        return false
      }

      await this.speakText(text)
      return true
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      console.error('[TTSController] Failed to navigate to next chapter:', err)
      this.events.onError?.(err)
      this.setState('error')
      return false
    }
  }

  /**
   * 跳转到上一章并开始播放
   */
  async prevChapter(): Promise<boolean> {
    if (!this.view?.renderer?.prevSection) {
      console.warn('[TTSController] prevSection not available')
      return false
    }

    console.log('[TTSController] Navigating to previous chapter...')
    this.setState('loading')

    try {
      // 跳转到上一章
      await this.view.renderer.prevSection()

      // 等待页面加载完成
      await new Promise(resolve => setTimeout(resolve, 300))

      // 重新初始化 TTS
      await ttsBridge.init(this.view, {
        granularity: this.granularity,
        onHighlight: (range) => this.events.onHighlight?.(range),
      })

      // 更新当前章节索引（用于进度同步）
      const contents = this.view.renderer.getContents?.()
      if (contents && contents.length > 0) {
        const currentIndex = contents[0].index
        console.log('[TTSController] Previous chapter:', currentIndex)
        this.currentChapterIndex = currentIndex
      }

      // 开始播放新章节
      const text = ttsBridge.getStartText()
      if (!text) {
        console.log('[TTSController] No text in previous chapter')
        return false
      }

      await this.speakText(text)
      return true
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      console.error('[TTSController] Failed to navigate to previous chapter:', err)
      this.events.onError?.(err)
      this.setState('error')
      return false
    }
  }

  /**
   * 设置语速
   */
  setRate(rate: number): void {
    this.rate = rate
    this.synthesizer.setRate(rate)
  }

  /**
   * 设置音量
   */
  setVolume(volume: number): void {
    this.volume = volume
    this.synthesizer.setVolume(volume)
  }

  /**
   * 获取当前状态
   */
  getState(): TTSControllerState {
    return this.state
  }

  /**
   * 获取当前章节索引 (0-based)
   */
  getCurrentChapterIndex(): number {
    return this.currentChapterIndex
  }

  /**
   * 设置当前章节索引 (0-based)
   * 用于在 goToHref 或初始化时设置章节索引
   */
  setCurrentChapterIndex(index: number): void {
    this.currentChapterIndex = index
  }

  /**
   * 检查是否已初始化
   */
  isReady(): boolean {
    return this.isInitialized
  }

  /**
   * 销毁控制器
   */
  destroy(): void {
    this.stop()
    this.isInitialized = false
  }

  // ============ 私有方法 ============

  private async speakText(text: SSMLParseResult): Promise<void> {
    console.log('[TTSController] speakText called:', {
      text: text.text.substring(0, 50),
      lang: text.lang,
      marksCount: text.marks.length
    })

    this.currentText = text
    this.setState('playing')

    try {
      // 预先获取下一段文本，以便在播放时提前合成
      const nextText = ttsBridge.peekNextText?.()
      console.log('[TTSController] 下一段文本预览:', nextText?.text?.substring(0, 50))

      // 检查合成器是否支持预加载（运行时类型检查）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const synthesizer = this.synthesizer as any
      const usePreload = typeof synthesizer.speakWithPreload === 'function'
      console.log('[TTSController] 使用预加载模式:', usePreload)

      const speakPromise = usePreload
        ? synthesizer.speakWithPreload(text.text, {
          lang: text.lang ?? 'zh-CN',
          rate: this.rate,
          volume: this.volume,
          onEnd: () => {
            // 自动播放下一段
            console.log('[TTSController] speakWithPreload onEnd 触发，准备播放下一段...')
            this.next().catch((err) => {
              console.error('[TTSController] Error playing next:', err)
            })
          },
          onBoundary: (charIndex, _charLength) => {
            // 尝试匹配 mark
            for (const mark of text.marks) {
              if (charIndex >= mark.offset) {
                ttsBridge.setMark(mark.name)
              }
            }
          },
          onError: (error) => {
            this.setState('error')
            this.events.onError?.(error)
          },
        })
        : this.synthesizer.speak(text.text, {
          lang: text.lang ?? 'zh-CN',
          rate: this.rate,
          volume: this.volume,
          onEnd: () => {
            // 自动播放下一段
            this.next().catch((err) => {
              console.error('[TTSController] Error playing next:', err)
            })
          },
          onBoundary: (charIndex, _charLength) => {
            // 尝试匹配 mark
            for (const mark of text.marks) {
              if (charIndex >= mark.offset) {
                ttsBridge.setMark(mark.name)
              }
            }
          },
          onError: (error) => {
            this.setState('error')
            this.events.onError?.(error)
          },
        })

      // 播放开始后，异步预加载下一段（如果有）
      if (usePreload && nextText) {
        // 延迟 100ms 后开始预加载，确保当前播放已启动
        setTimeout(() => {
          synthesizer.preload(nextText.text).catch((err) => {
            console.error('[TTSController] Preload failed:', err)
          })
        }, 100)
      }

      await speakPromise
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.setState('error')
      this.events.onError?.(err)
    }
  }

  private setState(state: TTSControllerState): void {
    if (this.state !== state) {
      this.state = state
      this.events.onStateChange?.(state)
    }
  }
}

// 导出单例
let ttsControllerInstance: TTSController | null = null



/**
 * 获取 TTS 控制器单例
 * 使用浏览器原生 Web Speech API（完全离线）
 */
export function getTTSController(): TTSController {
  if (!ttsControllerInstance) {
    console.log('[TTSController] 使用 Web Speech API 合成器')
    ttsControllerInstance = new TTSController({
      synthesizer: new WebSpeechSynthesizer(),
    })
  }
  return ttsControllerInstance
}

export function destroyTTSController(): void {
  ttsControllerInstance?.destroy()
  ttsControllerInstance = null
}
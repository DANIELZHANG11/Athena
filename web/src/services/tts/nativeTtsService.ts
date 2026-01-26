/**
 * 原生 TTS 服务 (基于 Web Speech API)
 *
 * @description 完全在客户端运行的 TTS 服务
 * - Web 端：使用浏览器原生 speechSynthesis API
 * - 移动端：后续可集成 Capacitor Text-to-Speech 插件
 * - OFFLINE-FIRST：无需网络连接（使用系统语音）
 *
 * @see 对话记录.md - 2.11 TTS 听书功能实施计划
 * @ai-generated Claude Opus 4 (2026-01-24)
 */

// ============ 类型定义 ============

export interface NativeTTSSpeakOptions {
    /** 语音 URI/ID */
    voice?: string
    /** 语速: 0.1 - 10.0, 默认 1.0 */
    rate?: number
    /** 音调: 0 - 2, 默认 1.0 */
    pitch?: number
    /** 音量: 0 - 1, 默认 1.0 */
    volume?: number
    /** 语言代码 */
    lang?: string
}

export interface NativeVoiceInfo {
    /** 语音唯一标识 */
    voiceURI: string
    /** 语音名称 */
    name: string
    /** 语言代码 */
    lang: string
    /** 是否本地语音 */
    localService: boolean
    /** 是否默认语音 */
    default: boolean
}

// ============ 常量 ============

const DEFAULT_VOICE_LANG = 'zh-CN'
const FALLBACK_VOICE_LANGS = ['zh', 'en-US', 'en']

// ============ 工具函数 ============

/**
 * 等待语音列表加载
 */
function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
    return new Promise((resolve) => {
        const synth = window.speechSynthesis
        if (!synth) {
            resolve([])
            return
        }

        // 有些浏览器需要等待 voiceschanged 事件
        const voices = synth.getVoices()
        if (voices.length > 0) {
            resolve(voices)
            return
        }

        // 等待语音加载
        synth.addEventListener('voiceschanged', () => {
            resolve(synth.getVoices())
        }, { once: true })

        // 超时保护
        setTimeout(() => {
            resolve(synth.getVoices())
        }, 2000)
    })
}

// ============ 服务类 ============

class NativeTTSService {
    private currentVoice: string = ''
    private currentRate: number = 1.0
    private currentPitch: number = 1.0
    private currentVolume: number = 1.0
    private isInitialized: boolean = false
    private voices: SpeechSynthesisVoice[] = []
    private currentUtterance: SpeechSynthesisUtterance | null = null

    /**
     * 初始化服务
     */
    async init(): Promise<void> {
        if (this.isInitialized) return

        // Web 平台使用 speechSynthesis
        if (!('speechSynthesis' in window)) {
            console.warn('[NativeTTS] 浏览器不支持 speechSynthesis')
            this.isInitialized = true
            return
        }

        // 等待语音列表加载
        this.voices = await waitForVoices()
        console.log('[NativeTTS] 可用语音数量:', this.voices.length)

        // 选择默认中文语音
        this.selectDefaultVoice()

        this.isInitialized = true
        console.log('[NativeTTS] 服务初始化完成（Web Speech API）')
    }

    /**
     * 选择默认语音（优先中文）
     */
    private selectDefaultVoice(): void {
        if (this.voices.length === 0) return

        // 优先查找中文语音
        for (const langCode of [DEFAULT_VOICE_LANG, ...FALLBACK_VOICE_LANGS]) {
            const voice = this.voices.find(v =>
                v.lang.toLowerCase().startsWith(langCode.toLowerCase())
            )
            if (voice) {
                this.currentVoice = voice.voiceURI
                console.log('[NativeTTS] 默认语音:', voice.name, voice.lang)
                return
            }
        }

        // 没找到就用第一个
        if (this.voices[0]) {
            this.currentVoice = this.voices[0].voiceURI
        }
    }

    /**
     * 朗读文本
     * @returns Promise 在朗读结束时 resolve
     */
    async speak(text: string, options?: NativeTTSSpeakOptions): Promise<void> {
        if (!this.isInitialized) {
            await this.init()
        }

        const rate = options?.rate ?? this.currentRate
        const pitch = options?.pitch ?? this.currentPitch
        const volume = options?.volume ?? this.currentVolume
        const lang = options?.lang ?? DEFAULT_VOICE_LANG

        console.log('[NativeTTS] 开始朗读:', { textLen: text.length, rate, pitch })

        return this.speakWeb(text, { ...options, rate, pitch, volume, lang })
    }

    /**
     * Web 平台朗读
     */
    private speakWeb(text: string, options: NativeTTSSpeakOptions): Promise<void> {
        return new Promise((resolve, reject) => {
            const synth = window.speechSynthesis
            if (!synth) {
                reject(new Error('speechSynthesis not supported'))
                return
            }

            // 先停止当前朗读
            synth.cancel()

            const utterance = new SpeechSynthesisUtterance(text)
            this.currentUtterance = utterance

            // 设置语音
            const voiceURI = options.voice || this.currentVoice
            if (voiceURI) {
                const voice = this.voices.find(v => v.voiceURI === voiceURI)
                if (voice) {
                    utterance.voice = voice
                }
            }

            // 设置参数
            utterance.rate = options.rate ?? this.currentRate
            utterance.pitch = options.pitch ?? this.currentPitch
            utterance.volume = options.volume ?? this.currentVolume
            utterance.lang = options.lang ?? DEFAULT_VOICE_LANG

            utterance.onend = () => {
                this.currentUtterance = null
                resolve()
            }

            utterance.onerror = (event) => {
                this.currentUtterance = null
                console.error('[NativeTTS] 朗读错误:', event.error)
                reject(new Error(event.error))
            }

            synth.speak(utterance)
        })
    }

    /**
     * 停止朗读
     */
    async stop(): Promise<void> {
        window.speechSynthesis?.cancel()
        this.currentUtterance = null
    }

    /**
     * 暂停朗读
     */
    pause(): void {
        window.speechSynthesis?.pause()
    }

    /**
     * 恢复朗读
     */
    resume(): void {
        window.speechSynthesis?.resume()
    }

    /**
     * 获取可用语音列表
     */
    async getVoices(): Promise<NativeVoiceInfo[]> {
        if (!this.isInitialized) {
            await this.init()
        }

        return this.voices.map(v => ({
            voiceURI: v.voiceURI,
            name: v.name,
            lang: v.lang,
            localService: v.localService,
            default: v.default
        }))
    }

    /**
     * 获取推荐的中文语音
     */
    getChineseVoices(): NativeVoiceInfo[] {
        return this.voices
            .filter(v => v.lang.toLowerCase().startsWith('zh'))
            .map(v => ({
                voiceURI: v.voiceURI,
                name: v.name,
                lang: v.lang,
                localService: v.localService,
                default: v.default
            }))
    }

    /**
     * 设置默认语音
     */
    setVoice(voiceURI: string): void {
        this.currentVoice = voiceURI
        console.log('[NativeTTS] 语音已设置:', voiceURI)
    }

    /**
     * 获取当前语音
     */
    getVoice(): string {
        return this.currentVoice
    }

    /**
     * 设置语速
     * @param rate 0.1 - 10.0
     */
    setRate(rate: number): void {
        this.currentRate = Math.max(0.1, Math.min(10.0, rate))
        console.log('[NativeTTS] 语速已设置:', this.currentRate)
    }

    /**
     * 获取当前语速
     */
    getRate(): number {
        return this.currentRate
    }

    /**
     * 设置音调
     * @param pitch 0 - 2
     */
    setPitch(pitch: number): void {
        this.currentPitch = Math.max(0, Math.min(2, pitch))
        console.log('[NativeTTS] 音调已设置:', this.currentPitch)
    }

    /**
     * 设置音量
     * @param volume 0 - 1
     */
    setVolume(volume: number): void {
        this.currentVolume = Math.max(0, Math.min(1, volume))
        console.log('[NativeTTS] 音量已设置:', this.currentVolume)
    }

    /**
     * 获取当前设置
     */
    getSettings(): { voice: string; rate: number; pitch: number; volume: number } {
        return {
            voice: this.currentVoice,
            rate: this.currentRate,
            pitch: this.currentPitch,
            volume: this.currentVolume
        }
    }

    /**
     * 是否正在朗读
     */
    isSpeaking(): boolean {
        return window.speechSynthesis?.speaking ?? false
    }

    /**
     * 检查 TTS 是否可用
     */
    isSupported(): boolean {
        return 'speechSynthesis' in window
    }

    /**
     * 释放资源
     */
    async dispose(): Promise<void> {
        await this.stop()
        this.isInitialized = false
        this.voices = []
        console.log('[NativeTTS] 服务已释放')
    }
}

// ============ 单例导出 ============

export const nativeTts = new NativeTTSService()

// 向后兼容的别名
export const edgeTts = nativeTts

// 默认导出
export default nativeTts

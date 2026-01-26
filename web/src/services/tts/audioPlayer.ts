/**
 * TTS 音频播放器
 *
 * @description 音频播放控制，支持MediaSession后台播放
 * 管理音频队列、播放进度、锁屏控制
 *
 * @see 对话记录.md - 2.11 TTS 听书功能实施计划 - Phase 3
 * @ai-generated Claude Opus 4.5 (2026-01-20)
 */

export type AudioPlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended'

export interface AudioPlayerEvents {
  onStateChange?: (state: AudioPlayerState) => void
  onProgress?: (currentTime: number, duration: number) => void
  onEnded?: () => void
  onError?: (error: Error) => void
}

/**
 * 音频播放器类
 */
export class AudioPlayer {
  private audioContext: AudioContext | null = null
  private currentSource: AudioBufferSourceNode | null = null
  private currentBuffer: AudioBuffer | null = null
  private startTime = 0
  private pauseTime = 0
  private state: AudioPlayerState = 'idle'
  private events: AudioPlayerEvents = {}
  private progressInterval: number | null = null
  private gainNode: GainNode | null = null

  constructor(events?: AudioPlayerEvents) {
    if (events) {
      this.events = events
    }
  }

  /**
   * 设置事件回调
   */
  setEvents(events: AudioPlayerEvents): void {
    this.events = { ...this.events, ...events }
  }

  /**
   * 初始化音频上下文
   */
  private async initAudioContext(): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext()
      this.gainNode = this.audioContext.createGain()
      this.gainNode.connect(this.audioContext.destination)
    }

    // 恢复被暂停的上下文
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }
  }

  /**
   * 从 Float32Array 创建 AudioBuffer
   */
  private createBufferFromFloat32(
    data: Float32Array<ArrayBuffer>,
    sampleRate: number
  ): AudioBuffer {
    if (!this.audioContext) {
      throw new Error('AudioContext 未初始化')
    }

    const buffer = this.audioContext.createBuffer(1, data.length, sampleRate)
    buffer.copyToChannel(data, 0)
    return buffer
  }

  /**
   * 加载音频数据
   */
  async load(audioData: ArrayBuffer, sampleRate: number): Promise<void> {
    await this.initAudioContext()

    this.setState('loading')

    try {
      // 将 ArrayBuffer 转为 Float32Array
      const float32Data = new Float32Array(audioData)
      this.currentBuffer = this.createBufferFromFloat32(float32Data, sampleRate)
      this.pauseTime = 0
      this.setState('idle')
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.events.onError?.(err)
      this.setState('idle')
      throw err
    }
  }

  /**
   * 播放音频
   */
  async play(offset: number = 0): Promise<void> {
    if (!this.audioContext || !this.currentBuffer || !this.gainNode) {
      throw new Error('音频未加载')
    }

    await this.initAudioContext()

    // 停止当前播放
    this.stopSource()

    // 创建新的 source
    this.currentSource = this.audioContext.createBufferSource()
    this.currentSource.buffer = this.currentBuffer
    this.currentSource.connect(this.gainNode)

    // 设置结束回调
    this.currentSource.onended = () => {
      if (this.state === 'playing') {
        this.setState('ended')
        this.events.onEnded?.()
      }
    }

    // 计算起始位置
    const startOffset = offset > 0 ? offset : this.pauseTime

    // 开始播放
    this.currentSource.start(0, startOffset)
    this.startTime = this.audioContext.currentTime - startOffset
    this.setState('playing')

    // 启动进度更新
    this.startProgressUpdates()

    // 设置 MediaSession
    this.setupMediaSession()
  }

  /**
   * 暂停播放
   */
  pause(): void {
    if (this.state !== 'playing' || !this.audioContext) return

    this.pauseTime = this.audioContext.currentTime - this.startTime
    this.stopSource()
    this.setState('paused')
    this.stopProgressUpdates()
  }

  /**
   * 恢复播放
   */
  async resume(): Promise<void> {
    if (this.state !== 'paused') return
    await this.play()
  }

  /**
   * 停止播放
   */
  stop(): void {
    this.stopSource()
    this.pauseTime = 0
    this.setState('idle')
    this.stopProgressUpdates()
  }

  /**
   * 跳转到指定时间
   */
  async seek(time: number): Promise<void> {
    const wasPlaying = this.state === 'playing'
    this.stop()
    this.pauseTime = time

    if (wasPlaying) {
      await this.play(time)
    }
  }

  /**
   * 设置音量 (0-1)
   */
  setVolume(volume: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(1, volume))
    }
  }

  /**
   * 获取当前播放时间
   */
  getCurrentTime(): number {
    if (this.state === 'playing' && this.audioContext) {
      return this.audioContext.currentTime - this.startTime
    }
    return this.pauseTime
  }

  /**
   * 获取音频时长
   */
  getDuration(): number {
    return this.currentBuffer?.duration ?? 0
  }

  /**
   * 获取当前状态
   */
  getState(): AudioPlayerState {
    return this.state
  }

  /**
   * 销毁播放器
   */
  destroy(): void {
    this.stop()
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
    this.currentBuffer = null
    this.gainNode = null
  }

  /**
   * 停止当前 source
   */
  private stopSource(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop()
        this.currentSource.disconnect()
      } catch {
        // 忽略已停止的 source
      }
      this.currentSource = null
    }
  }

  /**
   * 设置状态
   */
  private setState(state: AudioPlayerState): void {
    this.state = state
    this.events.onStateChange?.(state)
  }

  /**
   * 启动进度更新
   */
  private startProgressUpdates(): void {
    this.stopProgressUpdates()
    this.progressInterval = window.setInterval(() => {
      if (this.state === 'playing') {
        const currentTime = this.getCurrentTime()
        const duration = this.getDuration()
        this.events.onProgress?.(currentTime, duration)
      }
    }, 250) // 每250ms更新一次
  }

  /**
   * 停止进度更新
   */
  private stopProgressUpdates(): void {
    if (this.progressInterval !== null) {
      clearInterval(this.progressInterval)
      this.progressInterval = null
    }
  }

  /**
   * 设置 MediaSession (锁屏控制)
   */
  private setupMediaSession(): void {
    if (!('mediaSession' in navigator)) return

    // MediaSession 会在 TTSStore 中统一设置
    // 这里只触发状态变化
    navigator.mediaSession.playbackState = 'playing'
  }
}

// 单例导出
let playerInstance: AudioPlayer | null = null

export function getAudioPlayer(): AudioPlayer {
  if (!playerInstance) {
    playerInstance = new AudioPlayer()
  }
  return playerInstance
}

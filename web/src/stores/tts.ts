/**
 * TTS 状态管理 (Zustand)
 *
 * @description 管理TTS播放状态、设置、进度同步
 * 支持后台播放、睡眠定时、跨设备进度恢复
 *
 * @see 对话记录.md - 2.11 TTS 听书功能实施计划 (Edge TTS)
 * @ai-generated Claude Opus 4.5 (2026-01-24)
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { AbstractPowerSyncDatabase } from '@powersync/web'
import type {
  TTSPlayState,
  SleepTimerType,
  TTSPosition as _TTSPosition,
  TTSState,
  TTSVoiceModel,
  TTSChapter,
} from '@/services/tts/types'
import { BUNDLED_MODEL } from '@/services/tts/types'
import { edgeTts } from '@/services/tts'
import { getAudioPlayer } from '@/services/tts/audioPlayer'
import { syncTTSProgress, loadTTSProgress } from '@/services/tts/progressSync'
import { getTTSController } from '@/services/tts/ttsController'

// ============ PowerSync 数据库引用 ============
let powerSyncDb: AbstractPowerSyncDatabase | null = null

/**
 * 设置 PowerSync 数据库引用 (由组件调用)
 */
export function setTTSPowerSyncDb(db: AbstractPowerSyncDatabase | null): void {
  powerSyncDb = db
}

// ============ 进度同步常量 ============
/** 进度同步间隔 (毫秒) - 2分钟 */
const SYNC_INTERVAL_MS = 2 * 60 * 1000

// ============ 预加载缓存 ============
interface PreloadedAudio {
  chapterIndex: number
  paragraphIndex: number
  arrayBuffer: ArrayBuffer
  sampleRate: number
}

let preloadedAudio: PreloadedAudio | null = null
let isPreloading = false

/**
 * 预加载下一段音频
 * 在后台合成，不阻塞当前播放
 */
async function preloadNextParagraph(
  chapterIndex: number,
  paragraphIndex: number,
  speed: number,
  chapters: TTSChapter[]
): Promise<void> {
  if (isPreloading) return

  const chapter = chapters[chapterIndex]
  if (!chapter) return

  const paragraph = chapter.paragraphs?.[paragraphIndex]
  if (!paragraph?.text) return

  // 如果已经预加载了这一段，跳过
  if (
    preloadedAudio &&
    preloadedAudio.chapterIndex === chapterIndex &&
    preloadedAudio.paragraphIndex === paragraphIndex
  ) {
    return
  }

  isPreloading = true
  console.log('[TTS] 开始预加载:', { chapterIndex, paragraphIndex, textLen: paragraph.text.length })

  // Web Speech API 直接播放，不支持预加载音频 Blob
  // 预加载逻辑在 Web Speech API 模式下禁用
  console.log('[TTS] Web Speech API 不支持音频预加载，跳过')
  isPreloading = false
}

/**
 * 清除预加载缓存
 */
function clearPreloadCache(): void {
  preloadedAudio = null
  isPreloading = false
}

// ============ Store 类型定义 ============

interface TTSStoreState extends TTSState {
  // 章节数据
  chapters: TTSChapter[]

  // 可用模型
  availableModels: TTSVoiceModel[]
}

interface TTSStoreActions {
  // 初始化
  init: () => Promise<void>

  // 章节数据
  setChapters: (chapters: TTSChapter[]) => void

  // 播放控制
  startPlayback: (bookId: string, bookTitle: string, authorName: string | null, bookCover: string | null, chapters: TTSChapter[]) => Promise<void>
  play: () => Promise<void>
  pause: () => void
  stop: () => void
  seekToChapter: (chapterIndex: number) => Promise<void>
  seekToParagraph: (chapterIndex: number, paragraphIndex: number) => Promise<void>
  skipForward: (seconds?: number) => void
  skipBackward: (seconds?: number) => void
  nextChapter: () => Promise<void>
  previousChapter: () => Promise<void>

  // 设置
  setSpeed: (speed: number) => void
  setVolume: (volume: number) => void
  setVoice: (voiceId: string) => Promise<void>

  // 睡眠定时
  setSleepTimer: (type: SleepTimerType) => void
  clearSleepTimer: () => void

  // 进度同步
  syncProgress: () => Promise<void>

  // 状态更新
  setPlayState: (state: TTSPlayState) => void
  setError: (error: string | null) => void
  setLoadingProgress: (progress: number) => void

  // 清理
  reset: () => void

  // MediaSession
  setupMediaSession: () => void
}

type TTSStore = TTSStoreState & TTSStoreActions

// ============ 初始状态 ============

const initialState: TTSStoreState = {
  playState: 'idle',
  currentPosition: null,
  currentBookId: null,
  currentBookTitle: null,
  currentAuthorName: null,
  currentBookCover: null,
  currentChapterTitle: null,
  speed: 1.0,
  volume: 1.0,
  voiceId: '', // 留空，系统会自动选择合适的语音
  sleepTimer: 'off',
  sleepTimerEndTime: null,
  isEngineReady: false,
  isModelLoaded: false,
  loadingProgress: 0,
  error: null,
  chapters: [],
  availableModels: [BUNDLED_MODEL],
}

// ============ 睡眠定时器 ============

let sleepTimerTimeout: number | null = null

function clearSleepTimerTimeout(): void {
  if (sleepTimerTimeout !== null) {
    clearTimeout(sleepTimerTimeout)
    sleepTimerTimeout = null
  }
}

// ============ 进度同步定时器 ============

let syncInterval: number | null = null

function startSyncInterval(syncFn: () => Promise<void>): void {
  stopSyncInterval()
  syncInterval = window.setInterval(syncFn, SYNC_INTERVAL_MS)
}

function stopSyncInterval(): void {
  if (syncInterval !== null) {
    clearInterval(syncInterval)
    syncInterval = null
  }
}

// ============ Zustand Store ============

export const useTTSStore = create<TTSStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      // ============ 初始化 ============
      init: async () => {
        const state = get()
        if (state.isEngineReady) return

        try {
          set({ loadingProgress: 10 })

          await edgeTts.init()
          set({ loadingProgress: 100 })

          set({
            isEngineReady: true,
            isModelLoaded: true,
            loadingProgress: 100,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          set({ error: message, playState: 'error' })
        }
      },

      // ============ 章节数据 ============
      setChapters: (chapters) => {
        set({ chapters })
      },

      // ============ 播放控制 ============
      startPlayback: async (bookId, bookTitle, authorName, bookCover, chapters) => {
        const state = get()

        // 初始化引擎
        if (!state.isEngineReady) {
          await get().init()
        }

        // 尝试加载已保存的进度
        let startChapterIndex = 0
        let startParagraphIndex = 0

        if (powerSyncDb) {
          try {
            const savedProgress = await loadTTSProgress(powerSyncDb, bookId)
            if (savedProgress) {
              startChapterIndex = savedProgress.chapterIndex
              // 从保存的章节的第一段开始（因为我们只保存章节级别进度）
              startParagraphIndex = 0
              console.log('[TTS] 恢复进度:', { chapterIndex: startChapterIndex })
            }
          } catch (error) {
            console.warn('[TTS] 加载进度失败:', error)
          }
        }

        // 设置书籍信息
        set({
          currentBookId: bookId,
          currentBookTitle: bookTitle,
          currentAuthorName: authorName,
          currentBookCover: bookCover,
          chapters,
          currentPosition: {
            bookId,
            chapterIndex: startChapterIndex,
            paragraphIndex: startParagraphIndex,
            sentenceIndex: 0,
            offsetMs: 0,
          },
          currentChapterTitle: chapters[startChapterIndex]?.title || '第 1 章',
          playState: 'loading',
        })

        // 开始播放
        await get().play()

        // 启动进度同步
        startSyncInterval(() => get().syncProgress())

        // 设置 MediaSession
        get().setupMediaSession()
      },

      play: async () => {
        const state = get()
        if (!state.currentPosition || state.chapters.length === 0) return

        const { chapterIndex, paragraphIndex } = state.currentPosition
        const chapter = state.chapters[chapterIndex]
        if (!chapter) return

        const paragraph = chapter.paragraphs[paragraphIndex]
        if (!paragraph) {
          // 当前章节已播放完，尝试下一章
          await get().nextChapter()
          return
        }

        set({ playState: 'loading' })

        try {
          let arrayBuffer: ArrayBuffer
          let sampleRate: number

          // 检查是否有预加载的音频
          if (
            preloadedAudio &&
            preloadedAudio.chapterIndex === chapterIndex &&
            preloadedAudio.paragraphIndex === paragraphIndex
          ) {
            // 使用预加载的音频
            console.log('[TTS] 使用预加载的音频:', { chapterIndex, paragraphIndex })
            arrayBuffer = preloadedAudio.arrayBuffer
            sampleRate = preloadedAudio.sampleRate
            preloadedAudio = null
          } else {
            // 需要现场合成
            console.log('[TTS] 实时合成:', { chapterIndex, paragraphIndex, textLen: paragraph.text.length })
            // Web Speech API 直接播放，无需合成音频 Blob
            // 使用 TTSController 的 WebSpeechSynthesizer
            console.log('[TTS] 跳过预加载合成，使用 TTSController 直接播放')
            return
          }

          // 加载到播放器
          const player = getAudioPlayer()
          await player.load(arrayBuffer, sampleRate)

          // 计算并预加载下一段
          const nextParagraphIndex = paragraphIndex + 1
          const hasNextParagraph = chapter.paragraphs && nextParagraphIndex < chapter.paragraphs.length
          const nextChapterIndex = chapterIndex + 1
          const hasNextChapter = state.chapters && nextChapterIndex < state.chapters.length

          // 在后台预加载下一段音频
          if (!isPreloading) {
            if (hasNextParagraph) {
              // 预加载当前章节的下一段
              preloadNextParagraph(chapterIndex, nextParagraphIndex, state.speed, state.chapters)
            } else if (hasNextChapter && state.chapters[nextChapterIndex]?.paragraphs?.length > 0) {
              // 预加载下一章的第一段
              preloadNextParagraph(nextChapterIndex, 0, state.speed, state.chapters)
            }
          }

          // 设置播放器事件
          player.setEvents({
            onStateChange: (playerState) => {
              if (playerState === 'playing') {
                set({ playState: 'playing' })
              } else if (playerState === 'paused') {
                set({ playState: 'paused' })
              }
            },
            onEnded: async () => {
              // 检查睡眠定时器 - 本章结束模式
              const currentState = get()
              if (currentState.sleepTimer === 'end_of_chapter') {
                const pos = currentState.currentPosition
                if (pos) {
                  const currentChapter = currentState.chapters[pos.chapterIndex]
                  const nextParaIndex = pos.paragraphIndex + 1
                  // 如果是本章最后一段，暂停播放
                  if (!currentChapter || nextParaIndex >= currentChapter.paragraphs.length) {
                    get().pause()
                    set({ sleepTimer: 'off', sleepTimerEndTime: null })
                    return
                  }
                }
              }

              // 播放下一段落
              const pos = get().currentPosition
              if (!pos) return

              const nextParagraphIdx = pos.paragraphIndex + 1
              const currentChapter = get().chapters[pos.chapterIndex]

              if (currentChapter && nextParagraphIdx < currentChapter.paragraphs.length) {
                // 下一段落
                set({
                  currentPosition: {
                    ...pos,
                    paragraphIndex: nextParagraphIdx,
                    offsetMs: 0,
                  },
                })
                await get().play()
              } else {
                // 下一章节
                await get().nextChapter()
              }
            },
            onError: (error) => {
              set({ error: error.message, playState: 'error' })
            },
          })

          // 设置音量
          player.setVolume(state.volume)

          // 开始播放
          await player.play()

          set({
            playState: 'playing',
            currentChapterTitle: chapter.title,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          set({ error: message, playState: 'error' })
        }
      },

      pause: () => {
        const player = getAudioPlayer()
        player.pause()
        set({ playState: 'paused' })
      },

      stop: () => {
        const player = getAudioPlayer()
        player.stop()
        stopSyncInterval()
        clearSleepTimerTimeout()
        clearPreloadCache() // 清除预加载缓存
        set({
          playState: 'idle',
          currentPosition: null,
          currentBookId: null,
          currentBookTitle: null,
          currentChapterTitle: null,
          chapters: [],
        })

        // 清除 MediaSession
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'none'
        }
      },

      seekToChapter: async (chapterIndex) => {
        const state = get()
        if (!state.currentBookId || chapterIndex >= state.chapters.length) return

        set({
          currentPosition: {
            bookId: state.currentBookId,
            chapterIndex,
            paragraphIndex: 0,
            sentenceIndex: 0,
            offsetMs: 0,
          },
          currentChapterTitle: state.chapters[chapterIndex]?.title,
        })

        if (state.playState === 'playing') {
          await get().play()
        }
      },

      seekToParagraph: async (chapterIndex, paragraphIndex) => {
        const state = get()
        if (!state.currentBookId) return

        set({
          currentPosition: {
            bookId: state.currentBookId,
            chapterIndex,
            paragraphIndex,
            sentenceIndex: 0,
            offsetMs: 0,
          },
        })

        if (state.playState === 'playing') {
          await get().play()
        }
      },

      skipForward: (seconds = 30) => {
        const player = getAudioPlayer()
        const current = player.getCurrentTime()
        const duration = player.getDuration()
        player.seek(Math.min(current + seconds, duration))
      },

      skipBackward: (seconds = 15) => {
        const player = getAudioPlayer()
        const current = player.getCurrentTime()
        player.seek(Math.max(current - seconds, 0))
      },

      nextChapter: async () => {
        const state = get()
        if (!state.currentPosition) return

        const nextIndex = state.currentPosition.chapterIndex + 1
        if (nextIndex < state.chapters.length) {
          await get().seekToChapter(nextIndex)
          if (state.playState === 'playing') {
            await get().play()
          }
        } else {
          // 已是最后一章
          get().stop()
        }
      },

      previousChapter: async () => {
        const state = get()
        if (!state.currentPosition) return

        const prevIndex = Math.max(0, state.currentPosition.chapterIndex - 1)
        await get().seekToChapter(prevIndex)
        if (state.playState === 'playing') {
          await get().play()
        }
      },

      // ============ 设置 ============
      setSpeed: (speed) => {
        const newSpeed = Math.max(0.5, Math.min(2.0, speed))
        set({ speed: newSpeed })

        // 实时更新 Edge TTS 服务的语速
        edgeTts.setRate(newSpeed)

        // 同时更新 ttsController 的语速（如果已初始化）
        const controller = getTTSController()
        if (controller.isReady()) {
          controller.setRate(newSpeed)
        }
      },

      setVolume: (volume) => {
        const v = Math.max(0, Math.min(1, volume))
        set({ volume: v })
        getAudioPlayer().setVolume(v)

        // 同时更新 ttsController 的音量（如果已初始化）
        const controller = getTTSController()
        if (controller.isReady()) {
          controller.setVolume(v)
        }
      },

      setVoice: async (voiceId) => {
        set({ voiceId })
        // 同步设置 nativeTts 服务的语音
        edgeTts.setVoice(voiceId)
        // 同步设置 TTSController 的合成器
        const controller = getTTSController()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const synth = (controller as any).synthesizer as { setVoice?: (v: string) => void }
        if (synth?.setVoice) {
          synth.setVoice(voiceId)
        }
        console.log('[TTS Store] 语音已设置:', voiceId)
      },

      // ============ 睡眠定时 ============
      setSleepTimer: (type) => {
        clearSleepTimerTimeout()

        if (type === 'off') {
          set({ sleepTimer: 'off', sleepTimerEndTime: null })
          return
        }

        let durationMs: number | null = null
        switch (type) {
          case '15min':
            durationMs = 15 * 60 * 1000
            break
          case '30min':
            durationMs = 30 * 60 * 1000
            break
          case '1hour':
            durationMs = 60 * 60 * 1000
            break
          case 'end_of_chapter':
            // 章节结束时停止，由 onEnded 处理
            set({ sleepTimer: 'end_of_chapter', sleepTimerEndTime: null })
            return
        }

        if (durationMs) {
          const endTime = Date.now() + durationMs
          set({ sleepTimer: type, sleepTimerEndTime: endTime })

          sleepTimerTimeout = window.setTimeout(() => {
            get().pause()
            set({ sleepTimer: 'off', sleepTimerEndTime: null })
          }, durationMs)
        }
      },

      clearSleepTimer: () => {
        clearSleepTimerTimeout()
        set({ sleepTimer: 'off', sleepTimerEndTime: null })
      },

      // ============ 进度同步 ============
      syncProgress: async () => {
        const state = get()
        if (!state.currentPosition || !state.currentBookId) return

        // 使用 PowerSync 同步进度到数据库
        if (powerSyncDb) {
          try {
            const player = getAudioPlayer()
            const currentTimeMs = Math.floor(player.getCurrentTime() * 1000)

            await syncTTSProgress(powerSyncDb, {
              bookId: state.currentBookId,
              chapterIndex: state.currentPosition.chapterIndex,
              positionMs: currentTimeMs,
            })
          } catch (error) {
            console.warn('[TTS] 进度同步失败:', error)
          }
        } else {
          console.log('[TTS] 进度同步 (本地):', state.currentPosition)
        }
      },

      // ============ 状态更新 ============
      setPlayState: (playState) => set({ playState }),
      setError: (error) => set({ error }),
      setLoadingProgress: (loadingProgress) => set({ loadingProgress }),

      // ============ 清理 ============
      reset: () => {
        get().stop()
        edgeTts.dispose()
        set(initialState)
      },

      // ============ MediaSession ============
      setupMediaSession: () => {
        if (!('mediaSession' in navigator)) return

        const state = get()

        navigator.mediaSession.metadata = new MediaMetadata({
          title: state.currentChapterTitle || '听书',
          artist: state.currentBookTitle || '雅典娜',
          album: state.currentBookTitle || '',
        })

        navigator.mediaSession.setActionHandler('play', () => {
          get().play()
        })

        navigator.mediaSession.setActionHandler('pause', () => {
          get().pause()
        })

        navigator.mediaSession.setActionHandler('previoustrack', () => {
          get().previousChapter()
        })

        navigator.mediaSession.setActionHandler('nexttrack', () => {
          get().nextChapter()
        })

        navigator.mediaSession.setActionHandler('seekbackward', () => {
          get().skipBackward(15)
        })

        navigator.mediaSession.setActionHandler('seekforward', () => {
          get().skipForward(30)
        })
      },
    }),
    {
      name: 'athena-tts',
      storage: createJSONStorage(() => localStorage),
      // 只持久化设置，不持久化播放状态
      partialize: (state) => ({
        speed: state.speed,
        volume: state.volume,
        voiceId: state.voiceId,
      }),
    }
  )
)

// 导出 Hook
export const useTTSPlayState = () => useTTSStore((s) => s.playState)
export const useTTSIsPlaying = () => useTTSStore((s) => s.playState === 'playing')
export const useTTSIsLoading = () => useTTSStore((s) => s.playState === 'loading')
export const useTTSCurrentBook = () => useTTSStore((s) => ({
  bookId: s.currentBookId,
  bookTitle: s.currentBookTitle,
  authorName: s.currentAuthorName,
  bookCover: s.currentBookCover,
  chapterTitle: s.currentChapterTitle,
  chapterIndex: s.currentPosition?.chapterIndex ?? 0,
  totalChapters: s.chapters.length,
}))
export const useTTSSettings = () => useTTSStore((s) => ({
  speed: s.speed,
  volume: s.volume,
  voiceId: s.voiceId,
}))
export const useTTSSleepTimer = () => useTTSStore((s) => ({
  sleepTimer: s.sleepTimer,
  sleepTimerEndTime: s.sleepTimerEndTime,
}))
export const useTTSChapters = () => useTTSStore((s) => s.chapters)
export const useTTSCurrentChapter = () => useTTSStore((s) => {
  const pos = s.currentPosition
  if (!pos) return null
  return s.chapters[pos.chapterIndex] || null
})
export const useTTSAvailableModels = () => useTTSStore((s) => s.availableModels)


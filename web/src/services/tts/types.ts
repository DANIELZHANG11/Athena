/**
 * TTS 类型定义
 *
 * @description 定义TTS功能的所有TypeScript类型
 * @see 对话记录.md - 2.11 TTS 听书功能实施计划 (kokoro-js Client-Side)
 * @ai-generated Claude Opus 4.5 (2026-01-21)
 */

// ============ TTS 状态类型 ============

/** TTS播放状态 */
export type TTSPlayState = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

/** 睡眠定时器类型 */
export type SleepTimerType = 'off' | '15min' | '30min' | '1hour' | 'end_of_chapter'

/** 当前播放位置 */
export interface TTSPosition {
  bookId: string
  chapterIndex: number
  paragraphIndex: number
  sentenceIndex: number
  offsetMs: number
}

/** TTS全局状态 */
export interface TTSState {
  // 播放状态
  playState: TTSPlayState
  currentPosition: TTSPosition | null

  // 当前书籍信息
  currentBookId: string | null
  currentBookTitle: string | null
  currentAuthorName: string | null
  currentBookCover: string | null
  currentChapterTitle: string | null

  // 设置
  speed: number // 0.5 - 2.0
  volume: number // 0 - 1
  voiceId: string // 当前音色ID

  // 睡眠定时
  sleepTimer: SleepTimerType
  sleepTimerEndTime: number | null // Unix timestamp

  // 引擎状态
  isEngineReady: boolean
  isModelLoaded: boolean
  loadingProgress: number // 0 - 100

  // 错误
  error: string | null
}

// ============ TTS 模型类型 ============

/** TTS语音模型信息 */
export interface TTSVoiceModel {
  id: string
  language: string // 'zh' | 'en' | 'ja'
  displayName: string
  speakerCount: number
  sampleRate: number
  fileSize: number // bytes
  isBundled: boolean // 是否内置
  isDownloaded: boolean
  downloadProgress?: number
  filePath?: string // OPFS 路径
  version?: string
}

/** 内置模型配置 - Piper VITS 中文女声 */
export const BUNDLED_MODEL: TTSVoiceModel = {
  id: 'vits-piper-zh-huayan',
  language: 'zh',
  displayName: '中文女声 (华妍)',
  speakerCount: 1,
  sampleRate: 22050, // Piper 模型标准采样率
  fileSize: 77 * 1024 * 1024, // ~77MB (嵌入在 WASM .data 中)
  isBundled: true,
  isDownloaded: true,
}

// ============ TTS 章节类型 ============

/** 章节信息 */
export interface TTSChapter {
  index: number
  title: string
  href?: string // EPUB href
  pageStart?: number // PDF 起始页
  pageEnd?: number // PDF 结束页
  paragraphs: TTSParagraph[]
}

/** 段落信息 */
export interface TTSParagraph {
  index: number
  text: string
  sentences: string[]
}

// ============ TTS 设置类型 (本地存储) ============

/** 本地TTS设置 */
export interface LocalTTSSettings {
  voiceId: string
  speed: number
  volume: number
  autoScroll: boolean
  sleepTimerDefault: SleepTimerType
  updatedAt: string
}

/** 本地TTS模型记录 */
export interface LocalTTSModelRecord {
  modelId: string
  language: string
  displayName: string
  filePath: string
  fileSize: number
  isBundled: boolean
  downloadedAt: string | null
  version: string
}

// ============ TTS 进度同步类型 (PowerSync) ============

/** TTS播放进度 (需同步到服务端) */
export interface TTSProgressSync {
  bookId: string
  chapterIdx: number
  paragraphIdx: number
  offsetMs: number
  voiceId: string
  speed: number
  lastSyncedAt: string
}

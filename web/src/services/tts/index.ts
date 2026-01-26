/**
 * TTS 服务模块导出
 *
 * @description 统一导出TTS相关的所有服务和类型
 * 
 * 迁移说明 (2026-01-24):
 * - 使用浏览器原生 Web Speech API
 * - 完全离线，使用系统内置语音
 * - 无需网络连接
 * 
 * @ai-generated Claude Opus 4 (2026-01-24)
 */

// 类型定义
export type {
  TTSPlayState,
  SleepTimerType,
  TTSPosition,
  TTSState,
  TTSVoiceModel,
  TTSChapter,
  TTSParagraph,
  LocalTTSSettings,
  LocalTTSModelRecord,
  TTSProgressSync,
} from './types'

export { BUNDLED_MODEL } from './types'

// 原生 TTS 服务 (基于 Web Speech API)
export {
  nativeTts,
  nativeTts as edgeTts, // 向后兼容
  default as nativeTtsDefault,
} from './nativeTtsService'
export type {
  NativeTTSSpeakOptions,
  NativeVoiceInfo,
} from './nativeTtsService'

// 向后兼容别名
export { nativeTts as kokoroTts } from './nativeTtsService'

// 音频播放器
export { AudioPlayer, getAudioPlayer } from './audioPlayer'
export type { AudioPlayerState, AudioPlayerEvents } from './audioPlayer'

// 文本处理器
export {
  normalizeText,
  splitIntoSentences,
  splitIntoParagraphs,
  extractTextFromHtml,
  buildVirtualChapters,
  estimateDuration,
  formatDuration,
} from './textProcessor'
export type { TextNormalizerOptions } from './textProcessor'

// 进度同步
export {
  syncTTSProgress,
  loadTTSProgress,
  clearTTSProgress,
  startTTSSession,
  endTTSSession,
  heartbeatTTSSession,
  getTTSHeartbeatInterval,
  hasTTSSession,
} from './progressSync'
export type { TTSProgressData } from './progressSync'

// foliate-js TTS 桥接
export { TTSBridge, ttsBridge, parseSSML } from './epubExtractor'
export type { FoliateViewElement, FoliateTTS, SSMLParseResult } from './epubExtractor'

// TTS 控制器（整合 foliate-js + Web Speech API）
export {
  TTSController,
  WebSpeechSynthesizer,
  getTTSController,
  destroyTTSController,
} from './ttsController'
export type {
  SpeechSynthesizer,
  SpeakOptions,
  TTSControllerState,
  TTSControllerEvents,
  TTSControllerConfig,
} from './ttsController'

// 向后兼容别名
export { WebSpeechSynthesizer as KokoroSynthesizer } from './ttsController'
export { WebSpeechSynthesizer as SherpaOnnxSynthesizer } from './ttsController'
export { WebSpeechSynthesizer as EdgeSynthesizer } from './ttsController'

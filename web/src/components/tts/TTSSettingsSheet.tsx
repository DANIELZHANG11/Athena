/**
 * TTS 设置面板组件
 * 
 * @description 提供语速、音色选择、睡眠定时器的快速调节界面
 * - 语音按语言分类显示，每排两列
 * - 选中状态有明显视觉反馈（边框高亮、图标、背景色）
 * @see 对话记录.md - 2.11 TTS 听书功能实施计划 (Web Speech API)
 * @see 雅典娜开发技术文档汇总/06 - UIUX设计系统 - Liquid Glass 效果规范
 * @ai-generated Claude Opus 4.5 (2026-01-24)
 */

import { memo, useCallback, useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useTTSStore,
  useTTSSettings,
  useTTSSleepTimer,
} from '@/stores/tts'
import type { SleepTimerType } from '@/services/tts/types'
import { X, Check, Clock, Zap, Mic, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TTSSettingsSheetProps {
  /** 关闭设置面板回调 */
  onClose: () => void
}

/**
 * 系统语音信息
 */
interface SystemVoice {
  voiceURI: string
  name: string
  lang: string
  localService: boolean
}

/**
 * 按语言分组的语音
 */
interface VoiceGroup {
  langCode: string
  displayName: string
  voices: SystemVoice[]
  priority: number // 排序优先级，数字越小越靠前
}

/**
 * 获取语言分组的显示名称和优先级
 * 注意：不使用 Emoji 图标，遵循 UIUX 设计规范
 */
function getLanguageInfo(lang: string): { displayName: string; groupKey: string; priority: number } {
  const langLower = lang.toLowerCase()
  
  // 中文优先级最高
  if (langLower.startsWith('zh-cn') || langLower.startsWith('zh-hans')) {
    return { displayName: '中文（简体）', groupKey: 'zh-CN', priority: 1 }
  }
  if (langLower.startsWith('zh-tw') || langLower.startsWith('zh-hant') || langLower.startsWith('zh-hk')) {
    return { displayName: '中文（繁體）', groupKey: 'zh-TW', priority: 2 }
  }
  if (langLower.startsWith('zh')) {
    return { displayName: '中文', groupKey: 'zh', priority: 3 }
  }
  
  // 英文次之
  if (langLower.startsWith('en-us')) {
    return { displayName: 'English (US)', groupKey: 'en-US', priority: 10 }
  }
  if (langLower.startsWith('en-gb')) {
    return { displayName: 'English (UK)', groupKey: 'en-GB', priority: 11 }
  }
  if (langLower.startsWith('en-au')) {
    return { displayName: 'English (AU)', groupKey: 'en-AU', priority: 12 }
  }
  if (langLower.startsWith('en')) {
    return { displayName: 'English', groupKey: 'en', priority: 15 }
  }
  
  // 日语
  if (langLower.startsWith('ja')) {
    return { displayName: '日本語', groupKey: 'ja', priority: 20 }
  }
  
  // 韩语
  if (langLower.startsWith('ko')) {
    return { displayName: '한국어', groupKey: 'ko', priority: 21 }
  }
  
  // 法语
  if (langLower.startsWith('fr')) {
    return { displayName: 'Français', groupKey: 'fr', priority: 30 }
  }
  
  // 德语
  if (langLower.startsWith('de')) {
    return { displayName: 'Deutsch', groupKey: 'de', priority: 31 }
  }
  
  // 西班牙语
  if (langLower.startsWith('es')) {
    return { displayName: 'Español', groupKey: 'es', priority: 32 }
  }
  
  // 葡萄牙语
  if (langLower.startsWith('pt')) {
    return { displayName: 'Português', groupKey: 'pt', priority: 33 }
  }
  
  // 俄语
  if (langLower.startsWith('ru')) {
    return { displayName: 'Русский', groupKey: 'ru', priority: 34 }
  }
  
  // 意大利语
  if (langLower.startsWith('it')) {
    return { displayName: 'Italiano', groupKey: 'it', priority: 35 }
  }
  
  // 其他语言 - 使用语言代码本身
  return { displayName: lang, groupKey: lang, priority: 100 }
}

/**
 * TTS 设置面板 (Bottom Sheet)
 * 
 * 功能特性：
 * - 🎚️ 语速调节：0.5x ~ 2.0x，步进 0.1
 * - 🎤 音色选择：按语言分类，每排两列，明显选中状态
 * - ⏰ 睡眠定时器：15分钟、30分钟、1小时、本章结束
 * - 🎨 设计风格：Bottom Sheet，参考 Apple CarPlay
 */
function TTSSettingsSheetComponent({ onClose }: TTSSettingsSheetProps) {
  const { t } = useTranslation('common')

  // 系统语音列表
  const [voices, setVoices] = useState<SystemVoice[]>([])
  const [isLoadingVoices, setIsLoadingVoices] = useState(true)
  
  // 展开/折叠的语言分组
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['zh-CN', 'zh-TW', 'zh', 'en-US']))

  // Store hooks
  const { speed, voiceId } = useTTSSettings()
  const { sleepTimer } = useTTSSleepTimer()

  // Actions
  const setSpeed = useTTSStore((s) => s.setSpeed)
  const setSleepTimer = useTTSStore((s) => s.setSleepTimer)
  const setVoice = useTTSStore((s) => s.setVoice)

  // 加载系统语音列表
  useEffect(() => {
    const loadVoices = () => {
      if (!('speechSynthesis' in window)) {
        setIsLoadingVoices(false)
        return
      }

      const synth = window.speechSynthesis
      const updateVoices = () => {
        const systemVoices = synth.getVoices()
        setVoices(systemVoices.map(v => ({
          voiceURI: v.voiceURI,
          name: v.name,
          lang: v.lang,
          localService: v.localService
        })))
        setIsLoadingVoices(false)
      }

      // 有些浏览器需要等待 voiceschanged 事件
      const existingVoices = synth.getVoices()
      if (existingVoices.length > 0) {
        updateVoices()
      } else {
        synth.addEventListener('voiceschanged', updateVoices, { once: true })
        // 超时保护
        setTimeout(() => {
          if (voices.length === 0) {
            updateVoices()
          }
        }, 2000)
      }
    }

    loadVoices()
  }, [voices.length])

  // 按语言分组语音
  const voiceGroups = useMemo<VoiceGroup[]>(() => {
    const groupMap = new Map<string, VoiceGroup>()
    
    for (const voice of voices) {
      const { displayName, groupKey, priority } = getLanguageInfo(voice.lang)
      
      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          langCode: groupKey,
          displayName,
          voices: [],
          priority,
        })
      }
      groupMap.get(groupKey)!.voices.push(voice)
    }
    
    // 按优先级排序
    return Array.from(groupMap.values()).sort((a, b) => a.priority - b.priority)
  }, [voices])
  
  // 获取当前选中语音的名称（用于顶部展示）
  const selectedVoiceName = useMemo(() => {
    const voice = voices.find(v => v.voiceURI === voiceId)
    return voice?.name || t('tts.no_voice_selected')
  }, [voices, voiceId, t])

  // 处理音色选择
  const handleVoiceSelect = useCallback((voice: SystemVoice) => {
    setVoice(voice.voiceURI)
  }, [setVoice])
  
  // 切换语言分组展开状态
  const toggleGroupExpand = useCallback((groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) {
        next.delete(groupKey)
      } else {
        next.add(groupKey)
      }
      return next
    })
  }, [])

  // 语速预设
  const speedPresets = [
    { value: 0.5, label: '0.5x' },
    { value: 0.75, label: '0.75x' },
    { value: 1.0, label: '1.0x' },
    { value: 1.25, label: '1.25x' },
    { value: 1.5, label: '1.5x' },
    { value: 1.75, label: '1.75x' },
    { value: 2.0, label: '2.0x' },
  ]

  // 睡眠定时器选项
  const sleepTimerOptions: { value: SleepTimerType; label: string }[] = [
    { value: 'off', label: t('tts.sleep_off') },
    { value: '15min', label: t('tts.sleep_15min') },
    { value: '30min', label: t('tts.sleep_30min') },
    { value: '1hour', label: t('tts.sleep_1hour') },
    { value: 'end_of_chapter', label: t('tts.sleep_end_of_chapter') },
  ]

  // 处理语速变化
  const handleSpeedChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newSpeed = parseFloat(e.target.value)
    setSpeed(newSpeed)
  }, [setSpeed])

  // 处理语速预设点击
  const handleSpeedPreset = useCallback((value: number) => {
    setSpeed(value)
  }, [setSpeed])

  // 处理睡眠定时器设置
  const handleSleepTimer = useCallback((value: SleepTimerType) => {
    setSleepTimer(value)
  }, [setSleepTimer])

  return (
    <div
      className="fixed inset-0 z-10000 flex items-end justify-center"
      onClick={onClose}
    >
      {/* 遮罩层 */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-in fade-in-0 duration-300" />

      {/* 设置面板 - 使用不透明背景确保在任何播放器背景下可读 */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'relative w-full max-w-lg',
          // 使用不透明白色/深色背景，确保文字可读
          'bg-white dark:bg-gray-900',
          'rounded-t-3xl shadow-2xl',
          'border-t border-gray-200 dark:border-gray-700',
          // 限制最大高度为视口的 80%，确保小屏幕可以关闭
          'max-h-[80vh] flex flex-col',
          'animate-in slide-in-from-bottom-4 duration-300'
        )}
      >
        {/* 拖动指示条 - 便于用户识别可以下拉关闭 */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
        </div>
        
        {/* 顶部标题栏 - 固定在顶部 */}
        <div className="flex items-center justify-between px-6 pb-4 flex-shrink-0">
          <h3 className="text-lg font-semibold text-label">{t('tts.settings')}</h3>
          <button
            onClick={onClose}
            title={t('common.close')}
            className={cn(
              'p-2 rounded-full',
              'border border-gray-300 dark:border-gray-600',
              'hover:bg-secondary-background',
              'transition-colors duration-200'
            )}
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5 text-secondary-label" />
          </button>
        </div>
        
        {/* 可滚动内容区域 */}
        <div className="flex-1 overflow-y-auto px-6 pb-safe">

        {/* 语速调节 */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-system-orange" />
            <label className="text-sm font-medium text-label">
              {t('tts.speed')}
            </label>
            <span className="ml-auto text-sm text-secondary-label">
              {speed.toFixed(2)}x
            </span>
          </div>

          {/* 滑块 */}
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={speed}
            onChange={handleSpeedChange}
            aria-label={t('tts.speed')}
            className={cn(
              'w-full h-2 rounded-full appearance-none',
              'bg-secondary-background',
              'cursor-pointer',
              '[&::-webkit-slider-thumb]:appearance-none',
              '[&::-webkit-slider-thumb]:w-5',
              '[&::-webkit-slider-thumb]:h-5',
              '[&::-webkit-slider-thumb]:rounded-full',
              '[&::-webkit-slider-thumb]:bg-system-blue',
              '[&::-webkit-slider-thumb]:shadow-lg',
              '[&::-webkit-slider-thumb]:transition-transform',
              '[&::-webkit-slider-thumb]:hover:scale-110'
            )}
          />

          {/* 预设按钮 - Apple HIG: 按钮需要明显的边框和选中状态 */}
          <div className="flex items-center gap-2 mt-3">
            {speedPresets.map((preset) => (
              <button
                key={preset.value}
                onClick={() => handleSpeedPreset(preset.value)}
                className={cn(
                  'flex-1 px-3 py-2 rounded-full',
                  'text-xs font-medium',
                  'transition-all duration-200',
                  // Apple HIG: 所有按钮必须有可见边框
                  'border',
                  speed === preset.value
                    ? 'bg-system-blue text-white border-system-blue shadow-sm'
                    : 'bg-white dark:bg-gray-800 text-label border-gray-300 dark:border-gray-600 hover:border-system-blue hover:bg-system-blue/5'
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* 音色选择 */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Mic className="w-4 h-4 text-system-purple" />
            <label className="text-sm font-medium text-label">
              {t('tts.voice')}
            </label>
            <span className="ml-auto text-xs text-secondary-label">
              {voices.length} {t('tts.voices_available')}
            </span>
          </div>
          
          {/* 当前选中的语音 - 醒目显示 */}
          {voiceId && (
            <div className="mb-3 p-3 rounded-xl bg-system-purple/10 border-2 border-system-purple/30">
              <div className="flex items-center gap-2">
                <Check className="w-5 h-5 text-system-purple flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-system-purple truncate">
                    {selectedVoiceName}
                  </div>
                  <div className="text-xs text-system-purple/70">
                    {t('tts.current_voice')}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 语音列表 - 按语言分组 */}
          {isLoadingVoices ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-system-purple border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 text-sm text-secondary-label">
                {t('tts.loading_voices')}
              </span>
            </div>
          ) : voices.length === 0 ? (
            <div className="flex items-center gap-2 p-4 rounded-xl bg-system-orange/10 border border-system-orange/20">
              <AlertCircle className="w-5 h-5 text-system-orange flex-shrink-0" />
              <p className="text-sm text-system-orange">
                {t('tts.no_voices')}
              </p>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700">
              {voiceGroups.map((group) => {
                const isExpanded = expandedGroups.has(group.langCode)
                const hasSelectedVoice = group.voices.some(v => v.voiceURI === voiceId)
                
                return (
                  <div key={group.langCode} className="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                    {/* 语言分组标题 - 可点击展开/折叠 */}
                    <button
                      onClick={() => toggleGroupExpand(group.langCode)}
                      className={cn(
                        'flex items-center justify-between w-full px-4 py-3',
                        'hover:bg-secondary-background transition-colors',
                        hasSelectedVoice && 'bg-system-purple/5'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-label">
                          {group.displayName}
                        </span>
                        <span className="text-xs text-secondary-label px-1.5 py-0.5 rounded-full bg-secondary-background">
                          {group.voices.length}
                        </span>
                        {hasSelectedVoice && (
                          <span className="text-xs text-system-purple font-medium">
                            ✓ {t('tts.selected')}
                          </span>
                        )}
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-secondary-label" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-secondary-label" />
                      )}
                    </button>
                    
                    {/* 语音网格 - 每排两列 */}
                    {isExpanded && (
                      <div className="grid grid-cols-2 gap-2 p-3 pt-0">
                        {group.voices.map((voice) => {
                          const isSelected = voice.voiceURI === voiceId
                          return (
                            <button
                              key={voice.voiceURI}
                              onClick={() => handleVoiceSelect(voice)}
                              className={cn(
                                'flex items-center gap-2 p-3 rounded-xl',
                                'text-left transition-all duration-200',
                                'border-2',
                                isSelected
                                  ? 'bg-system-purple/15 border-system-purple shadow-sm'
                                  : 'bg-secondary-background/50 border-transparent hover:bg-secondary-background hover:border-gray-300 dark:hover:border-gray-600'
                              )}
                            >
                              {/* 选中图标 */}
                              <div className={cn(
                                'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0',
                                'transition-all duration-200',
                                isSelected
                                  ? 'bg-system-purple'
                                  : 'bg-gray-200 dark:bg-gray-700'
                              )}>
                                {isSelected && <Check className="w-3 h-3 text-white" />}
                              </div>
                              
                              {/* 语音名称 */}
                              <div className="flex-1 min-w-0">
                                <div className={cn(
                                  'text-sm font-medium truncate',
                                  isSelected ? 'text-system-purple' : 'text-label'
                                )}>
                                  {voice.name.replace(/Microsoft |Google |Apple /g, '').replace(/ Online \(Natural\)| \(Natural\)/g, '')}
                                </div>
                                {voice.localService && (
                                  <div className="text-[10px] text-secondary-label">
                                    {t('tts.local_voice')}
                                  </div>
                                )}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 睡眠定时器 */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-system-green" />
            <label className="text-sm font-medium text-label">
              {t('tts.sleep_timer')}
            </label>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {sleepTimerOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => handleSleepTimer(option.value)}
                className={cn(
                  'flex items-center justify-center gap-1.5 p-3 rounded-xl',
                  'text-sm font-medium',
                  'transition-all duration-200',
                  // Apple HIG: 所有按钮必须有可见边框
                  'border',
                  sleepTimer === option.value
                    ? 'bg-system-green/10 text-system-green border-system-green shadow-sm'
                    : 'bg-white dark:bg-gray-800 text-label border-gray-300 dark:border-gray-600 hover:border-system-green hover:bg-system-green/5'
                )}
              >
                {sleepTimer === option.value && (
                  <Check className="w-4 h-4 flex-shrink-0" />
                )}
                <span>{option.label}</span>
              </button>
            ))}
          </div>

          {sleepTimer !== 'off' && (
            <div className="mt-3 p-3 rounded-xl bg-system-green/5 border border-system-green/20">
              <p className="text-xs text-system-green text-center">
                {sleepTimer === 'end_of_chapter'
                  ? t('tts.sleep_end_of_chapter_hint')
                  : t('tts.sleep_timer_hint', {
                    time: sleepTimer.replace('min', ` ${t('tts.minutes')}`).replace('hour', ` ${t('tts.hour')}`)
                  })
                }
              </p>
            </div>
          )}
        </div>
        
        {/* 底部安全区域填充 */}
        <div className="h-6" />
        
        </div>{/* 关闭可滚动内容区域 */}
      </div>
    </div>
  )
}

export const TTSSettingsSheet = memo(TTSSettingsSheetComponent)

export default TTSSettingsSheet

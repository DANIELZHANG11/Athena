/**
 * TTS 全屏播放器覆盖层
 *
 * @description 提供沉浸式听书体验的全屏播放界面
 * 实现 Apple CarPlay 风格的动态模糊背景和按钮交互效果
 * - 封面图片放大并高斯模糊作为背景
 * - 按钮按下时显示白色圆形背景，图标变为黑色
 *
 * @see 对话记录.md - 2.11 TTS 听书功能实施计划 - Phase 4
 * @see 雅典娜开发技术文档汇总/06 - UIUX设计系统 - Liquid Glass 效果规范
 * @ai-generated Claude Opus 4.5 (2026-01-24)
 */

import { memo, useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronDown,
  Settings,
  Loader2,
  Rewind,
  FastForward,
  List,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTTSStore, useTTSPlayState, useTTSCurrentBook, useTTSSettings, useTTSChapters } from '@/stores/tts'
import { getTTSController } from '@/services/tts'
import { extractDominantColor, getLuminance } from '@/lib/color-utils'

interface TTSPlayerOverlayProps {
  /** 关闭播放器回调 */
  onClose: () => void
  /** 打开设置面板回调 */
  onOpenSettings: () => void
  /** 上一段回调（可选，用于章节内导航） */
  onPrev?: () => void
  /** 下一段回调（可选，用于章节内导航） */
  onNext?: () => void
}

/**
 * Apple CarPlay 风格的控制按钮
 * 按下时显示白色背景，图标变为黑色
 */
interface PlayerButtonProps {
  onClick: () => void
  disabled?: boolean
  ariaLabel: string
  size?: 'sm' | 'md' | 'lg'
  children: React.ReactNode
  className?: string
}

function PlayerButton({ onClick, disabled, ariaLabel, size = 'md', children, className }: PlayerButtonProps) {
  const sizeClasses = {
    sm: 'w-10 h-10',
    md: 'w-14 h-14',
    lg: 'w-[72px] h-[72px]',
  }
  
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        'rounded-full flex items-center justify-center',
        'transition-all duration-150',
        sizeClasses[size],
        // 默认状态：透明背景，白色图标
        'bg-transparent text-white',
        // 按下状态：白色背景，黑色图标
        'active:bg-white active:text-gray-900 active:scale-95',
        // 悬停状态
        'hover:bg-white/20',
        // 禁用状态
        'disabled:opacity-40 disabled:pointer-events-none',
        className
      )}
    >
      {children}
    </button>
  )
}

/**
 * 主播放/暂停按钮 - 始终显示白色背景
 */
interface MainPlayButtonProps {
  isPlaying: boolean
  isLoading: boolean
  onClick: () => void
  ariaLabel: string
}

function MainPlayButton({ isPlaying, isLoading, onClick, ariaLabel }: MainPlayButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      aria-label={ariaLabel}
      className={cn(
        'w-[72px] h-[72px] rounded-full',
        'flex items-center justify-center',
        'shadow-xl',
        'transition-all duration-150',
        // 默认状态：白色背景
        'bg-white text-gray-900',
        // 按下状态：稍微缩小，背景变灰
        'active:scale-95 active:bg-gray-200',
        // 悬停状态
        'hover:scale-105',
        // 禁用状态
        'disabled:opacity-60 disabled:pointer-events-none'
      )}
    >
      {isLoading ? (
        <Loader2 className="w-8 h-8 animate-spin" />
      ) : isPlaying ? (
        <Pause className="w-8 h-8 fill-current" />
      ) : (
        <Play className="w-8 h-8 fill-current ml-1" />
      )}
    </button>
  )
}

function TTSPlayerOverlayComponent({
  onClose,
  onOpenSettings,
  onPrev,
  onNext,
}: TTSPlayerOverlayProps) {
  const { t } = useTranslation('common')

  // TTS Store hooks
  const playState = useTTSPlayState()
  const { chapterTitle, bookTitle, authorName, bookCover, chapterIndex, totalChapters } = useTTSCurrentBook()
  const { speed } = useTTSSettings()
  const chapters = useTTSChapters()

  // Actions from store
  const storePause = useTTSStore((s) => s.pause)
  const seekToChapter = useTTSStore((s) => s.seekToChapter)
  const storeStop = useTTSStore((s) => s.stop)

  // 主色调状态
  const [dominantColor, setDominantColor] = useState<string>('rgb(75, 85, 99)')
  const [isLightBackground, setIsLightBackground] = useState(false)
  
  // 章节选择器状态
  const [showChapterPicker, setShowChapterPicker] = useState(false)

  // 从封面提取主色调
  useEffect(() => {
    if (bookCover) {
      extractDominantColor(bookCover)
        .then((color) => {
          setDominantColor(color)
          const luminance = getLuminance(color)
          setIsLightBackground(luminance > 0.5)
        })
        .catch(() => {
          // 保持默认颜色
        })
    }
  }, [bookCover])

  const isLoading = playState === 'loading'
  const isPlaying = playState === 'playing'

  // 处理播放/暂停 - 调用 TTSController
  const handlePlayPause = useCallback(() => {
    const controller = getTTSController()
    if (isPlaying) {
      controller.pause()
      storePause()
    } else {
      controller.resume()
      useTTSStore.getState().setPlayState('playing')
    }
  }, [isPlaying, storePause])

  // 处理上一段 - 先停止当前播放再切换
  const handlePrev = useCallback(async () => {
    // 先停止当前播放，避免语音重叠
    const controller = getTTSController()
    controller.stop()
    
    if (onPrev) {
      onPrev()
    } else {
      await controller.prev()
    }
  }, [onPrev])

  // 处理下一段 - 先停止当前播放再切换
  const handleNext = useCallback(async () => {
    // 先停止当前播放，避免语音重叠
    const controller = getTTSController()
    controller.stop()
    
    if (onNext) {
      onNext()
    } else {
      await controller.next()
    }
  }, [onNext])

  // 处理后退 - 先停止当前播放再切换到上一段
  const handleRewind = useCallback(async () => {
    await handlePrev()
  }, [handlePrev])

  // 处理前进 - 先停止当前播放再切换到下一段
  const handleForward = useCallback(async () => {
    await handleNext()
  }, [handleNext])

  // 处理章节选择
  const handleChapterSelect = useCallback(async (index: number) => {
    const chapter = chapters[index]
    if (!chapter?.href) {
      console.warn('[TTSPlayerOverlay] No href for chapter:', index)
      setShowChapterPicker(false)
      return
    }
    
    // 使用 ttsController 跳转到指定章节
    const controller = getTTSController()
    await controller.goToHref(chapter.href)
    
    // 更新 store 中的当前章节信息
    useTTSStore.setState({
      currentChapterTitle: chapter.title,
      currentPosition: {
        bookId: useTTSStore.getState().currentBookId || '',
        chapterIndex: index,
        paragraphIndex: 0,
        sentenceIndex: 0,
        offsetMs: 0,
      },
    })
    
    setShowChapterPicker(false)
  }, [chapters])

  // 文字颜色 - 根据背景亮度自动切换
  const textColor = isLightBackground ? 'text-gray-900' : 'text-white'
  const secondaryTextColor = isLightBackground ? 'text-gray-600' : 'text-white/70'
  const buttonBgColor = isLightBackground ? 'bg-black/10 hover:bg-black/20' : 'bg-white/10 hover:bg-white/20'

  return (
    <div className="fixed inset-0 z-10000 flex flex-col overflow-hidden">
      {/* 动态模糊背景 - Apple CarPlay 风格 */}
      {bookCover ? (
        <>
          {/* 封面图片放大并模糊作为背景 */}
          <div className="absolute inset-0">
            <img
              src={bookCover}
              alt=""
              className="w-full h-full object-cover scale-150 blur-[80px]"
              aria-hidden="true"
            />
          </div>
          {/* 暗色渐变遮罩层 */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/50 to-black/80" />
        </>
      ) : (
        /* 无封面时的渐变背景 */
        <div 
          className="absolute inset-0"
          style={{ 
            background: `linear-gradient(180deg, ${dominantColor} 0%, rgba(0,0,0,0.95) 100%)`
          }}
        />
      )}

      {/* 内容层 - 使用 flex 居中布局 */}
      <div className="relative flex flex-col h-full safe-area-inset-all">
        {/* 顶部导航栏 */}
        <header className="flex items-center justify-between px-4 py-3 flex-shrink-0">
          {/* 关闭按钮 - Apple CarPlay 风格 */}
          <button
            onClick={onClose}
            className={cn(
              'p-2.5 rounded-full',
              'bg-transparent text-white',
              'active:bg-white active:text-gray-900 active:scale-95',
              'hover:bg-white/20',
              'transition-all duration-150'
            )}
            aria-label={t('common.close')}
          >
            <ChevronDown className="w-6 h-6" />
          </button>

          <span className="text-sm font-medium text-white/70">
            {t('tts.now_playing')}
          </span>

          {/* 设置按钮 - Apple CarPlay 风格 */}
          <button
            onClick={onOpenSettings}
            className={cn(
              'p-2.5 rounded-full',
              'bg-transparent text-white',
              'active:bg-white active:text-gray-900 active:scale-95',
              'hover:bg-white/20',
              'transition-all duration-150'
            )}
            aria-label={t('tts.settings')}
          >
            <Settings className="w-6 h-6" />
          </button>
        </header>

        {/* 主内容区 - 垂直居中 */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 pb-6">
          {/* 封面区域 - 放大封面尺寸 */}
          <div className="relative w-52 h-72 rounded-2xl overflow-hidden shadow-2xl flex-shrink-0 mb-8">
            {bookCover ? (
              <img
                src={bookCover}
                alt={bookTitle || t('tts.unknown_book')}
                className="w-full h-full object-cover bg-black/20"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center">
                <span className={cn('text-5xl font-bold', textColor)}>
                  {(bookTitle || '?').charAt(0)}
                </span>
              </div>
            )}
          </div>

          {/* 书籍信息 */}
          <div className="text-center mb-8 max-w-sm">
            <h2 className={cn('text-2xl font-bold mb-2 line-clamp-2', textColor)}>
              {bookTitle || t('tts.unknown_book')}
            </h2>
            <p className={cn('text-base mb-3', secondaryTextColor)}>
              {authorName || t('tts.unknown_author')}
            </p>
            {/* 章节选择按钮 - 点击展开章节列表 */}
            <button
              onClick={() => setShowChapterPicker(true)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full',
                'text-sm transition-all duration-200',
                buttonBgColor,
                textColor
              )}
            >
              <List className="w-4 h-4" />
              <span className="line-clamp-1">
                {chapterTitle || t('tts.chapter_num', { num: chapterIndex + 1, total: totalChapters || 0 })}
              </span>
            </button>
          </div>

          {/* 进度条 */}
          <div className="w-full max-w-sm mb-8">
            <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all duration-300"
                style={{ width: '0%' }}
              />
            </div>
            <div className={cn('flex justify-between text-xs mt-2', secondaryTextColor)}>
              <span>0:00</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-white/10">
                {speed.toFixed(1)}x
              </span>
              <span>--:--</span>
            </div>
          </div>

          {/* 控制按钮区 - Apple CarPlay 风格 */}
          <div className="flex items-center justify-center gap-3">
            {/* 上一章 */}
            <PlayerButton
              onClick={handlePrev}
              disabled={isLoading}
              ariaLabel={t('tts.previous_chapter')}
              size="sm"
            >
              <SkipBack className="w-5 h-5" />
            </PlayerButton>

            {/* 后退（上一段）*/}
            <PlayerButton
              onClick={handleRewind}
              disabled={isLoading}
              ariaLabel={t('tts.rewind')}
              size="md"
            >
              <Rewind className="w-6 h-6" />
            </PlayerButton>

            {/* 播放/暂停 - 主按钮 */}
            <MainPlayButton
              isPlaying={isPlaying}
              isLoading={isLoading}
              onClick={handlePlayPause}
              ariaLabel={isPlaying ? t('tts.pause') : t('tts.play')}
            />

            {/* 前进（下一段）*/}
            <PlayerButton
              onClick={handleForward}
              disabled={isLoading}
              ariaLabel={t('tts.forward')}
              size="md"
            >
              <FastForward className="w-6 h-6" />
            </PlayerButton>

            {/* 下一章 */}
            <PlayerButton
              onClick={handleNext}
              disabled={isLoading}
              ariaLabel={t('tts.next_chapter')}
              size="sm"
            >
              <SkipForward className="w-5 h-5" />
            </PlayerButton>
          </div>
        </div>
      </div>

      {/* 章节选择器模态框 */}
      {showChapterPicker && (
        <div 
          className="fixed inset-0 z-[10001] flex items-end justify-center"
          onClick={() => setShowChapterPicker(false)}
        >
          {/* 遮罩层 */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in-0 duration-300" />
          
          {/* 章节列表面板 */}
          <div
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'relative w-full max-w-lg max-h-[70vh]',
              'bg-white dark:bg-gray-900',
              'rounded-t-3xl shadow-2xl',
              'border-t border-gray-200 dark:border-gray-700',
              'flex flex-col',
              'animate-in slide-in-from-bottom-4 duration-300'
            )}
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('tts.select_chapter')}
              </h3>
              <button
                onClick={() => setShowChapterPicker(false)}
                className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label={t('common.close')}
              >
                <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              </button>
            </div>

            {/* 章节列表 */}
            <div className="flex-1 overflow-y-auto overscroll-contain pb-safe">
              {chapters.length === 0 ? (
                <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                  {t('tts.no_chapters')}
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {chapters.map((chapter, index) => (
                    <li key={index}>
                      <button
                        onClick={() => handleChapterSelect(index)}
                        className={cn(
                          'w-full px-6 py-4 text-left',
                          'hover:bg-gray-50 dark:hover:bg-gray-800',
                          'transition-colors duration-150',
                          'flex items-center gap-3',
                          index === chapterIndex && 'bg-blue-50 dark:bg-blue-900/20'
                        )}
                      >
                        <span className={cn(
                          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium',
                          index === chapterIndex 
                            ? 'bg-blue-500 text-white' 
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                        )}>
                          {index + 1}
                        </span>
                        <span className={cn(
                          'flex-1 line-clamp-2',
                          index === chapterIndex
                            ? 'text-blue-600 dark:text-blue-400 font-medium'
                            : 'text-gray-900 dark:text-white'
                        )}>
                          {chapter.title || t('tts.chapter_num_simple', { num: index + 1 })}
                        </span>
                        {index === chapterIndex && (
                          <span className="flex-shrink-0 text-xs px-2 py-1 rounded-full bg-blue-500 text-white">
                            {t('tts.current')}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export const TTSPlayerOverlay = memo(TTSPlayerOverlayComponent)

export default TTSPlayerOverlay

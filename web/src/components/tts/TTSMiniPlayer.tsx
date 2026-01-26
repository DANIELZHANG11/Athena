/**
 * TTS 播放器迷你控制条
 *
 * @description 显示在阅读器底部的迷你TTS播放器
 * 实现 Apple CarPlay 风格的动态模糊背景和按钮交互效果
 * 支持播放/暂停、章节切换、进度显示、展开完整播放器
 *
 * @see 对话记录.md - 2.11 TTS 听书功能实施计划 - Phase 4
 * @see 雅典娜开发技术文档汇总/06 - UIUX设计系统 - Liquid Glass 效果规范
 * @ai-generated Claude Opus 4.5 (2026-01-24)
 */

import { memo, useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Play, Pause, SkipBack, SkipForward, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTTSStore, useTTSPlayState, useTTSCurrentBook } from '@/stores/tts'
import { extractDominantColor, getLuminance } from '@/lib/color-utils'
import { getTTSController } from '@/services/tts'

interface TTSMiniPlayerProps {
  /** 展开完整播放器回调 */
  onExpand: () => void
  /** 关闭播放器回调 */
  onClose?: () => void
  /** 额外的 className */
  className?: string
}

function TTSMiniPlayerComponent({ onExpand, onClose, className }: TTSMiniPlayerProps) {
  const { t } = useTranslation('common')
  const playState = useTTSPlayState()
  const { bookTitle, authorName, bookCover, bookId } = useTTSCurrentBook()
  const navigate = useNavigate()

  const storePause = useTTSStore((s) => s.pause)
  const storeStop = useTTSStore((s) => s.stop)
  const previousChapter = useTTSStore((s) => s.previousChapter)
  const nextChapter = useTTSStore((s) => s.nextChapter)

  // 派生状态 - 必须在回调之前定义
  const isLoading = playState === 'loading'
  const isPlaying = playState === 'playing'

  // 检查控制器是否可用
  const isControllerReady = getTTSController().isReady()

  // 处理播放/暂停 - 如果控制器不可用，导航到阅读页面
  const handlePlayPause = useCallback(() => {
    const controller = getTTSController()
    if (!controller.isReady()) {
      // 控制器不可用，导航到阅读页面继续播放
      if (bookId) {
        navigate(`/reader/${bookId}?tts=1`)
      }
      return
    }

    const currentlyPlaying = useTTSStore.getState().playState === 'playing'
    if (currentlyPlaying) {
      controller.pause()
      storePause()
    } else {
      controller.resume()
      useTTSStore.getState().setPlayState('playing')
    }
  }, [storePause, bookId, navigate])

  // 处理关闭播放器
  const handleClose = useCallback(() => {
    if (onClose) {
      onClose()
    } else {
      // 默认行为：停止播放并清除状态
      storeStop()
    }
  }, [onClose, storeStop])

  // 主色调状态
  const [dominantColor, setDominantColor] = useState<string | null>(null)
  const [isLightBackground, setIsLightBackground] = useState(false)

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
          setDominantColor(null)
        })
    } else {
      setDominantColor(null)
    }
  }, [bookCover])

  // 隐藏条件：未在播放/暂停状态
  if (playState === 'idle') {
    return null
  }

  return (
    <div
      className={cn(
        'fixed left-0 right-0 bottom-0 z-40',
        'overflow-hidden',
        'border-t border-white/10',
        className
      )}
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* 动态模糊背景 - Apple CarPlay 风格 */}
      {bookCover ? (
        <>
          {/* 封面图片模糊背景 */}
          <div className="absolute inset-0">
            <img
              src={bookCover}
              alt=""
              className="w-full h-full object-cover scale-150 blur-2xl"
              aria-hidden="true"
            />
          </div>
          {/* 暗色遮罩层 */}
          <div className={cn(
            'absolute inset-0',
            isLightBackground ? 'bg-white/40' : 'bg-black/50'
          )} />
        </>
      ) : dominantColor ? (
        <div
          className="absolute inset-0"
          style={{ backgroundColor: dominantColor }}
        />
      ) : (
        <div className="absolute inset-0 bg-gray-900/90 backdrop-blur-xl" />
      )}

      {/* 内容层 */}
      <div className="relative flex items-center h-14 px-4 gap-3">
        {/* 封面缩略图 */}
        {bookCover && (
          <button
            className="w-10 h-10 rounded-lg overflow-hidden shadow-lg flex-shrink-0"
            onClick={onExpand}
          >
            <img
              src={bookCover}
              alt=""
              className="w-full h-full object-cover"
            />
          </button>
        )}

        {/* 书籍信息 - 点击展开 */}
        <button
          className="flex-1 flex flex-col items-start min-w-0"
          onClick={onExpand}
        >
          <span className={cn(
            "text-sm font-medium truncate w-full text-left",
            isLightBackground ? 'text-gray-900' : 'text-white'
          )}>
            {bookTitle || t('tts.unknown_book')}
          </span>
          <span className={cn(
            "text-xs truncate w-full text-left",
            isLightBackground ? 'text-gray-600' : 'text-white/70'
          )}>
            {authorName || t('tts.unknown_author')}
          </span>
        </button>

        {/* 控制按钮 - Apple CarPlay 风格 */}
        <div className="flex items-center gap-0.5">
          {/* 上一章 */}
          <button
            className={cn(
              'p-2.5 rounded-full',
              'bg-transparent',
              isLightBackground ? 'text-gray-900' : 'text-white',
              'active:bg-white active:text-gray-900 active:scale-95',
              isLightBackground ? 'hover:bg-black/10' : 'hover:bg-white/20',
              'transition-all duration-150',
              'disabled:opacity-40 disabled:pointer-events-none'
            )}
            onClick={(e) => {
              e.stopPropagation()
              previousChapter()
            }}
            disabled={isLoading}
            aria-label={t('tts.previous_chapter')}
          >
            <SkipBack className="w-5 h-5" />
          </button>

          {/* 播放/暂停 - 主按钮 */}
          <button
            className={cn(
              'w-11 h-11 rounded-full',
              'flex items-center justify-center',
              'shadow-lg',
              'transition-all duration-150',
              'bg-white text-gray-900',
              'active:scale-95 active:bg-gray-200',
              'hover:scale-105',
              'disabled:opacity-60 disabled:pointer-events-none'
            )}
            onClick={(e) => {
              e.stopPropagation()
              handlePlayPause()
            }}
            disabled={isLoading}
            aria-label={isPlaying ? t('tts.pause') : t('tts.play')}
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-5 h-5 fill-current" />
            ) : (
              <Play className="w-5 h-5 fill-current ml-0.5" />
            )}
          </button>

          {/* 下一章 */}
          <button
            className={cn(
              'p-2.5 rounded-full',
              'bg-transparent',
              isLightBackground ? 'text-gray-900' : 'text-white',
              'active:bg-white active:text-gray-900 active:scale-95',
              isLightBackground ? 'hover:bg-black/10' : 'hover:bg-white/20',
              'transition-all duration-150',
              'disabled:opacity-40 disabled:pointer-events-none'
            )}
            onClick={(e) => {
              e.stopPropagation()
              nextChapter()
            }}
            disabled={isLoading}
            aria-label={t('tts.next_chapter')}
          >
            <SkipForward className="w-5 h-5" />
          </button>
        </div>

        {/* 关闭按钮 */}
        <button
          className={cn(
            'p-2 rounded-full',
            'bg-transparent',
            isLightBackground ? 'text-gray-600' : 'text-white/70',
            'active:bg-white active:text-gray-900 active:scale-95',
            isLightBackground ? 'hover:bg-black/10' : 'hover:bg-white/20',
            'transition-all duration-150'
          )}
          onClick={(e) => {
            e.stopPropagation()
            handleClose()
          }}
          aria-label={t('common.close')}
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}

export const TTSMiniPlayer = memo(TTSMiniPlayerComponent)

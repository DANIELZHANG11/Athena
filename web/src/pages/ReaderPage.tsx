/**
 * ReaderPage - 电子书阅读器路由入口页面 (App-First 版)
 *
 * 架构:
 * 1. 元数据: PowerSync (useBookData)
 * 2. 进度: PowerSync (useProgressData)
 * 3. 文件: IndexedDB (useLocalBookCache + getBookFile)
 * 4. 阅读器: 根据格式选择 EpubReader 或 PdfReader
 * 5. TTS听书: 支持后台播放、睡眠定时器、MediaSession 控制
 *
 * 纯响应式，无心跳，无 API 轮询
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth'
import { Loader2, AlertCircle, ArrowLeft, Headphones } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useBookData } from '@/hooks/useBooksData'
import { useProgressData, useReadingSession } from '@/hooks/useProgressData'
import { useBookFileCache } from '@/hooks/useBookFileCache'
import { getBookFile, createBlobUrl, revokeBlobUrl } from '@/lib/bookStorage'
import { useOcrData } from '@/hooks/useOcrData'
import { EpubReader, type FoliateViewElement } from '@/components/readers'
import { PdfReader } from '@/components/readers'
import { parseEpubLocation, parsePdfLocation } from '@/lib/reading-utils'
import { TTSMiniPlayer, TTSPlayerOverlay, TTSSettingsSheet } from '@/components/tts'
import { useTTSStore, useTTSPlayState, useTTSCurrentBook, setTTSPowerSyncDb } from '@/stores/tts'
import { getTTSController, destroyTTSController, startTTSSession, endTTSSession, heartbeatTTSSession, getTTSHeartbeatInterval, loadTTSProgress, syncTTSProgress } from '@/services/tts'
import { usePowerSyncDatabase } from '@/lib/powersync'

export default function ReaderPage() {
  const { t } = useTranslation('common')
  const { bookId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const accessToken = useAuthStore((s) => s.accessToken)

  // 从URL参数获取跳转目标（来自AI引用）
  const urlPage = searchParams.get('page')
  const urlSection = searchParams.get('section')  // EPUB 章节索引，用于精确跳转
  const urlSearch = searchParams.get('search')
  const urlChunk = searchParams.get('chunk')
  const urlTTS = searchParams.get('tts') === '1' // TTS 自动启动参数

  // 1. 获取书籍元数据
  const { book, isLoading: isMetaLoading, error: metaError } = useBookData(bookId || null)

  // 2. 获取阅读进度 - 必须等待加载完成才能渲染阅读器
  const { progress, saveProgress, isProgressLoading } = useProgressData(bookId || null)

  // 2.1 记录阅读会话（用于统计阅读时长）
  const { startSession, endSession } = useReadingSession(bookId || null)

  // 3. 本地文件状态
  const { markDownloading, markDownloaded } = useBookFileCache(bookId ? [bookId] : [])
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  // 关键修复：使用 useRef 存储 ArrayBuffer，防止引用变化导致 EpubReader 重新挂载
  const epubDataRef = useRef<ArrayBuffer | null>(null)
  const [epubDataReady, setEpubDataReady] = useState(false)
  const [fileLoading, setFileLoading] = useState(true)
  const [fileError, setFileError] = useState<string | null>(null)
  const [fileFormat, setFileFormat] = useState<'epub' | 'pdf'>('epub')

  // 4. OCR 数据（预加载）
  useOcrData({
    bookId: bookId || '',
    autoDownload: true
  })

  // 5. TTS 听书状态
  const ttsPlayState = useTTSPlayState()
  const { bookId: ttsCurrentBookId } = useTTSCurrentBook()
  const ttsStop = useTTSStore((s) => s.stop)

  // TTS UI 状态
  const [showTTSOverlay, setShowTTSOverlay] = useState(false)
  const [showTTSSettings, setShowTTSSettings] = useState(false)

  // foliate-view 引用（用于 TTS）
  const foliateViewRef = useRef<FoliateViewElement | null>(null)

  // TTS 会话心跳定时器引用
  const ttsHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 是否当前书籍正在 TTS 播放
  const isCurrentBookTTS = ttsCurrentBookId === bookId && ttsPlayState !== 'idle'

  // 获取 PowerSync 数据库引用并设置给 TTS store
  const powerSyncDb = usePowerSyncDatabase()
  useEffect(() => {
    setTTSPowerSyncDb(powerSyncDb)
  }, [powerSyncDb])

  // 初始化：加载文件
  useEffect(() => {
    if (!bookId) return

    const loadFile = async () => {
      console.log('[ReaderPage] Loading file for book:', bookId)
      setFileLoading(true)
      setFileError(null)
      try {
        // 检查缓存
        const cached = await getBookFile(bookId)
        if (cached) {
          console.log('[ReaderPage] Cached file:', {
            format: cached.format,
            size: cached.blob.size,
            blobType: cached.blob.type,
            blobSize: cached.blob.size
          })

          setFileFormat(cached.format as 'epub' | 'pdf')

          // EPUB 使用 ArrayBuffer，PDF 使用 Blob URL
          if (cached.format === 'epub') {
            const arrayBuffer = await cached.blob.arrayBuffer()
            console.log('[ReaderPage] Created ArrayBuffer from cache for EPUB, size:', arrayBuffer.byteLength)
            epubDataRef.current = arrayBuffer
            setEpubDataReady(true)
          } else {
            const url = createBlobUrl(cached.blob, cached.format)
            console.log('[ReaderPage] Created blob URL from cache for PDF:', url)
            setBlobUrl(url)
          }

          setFileLoading(false)
          return
        }

        // 未缓存，需要下载
        if (!accessToken) {
          throw new Error('Not authenticated')
        }
        console.log('[ReaderPage] File not cached, downloading...')
        markDownloading(bookId)
        const contentUrl = `/api/v1/books/${bookId}/content?token=${encodeURIComponent(accessToken)}`
        const response = await fetch(contentUrl)

        if (!response.ok) throw new Error(`Download failed: ${response.status}`)

        const blob = await response.blob()
        const contentType = response.headers.get('Content-Type') || ''
        const format = contentType.includes('pdf') ? 'pdf' : 'epub'

        // 保存到缓存
        const { saveBookFile } = await import('@/lib/bookStorage')
        await saveBookFile(bookId, blob, format, undefined)
        markDownloaded(bookId)

        setFileFormat(format as 'epub' | 'pdf')

        // EPUB 使用 ArrayBuffer，PDF 使用 Blob URL
        if (format === 'epub') {
          const arrayBuffer = await blob.arrayBuffer()
          console.log('[ReaderPage] Created ArrayBuffer after download for EPUB, size:', arrayBuffer.byteLength)
          epubDataRef.current = arrayBuffer
          setEpubDataReady(true)
        } else {
          const url = createBlobUrl(blob, format)
          console.log('[ReaderPage] Created blob URL after download for PDF:', url)
          setBlobUrl(url)
        }

        setFileLoading(false)
      } catch (err) {
        console.error('[ReaderPage] File load error:', err)
        setFileError(err instanceof Error ? err.message : 'Failed to load book')
        setFileLoading(false)
      }
    }

    loadFile()

    return () => {
      if (blobUrl) revokeBlobUrl(blobUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, accessToken])

  // 阅读会话管理
  // 使用 ref 跟踪会话状态，确保在各种退出场景下都能正确关闭会话
  const sessionActiveRef = useRef(false)

  useEffect(() => {
    // 条件：文件加载完成（EPUB 用 epubDataReady，PDF 用 blobUrl）
    const isFileReady = fileFormat === 'epub' ? epubDataReady : !!blobUrl

    if (!fileLoading && isFileReady && bookId && !sessionActiveRef.current) {
      console.log('[ReaderPage] Starting reading session for book:', bookId)
      startSession().then((id) => {
        if (id) {
          console.log('[ReaderPage] Session started successfully:', id)
          sessionActiveRef.current = true
        }
      }).catch((err) => {
        console.error('[ReaderPage] Failed to start reading session:', err)
      })
    }

    // 处理页面可见性变化：用户切换到其他标签页时结束会话
    const handleVisibilityChange = () => {
      if (document.hidden && sessionActiveRef.current) {
        console.log('[ReaderPage] Page hidden, ending session')
        endSession()
        sessionActiveRef.current = false
      } else if (!document.hidden && bookId && !sessionActiveRef.current) {
        // 用户回到页面，重新开始会话
        console.log('[ReaderPage] Page visible again, restarting session')
        startSession().then((id) => {
          if (id) {
            sessionActiveRef.current = true
          }
        })
      }
    }

    // 处理页面卸载：用户关闭标签页/刷新页面
    const handleBeforeUnload = () => {
      if (sessionActiveRef.current) {
        console.log('[ReaderPage] Page unloading, ending session')
        endSession()
        sessionActiveRef.current = false
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)

      // 组件卸载时结束会话（用户导航到其他页面）
      if (sessionActiveRef.current && bookId) {
        console.log('[ReaderPage] Component unmounting, ending reading session for book:', bookId)
        endSession()
        sessionActiveRef.current = false
      }

      // 清理 TTS 控制器 - 暂停播放并更新状态
      const ttsState = useTTSStore.getState()
      if (ttsState.playState === 'playing' || ttsState.playState === 'paused') {
        console.log('[ReaderPage] Pausing TTS on unmount')
        ttsState.setPlayState('paused')
      }
      destroyTTSController()
      foliateViewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileLoading, epubDataReady, blobUrl, bookId, fileFormat])


  // 返回按钮处理
  const handleBack = useCallback(() => {
    navigate(-1)
  }, [navigate])

  // TTS 启动处理（使用 foliate-js + Web Speech API）
  const handleStartTTS = useCallback(async () => {
    if (!bookId || !book) return

    // 检查 foliate-view 是否准备就绪（仅 EPUB 支持 TTS）
    if (!foliateViewRef.current) {
      console.warn('[ReaderPage] TTS not available: foliate-view not ready')
      return
    }

    try {
      console.log('[ReaderPage] Initializing TTS for book:', bookId, book.title)

      // 获取 TTS 控制器
      const ttsController = getTTSController()

      // 设置事件监听
      ttsController.setEvents({
        onStateChange: (state) => {
          console.log('[ReaderPage] TTS state:', state)
          // 同步到 Zustand store（用于 MiniPlayer 显示）
          const storeState = useTTSStore.getState()
          if (state === 'playing') storeState.setPlayState('playing')
          else if (state === 'paused') storeState.setPlayState('paused')
          else if (state === 'loading') storeState.setPlayState('loading')
          else if (state === 'error') storeState.setPlayState('error')
        },
        onHighlight: (range) => {
          console.log('[ReaderPage] TTS highlight:', range.toString().substring(0, 50))
        },
        onComplete: () => {
          console.log('[ReaderPage] TTS playback complete')
          useTTSStore.getState().setPlayState('idle')
        },
        onError: (error) => {
          console.error('[ReaderPage] TTS error:', error)
          useTTSStore.getState().setError(error.message)
        },
      })

      // 初始化 foliate-js TTS
      await ttsController.init(foliateViewRef.current, { granularity: 'sentence' })

      // 从 store 获取用户设置的语速和音量，应用到 controller
      const currentSettings = useTTSStore.getState()
      ttsController.setRate(currentSettings.speed)
      ttsController.setVolume(currentSettings.volume)

      // 获取 EPUB 目录并转换为 TTS 章节格式
      const epubToc = foliateViewRef.current?.book?.toc || []
      const flattenToc = (items: Array<{ label: string; href: string; subitems?: Array<{ label: string; href: string }> }>, result: Array<{ index: number; title: string; href: string; paragraphs: never[] }> = []): Array<{ index: number; title: string; href: string; paragraphs: never[] }> => {
        for (const item of items) {
          result.push({
            index: result.length,
            title: item.label,
            href: item.href,
            paragraphs: [], // paragraphs 由 ttsController 管理
          })
          if (item.subitems && item.subitems.length > 0) {
            flattenToc(item.subitems as Array<{ label: string; href: string; subitems?: Array<{ label: string; href: string }> }>, result)
          }
        }
        return result
      }
      const ttsChapters = flattenToc(epubToc as Array<{ label: string; href: string; subitems?: Array<{ label: string; href: string }> }>)
      console.log('[ReaderPage] TOC chapters:', ttsChapters.length)

      // 更新 store 状态（用于 MiniPlayer 显示书籍信息）
      const storeState = useTTSStore.getState()
      storeState.setPlayState('loading')
      storeState.setChapters(ttsChapters)

      // 手动设置书籍信息（因为新架构不使用 startPlayback）
      useTTSStore.setState({
        currentBookId: bookId,
        currentBookTitle: book.title || '未知书籍',
        currentAuthorName: book.author || null,
        currentBookCover: book.coverUrl || null,
        isEngineReady: true,
      })

      // 开始 TTS 阅读会话（用于统计听书时长）
      if (powerSyncDb) {
        await startTTSSession(powerSyncDb, bookId)
        // 启动心跳定时器（同时同步阅读时长和播放进度）
        if (ttsHeartbeatRef.current) {
          clearInterval(ttsHeartbeatRef.current)
        }
        ttsHeartbeatRef.current = setInterval(() => {
          if (powerSyncDb) {
            // 同步阅读会话时长
            heartbeatTTSSession(powerSyncDb)
            // 同步 TTS 播放进度（章节位置）
            const controller = getTTSController()
            if (controller.isReady() && bookId) {
              const chapterIndex = controller.getCurrentChapterIndex()
              syncTTSProgress(powerSyncDb, {
                bookId,
                chapterIndex,
                positionMs: 0, // Web Speech API 不提供精确的时间位置
              }).catch((err) => console.warn('[ReaderPage] TTS 进度同步失败:', err))
            }
          }
        }, getTTSHeartbeatInterval())
      }

      // 尝试加载保存的 TTS 进度并恢复到上次播放位置
      let resumedFromSaved = false
      if (powerSyncDb && ttsChapters.length > 0) {
        try {
          const savedProgress = await loadTTSProgress(powerSyncDb, bookId)
          if (savedProgress && savedProgress.chapterIndex !== null && savedProgress.chapterIndex !== undefined) {
            const targetChapter = ttsChapters[savedProgress.chapterIndex]
            if (targetChapter?.href) {
              console.log('[ReaderPage] 恢复 TTS 进度:', {
                chapterIndex: savedProgress.chapterIndex,
                chapterTitle: targetChapter.title,
              })
              // 更新 TTS 控制器中的章节索引
              ttsController.setCurrentChapterIndex(savedProgress.chapterIndex)
              // 更新 store 中的当前章节信息
              useTTSStore.setState({
                currentPosition: {
                  bookId,
                  chapterIndex: savedProgress.chapterIndex,
                  paragraphIndex: 0,
                  sentenceIndex: 0,
                  offsetMs: 0,
                },
                currentChapterTitle: targetChapter.title || `第 ${savedProgress.chapterIndex + 1} 章`,
              })
              // 跳转到保存的章节并开始播放
              await ttsController.goToHref(targetChapter.href)
              resumedFromSaved = true
            }
          }
        } catch (error) {
          console.warn('[ReaderPage] 加载 TTS 进度失败:', error)
        }
      }

      // 如果没有恢复到保存的进度，从当前位置开始播放
      if (!resumedFromSaved) {
        await ttsController.play()
      }

      console.log('[ReaderPage] TTS started for book:', bookId, book.title)

      // 打开播放器界面
      setShowTTSOverlay(true)
    } catch (error) {
      console.error('[ReaderPage] TTS init failed:', error)
      useTTSStore.getState().setError(error instanceof Error ? error.message : 'TTS 初始化失败')
    }
  }, [bookId, book, powerSyncDb])

  // TTS 停止处理
  const handleStopTTS = useCallback(() => {
    // 停止心跳定时器
    if (ttsHeartbeatRef.current) {
      clearInterval(ttsHeartbeatRef.current)
      ttsHeartbeatRef.current = null
    }

    // 结束 TTS 阅读会话
    if (powerSyncDb) {
      endTTSSession(powerSyncDb)
    }

    // 停止 TTS 控制器
    const ttsController = getTTSController()
    ttsController.stop()

    // 清理 store 状态
    ttsStop()
    setShowTTSOverlay(false)
    setShowTTSSettings(false)
  }, [ttsStop, powerSyncDb])

  // foliate-view 准备就绪回调
  const handleViewReady = useCallback((view: FoliateViewElement) => {
    console.log('[ReaderPage] foliate-view ready for TTS')
    foliateViewRef.current = view

    // 如果 URL 参数包含 tts=1，自动启动 TTS
    if (urlTTS && bookId && book) {
      console.log('[ReaderPage] Auto-starting TTS from URL parameter')
      // 使用 setTimeout 确保 view 完全初始化
      setTimeout(() => {
        handleStartTTS()
      }, 500)
    }
  }, [urlTTS, bookId, book, handleStartTTS])

  // 监听来自 EpubReader 右下角工具栏的 TTS 请求
  useEffect(() => {
    const handleTTSRequest = () => {
      console.log('[ReaderPage] Received TTS request from EpubReader toolbar')
      handleStartTTS()
    }
    window.addEventListener('epub-reader-tts-request', handleTTSRequest)
    return () => {
      window.removeEventListener('epub-reader-tts-request', handleTTSRequest)
    }
  }, [handleStartTTS])

  // EPUB 位置变更处理
  const handleEpubLocationChanged = useCallback((cfi: string, percentage: number) => {
    console.log('[ReaderPage] EPUB progress update:', { cfi, percentage })
    saveProgress({
      currentCfi: cfi,
      percentage: typeof percentage === 'number' ? percentage : 0,
    })
  }, [saveProgress])

  // PDF 页面变更处理
  const handlePdfPageChanged = useCallback((page: number, totalPages: number, percentage: number) => {
    console.log('[ReaderPage] PDF progress update:', { page, totalPages, percentage })
    saveProgress({
      currentPage: page,
      percentage: percentage,
      totalPages: totalPages
    })
  }, [saveProgress])

  // 解析初始位置 - 优先使用URL参数（来自AI引用跳转）
  const getInitialLocation = useCallback(() => {
    const isPdf = book?.originalFormat === 'pdf' || fileFormat === 'pdf'

    // EPUB: 优先使用URL参数中的章节索引（来自AI引用跳转）
    if (!isPdf && urlSection) {
      const sectionIndex = parseInt(urlSection, 10)
      if (!isNaN(sectionIndex) && sectionIndex >= 0) {
        console.log('[ReaderPage] Using URL section parameter:', sectionIndex)
        // 返回 section_index，EpubReader 将使用 foliate-js 的 goTo(index) 跳转
        return { type: 'section', index: sectionIndex }
      }
    }

    // PDF: 优先使用URL参数中的页码（来自AI引用跳转）
    if (urlPage) {
      const page = parseInt(urlPage, 10)
      if (!isNaN(page) && page > 0) {
        console.log('[ReaderPage] Using URL page parameter:', page)
        return isPdf ? page : undefined  // EPUB需要CFI，页码对EPUB无效
      }
    }

    // 否则使用已保存的进度
    if (!progress) return undefined

    if (isPdf) {
      const loc = parsePdfLocation(progress.currentCfi || progress.currentPage)
      return loc?.page || 1
    } else {
      const loc = parseEpubLocation(progress.currentCfi)
      return loc || undefined
    }
  }, [progress, book, fileFormat, urlPage, urlSection])

  // 调试：检查渲染条件
  console.log('[ReaderPage] Render conditions:', {
    isMetaLoading,
    fileLoading,
    isProgressLoading,
    hasBook: !!book,
    hasBlobUrl: !!blobUrl,
    epubDataReady,
    fileFormat,
    metaError: metaError?.message,
    fileError
  })

  // 渲染加载中 - 注意：不再等待 isProgressLoading，进度数据可以在阅读器渲染后加载
  // 只需要等待：元数据加载、文件加载
  if (isMetaLoading || fileLoading || (!book && !metaError && !fileError)) {
    console.log('[ReaderPage] Still loading, blocking render:', {
      isMetaLoading,
      fileLoading,
      condition3: !book && !metaError && !fileError
    })
    return (
      <div className="flex items-center justify-center h-[100dvh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">{t('reader.loading')}</span>
      </div>
    )
  }

  // 获取书籍标题
  const bookTitle = book?.title || t('tts.unknown_book')
  const isPdf = book?.originalFormat === 'pdf' || fileFormat === 'pdf'

  // 渲染错误 - 检查元数据错误、文件错误，或文件未加载完成
  if (metaError || fileError || !book || (isPdf ? !blobUrl : !epubDataReady)) {
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] gap-4">
        <AlertCircle className="h-12 w-12 text-system-red" />
        <p className="text-system-red">{metaError?.message || fileError || t('reader.load_failed')}</p>
        <Button onClick={handleBack} variant="outline">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('reader.go_back')}
        </Button>
      </div>
    )
  }

  // 根据格式渲染对应阅读器
  if (isPdf) {
    return (
      <>
        <PdfReader
          url={blobUrl!}
          bookId={bookId || ''}
          bookTitle={bookTitle}
          initialPage={getInitialLocation() as number}
          onPageChanged={handlePdfPageChanged}
          onBack={handleBack}
        />

        {/* TTS 听书按钮 - 悬浮在右下角，白色背景确保在任何背景下可见 */}
        {!isCurrentBookTTS && (
          <button
            onClick={handleStartTTS}
            className="fixed bottom-20 right-4 z-50 p-3.5 rounded-full bg-white/95 dark:bg-gray-800/95 text-system-blue shadow-xl ring-1 ring-black/10 dark:ring-white/20 hover:scale-105 active:scale-95 transition-all backdrop-blur-sm"
            aria-label={t('tts.start_listening')}
          >
            <Headphones className="w-6 h-6" />
          </button>
        )}

        {/* TTS Mini Player - 底部迷你播放器 */}
        {isCurrentBookTTS && (
          <TTSMiniPlayer onExpand={() => setShowTTSOverlay(true)} />
        )}

        {/* TTS 全屏播放器覆盖层 */}
        {showTTSOverlay && (
          <TTSPlayerOverlay
            onClose={() => setShowTTSOverlay(false)}
            onOpenSettings={() => setShowTTSSettings(true)}
          />
        )}

        {/* TTS 设置面板 */}
        {showTTSSettings && (
          <TTSSettingsSheet onClose={() => setShowTTSSettings(false)} />
        )}
      </>
    )
  }

  // 关键：epubDataRef.current 的引用永远不变，避免 EpubReader 重新挂载
  return (
    <>
      <EpubReader
        data={epubDataRef.current!}
        bookId={bookId || ''}
        bookTitle={bookTitle}
        initialLocation={getInitialLocation() as string | { type: 'section', index: number }}
        onLocationChanged={handleEpubLocationChanged}
        onBack={handleBack}
        onViewReady={handleViewReady}
      />



      {/* TTS Mini Player - 底部迷你播放器 */}
      {isCurrentBookTTS && (
        <TTSMiniPlayer onExpand={() => setShowTTSOverlay(true)} />
      )}

      {/* TTS 全屏播放器覆盖层 */}
      {showTTSOverlay && (
        <TTSPlayerOverlay
          onClose={() => setShowTTSOverlay(false)}
          onOpenSettings={() => setShowTTSSettings(true)}
        />
      )}

      {/* TTS 设置面板 */}
      {showTTSSettings && (
        <TTSSettingsSheet onClose={() => setShowTTSSettings(false)} />
      )}
    </>
  )
}

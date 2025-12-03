/**
 * useSmartHeartbeat - ADR-006 智能心跳同步 Hook
 * 
 * 功能:
 * 1. 版本指纹对比（OCR、元数据、向量索引）
 * 2. 离线笔记/高亮批量上传
 * 3. 冲突检测与处理
 * 4. 服务端事件拉取
 * 5. 动态心跳间隔调整
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import api from '@/lib/api'
import { getDeviceId } from '@/lib/utils'

// 心跳间隔配置（毫秒）
const HEARTBEAT_ACTIVE = 15_000      // 用户活跃阅读
const HEARTBEAT_IDLE = 60_000        // 用户空闲
const HEARTBEAT_BACKGROUND = 300_000 // 后台/最小化

// 单次心跳最大数据量
const MAX_NOTES_PER_HEARTBEAT = 50
const MAX_HIGHLIGHTS_PER_HEARTBEAT = 50

// 类型定义
export interface ClientVersions {
  ocr?: string
  metadata?: string
  vectorIndex?: string
}

export interface ReadingProgressUpdate {
  progress: number
  lastLocation?: unknown
  timestamp: string
}

export interface PendingNote {
  clientId: string
  content: string
  location?: string
  chapter?: string
  createdAt: string
}

export interface PendingHighlight {
  clientId: string
  text: string
  startLocation: string
  endLocation: string
  color?: string
  createdAt: string
}

export interface PullRequired {
  ocr?: {
    url: string
    size: number
    priority: 'high' | 'normal' | 'low'
  }
  metadata?: {
    url: string
    fields: string[]
    priority: 'normal'
  }
  vectorIndex?: {
    url: string
    priority: 'low'
  }
}

export interface NoteResult {
  clientId: string
  serverId?: string
  status: 'created' | 'conflict_copy' | 'rejected'
  conflictId?: string
  message?: string
}

export interface HighlightResult {
  clientId: string
  serverId?: string
  status: 'created' | 'conflict' | 'merged' | 'rejected'
  message?: string
}

export interface PendingEvent {
  type: 'ocr_ready' | 'metadata_updated' | 'vector_ready'
  bookId: string
  version: string
  createdAt: string
}

export interface HeartbeatResponse {
  serverVersions: {
    ocr?: string
    metadata?: string
    vectorIndex?: string
  }
  pullRequired: PullRequired
  pushResults: {
    readingProgress?: 'accepted' | 'conflict'
    notes?: NoteResult[]
    highlights?: HighlightResult[]
  }
  nextHeartbeatMs: number
  pendingEvents?: PendingEvent[]
}

export interface SmartHeartbeatState {
  isActive: boolean
  lastSyncAt: Date | null
  nextHeartbeatMs: number
  serverVersions: ClientVersions
  pendingEvents: PendingEvent[]
  syncError: string | null
}

interface UseSmartHeartbeatOptions {
  bookId: string
  enabled?: boolean
  /** 客户端当前版本指纹 */
  clientVersions?: ClientVersions
  /** 当需要拉取数据时的回调 */
  onPullRequired?: (pull: PullRequired) => void
  /** 当有服务端事件时的回调 */
  onServerEvent?: (event: PendingEvent) => void
  /** 当笔记同步完成时的回调 */
  onNoteSyncResult?: (results: NoteResult[]) => void
  /** 当高亮同步完成时的回调 */
  onHighlightSyncResult?: (results: HighlightResult[]) => void
  /** 错误回调 */
  onError?: (error: Error) => void
}

interface UseSmartHeartbeatReturn {
  state: SmartHeartbeatState
  /** 更新阅读进度 */
  updateProgress: (progress: number, location?: unknown) => void
  /** 提交离线笔记 */
  submitPendingNotes: (notes: PendingNote[]) => void
  /** 提交离线高亮 */
  submitPendingHighlights: (highlights: PendingHighlight[]) => void
  /** 立即同步 */
  syncNow: () => Promise<HeartbeatResponse | null>
  /** 设置用户活跃状态 */
  setUserActive: (active: boolean) => void
}

export function useSmartHeartbeat(options: UseSmartHeartbeatOptions): UseSmartHeartbeatReturn {
  const {
    bookId,
    enabled = true,
    clientVersions = {},
    onPullRequired,
    onServerEvent,
    onNoteSyncResult,
    onHighlightSyncResult,
    onError,
  } = options

  // 状态
  const [state, setState] = useState<SmartHeartbeatState>({
    isActive: false,
    lastSyncAt: null,
    nextHeartbeatMs: HEARTBEAT_ACTIVE,
    serverVersions: {},
    pendingEvents: [],
    syncError: null,
  })

  // Refs
  const bookIdRef = useRef(bookId)
  const enabledRef = useRef(enabled)
  const clientVersionsRef = useRef(clientVersions)
  const callbacksRef = useRef({ onPullRequired, onServerEvent, onNoteSyncResult, onHighlightSyncResult, onError })
  
  const isMountedRef = useRef(true)
  const heartbeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isUserActiveRef = useRef(true)
  
  // 待同步数据
  const pendingProgressRef = useRef<ReadingProgressUpdate | null>(null)
  const pendingNotesRef = useRef<PendingNote[]>([])
  const pendingHighlightsRef = useRef<PendingHighlight[]>([])

  // 更新 refs
  useEffect(() => {
    bookIdRef.current = bookId
    enabledRef.current = enabled
    clientVersionsRef.current = clientVersions
    callbacksRef.current = { onPullRequired, onServerEvent, onNoteSyncResult, onHighlightSyncResult, onError }
  }, [bookId, enabled, clientVersions, onPullRequired, onServerEvent, onNoteSyncResult, onHighlightSyncResult, onError])

  // 发送心跳
  const sendHeartbeat = useCallback(async (): Promise<HeartbeatResponse | null> => {
    const currentBookId = bookIdRef.current
    if (!currentBookId || !isMountedRef.current) return null

    // 构建请求体
    const requestBody: Record<string, unknown> = {
      bookId: currentBookId,
      deviceId: getDeviceId(),
      clientVersions: clientVersionsRef.current,
    }

    // 添加客户端更新
    const clientUpdates: Record<string, unknown> = {}
    
    if (pendingProgressRef.current) {
      clientUpdates.readingProgress = pendingProgressRef.current
    }

    // 限制单次上传数量
    const notesToSync = pendingNotesRef.current.slice(0, MAX_NOTES_PER_HEARTBEAT)
    if (notesToSync.length > 0) {
      clientUpdates.pendingNotes = notesToSync
    }

    const highlightsToSync = pendingHighlightsRef.current.slice(0, MAX_HIGHLIGHTS_PER_HEARTBEAT)
    if (highlightsToSync.length > 0) {
      clientUpdates.pendingHighlights = highlightsToSync
    }

    // 标记是否还有更多数据
    const hasMore = 
      pendingNotesRef.current.length > MAX_NOTES_PER_HEARTBEAT ||
      pendingHighlightsRef.current.length > MAX_HIGHLIGHTS_PER_HEARTBEAT
    
    if (hasMore) {
      clientUpdates.hasMore = true
    }

    if (Object.keys(clientUpdates).length > 0) {
      requestBody.clientUpdates = clientUpdates
    }

    try {
      console.log('[SmartHeartbeat] Sending:', { bookId: currentBookId, hasUpdates: Object.keys(clientUpdates).length > 0 })
      
      const response = await api.post<HeartbeatResponse>('/sync/heartbeat', requestBody)
      const data = response.data

      if (!isMountedRef.current) return null

      // 更新状态
      setState(prev => ({
        ...prev,
        isActive: true,
        lastSyncAt: new Date(),
        nextHeartbeatMs: data.nextHeartbeatMs || HEARTBEAT_ACTIVE,
        serverVersions: data.serverVersions || {},
        pendingEvents: data.pendingEvents || [],
        syncError: null,
      }))

      // 清除已同步的数据
      if (data.pushResults?.readingProgress === 'accepted') {
        pendingProgressRef.current = null
      }

      // 处理笔记同步结果
      if (data.pushResults?.notes) {
        const syncedClientIds = new Set(
          data.pushResults.notes
            .filter(r => r.status === 'created' || r.status === 'conflict_copy')
            .map(r => r.clientId)
        )
        pendingNotesRef.current = pendingNotesRef.current.filter(n => !syncedClientIds.has(n.clientId))
        callbacksRef.current.onNoteSyncResult?.(data.pushResults.notes)
      }

      // 处理高亮同步结果
      if (data.pushResults?.highlights) {
        const syncedClientIds = new Set(
          data.pushResults.highlights
            .filter(r => r.status === 'created' || r.status === 'merged')
            .map(r => r.clientId)
        )
        pendingHighlightsRef.current = pendingHighlightsRef.current.filter(h => !syncedClientIds.has(h.clientId))
        callbacksRef.current.onHighlightSyncResult?.(data.pushResults.highlights)
      }

      // 检查是否需要拉取数据
      if (data.pullRequired && Object.keys(data.pullRequired).length > 0) {
        console.log('[SmartHeartbeat] Pull required:', data.pullRequired)
        callbacksRef.current.onPullRequired?.(data.pullRequired)
      }

      // 处理服务端事件
      if (data.pendingEvents && data.pendingEvents.length > 0) {
        for (const event of data.pendingEvents) {
          console.log('[SmartHeartbeat] Server event:', event)
          callbacksRef.current.onServerEvent?.(event)
        }
      }

      // 如果还有更多数据，立即再次同步
      if (hasMore) {
        console.log('[SmartHeartbeat] Has more pending data, syncing again...')
        setTimeout(() => sendHeartbeat(), 100)
      }

      return data
    } catch (error) {
      console.error('[SmartHeartbeat] Failed:', error)
      
      if (isMountedRef.current) {
        setState(prev => ({
          ...prev,
          syncError: (error as Error).message,
        }))
        callbacksRef.current.onError?.(error as Error)
      }
      
      return null
    }
  }, [])

  // 调度下次心跳
  const scheduleNextHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearTimeout(heartbeatTimerRef.current)
    }

    if (!enabledRef.current || !isMountedRef.current) return

    // 根据用户活跃状态选择间隔
    let interval = HEARTBEAT_ACTIVE
    if (!isUserActiveRef.current) {
      interval = document.hidden ? HEARTBEAT_BACKGROUND : HEARTBEAT_IDLE
    }

    heartbeatTimerRef.current = setTimeout(async () => {
      await sendHeartbeat()
      scheduleNextHeartbeat()
    }, interval)
  }, [sendHeartbeat])

  // 更新阅读进度
  const updateProgress = useCallback((progress: number, location?: unknown) => {
    pendingProgressRef.current = {
      progress,
      lastLocation: location,
      timestamp: new Date().toISOString(),
    }
  }, [])

  // 提交离线笔记
  const submitPendingNotes = useCallback((notes: PendingNote[]) => {
    pendingNotesRef.current = [...pendingNotesRef.current, ...notes]
  }, [])

  // 提交离线高亮
  const submitPendingHighlights = useCallback((highlights: PendingHighlight[]) => {
    pendingHighlightsRef.current = [...pendingHighlightsRef.current, ...highlights]
  }, [])

  // 立即同步
  const syncNow = useCallback(async () => {
    const result = await sendHeartbeat()
    scheduleNextHeartbeat()
    return result
  }, [sendHeartbeat, scheduleNextHeartbeat])

  // 设置用户活跃状态
  const setUserActive = useCallback((active: boolean) => {
    isUserActiveRef.current = active
  }, [])

  // 监听页面可见性变化
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('[SmartHeartbeat] Page hidden, reducing heartbeat frequency')
      } else {
        console.log('[SmartHeartbeat] Page visible, restoring heartbeat frequency')
        // 页面恢复可见时立即同步
        sendHeartbeat()
      }
      scheduleNextHeartbeat()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [sendHeartbeat, scheduleNextHeartbeat])

  // 启动/停止心跳
  useEffect(() => {
    if (!enabled || !bookId) {
      if (heartbeatTimerRef.current) {
        clearTimeout(heartbeatTimerRef.current)
        heartbeatTimerRef.current = null
      }
      return
    }

    isMountedRef.current = true
    console.log('[SmartHeartbeat] Starting for book:', bookId)

    // 立即发送首次心跳
    sendHeartbeat().then(() => {
      scheduleNextHeartbeat()
    })

    return () => {
      console.log('[SmartHeartbeat] Stopping for book:', bookId)
      isMountedRef.current = false
      
      if (heartbeatTimerRef.current) {
        clearTimeout(heartbeatTimerRef.current)
        heartbeatTimerRef.current = null
      }
    }
  }, [bookId, enabled, sendHeartbeat, scheduleNextHeartbeat])

  return {
    state,
    updateProgress,
    submitPendingNotes,
    submitPendingHighlights,
    syncNow,
    setUserActive,
  }
}

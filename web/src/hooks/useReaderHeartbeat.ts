/**
 * useReaderHeartbeat
 * 阅读器心跳同步 Hook
 * 
 * 功能:
 * - 定期发送心跳更新阅读时长
 * - 同步阅读进度到服务器
 */

import { useEffect, useRef, useCallback } from 'react'
import api from '@/lib/api'

// 心跳配置
const HEARTBEAT_INTERVAL = 30_000  // 30秒发送一次心跳
const PROGRESS_DEBOUNCE = 2_000    // 进度更新防抖 2秒

interface UseReaderHeartbeatOptions {
  sessionId: string
  bookId: string
  enabled?: boolean
  onError?: (error: Error) => void
}

interface UseReaderHeartbeatReturn {
  updateProgress: (progress: number, location?: string) => void
  syncNow: () => Promise<void>
  totalReadingTime: number
}

export function useReaderHeartbeat(options: UseReaderHeartbeatOptions): UseReaderHeartbeatReturn {
  const { sessionId, bookId, enabled = true, onError } = options
  
  // 使用 ref 存储所有状态，避免依赖变化
  const sessionIdRef = useRef(sessionId)
  const enabledRef = useRef(enabled)
  const onErrorRef = useRef(onError)
  
  // 更新 refs
  useEffect(() => {
    sessionIdRef.current = sessionId
    enabledRef.current = enabled
    onErrorRef.current = onError
  }, [sessionId, enabled, onError])
  
  // 内部状态
  const lastHeartbeatRef = useRef<number>(Date.now())
  const totalReadingTimeRef = useRef<number>(0)
  // 当前进度 - 始终保持最新值，不会被清空
  const currentProgressRef = useRef<{ progress: number; location?: string } | null>(null)
  const progressDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isMountedRef = useRef(true)
  
  // 发送心跳 - 不依赖任何外部状态
  const sendHeartbeat = useCallback(async () => {
    const currentSessionId = sessionIdRef.current
    if (!currentSessionId || !isMountedRef.current) return
    
    const now = Date.now()
    const delta = now - lastHeartbeatRef.current
    lastHeartbeatRef.current = now
    totalReadingTimeRef.current += delta
    
    const payload: {
      delta_ms: number
      progress?: number
      last_location?: string
    } = {
      delta_ms: delta,
    }
    
    // 始终发送当前进度（如果有的话）
    if (currentProgressRef.current) {
      payload.progress = currentProgressRef.current.progress
      payload.last_location = currentProgressRef.current.location
    }
    
    try {
      console.log('[Heartbeat] Sending:', { sessionId: currentSessionId, ...payload })
      await api.post(`/reading-sessions/${currentSessionId}/heartbeat`, payload)
      console.log('[Heartbeat] Sent successfully, delta:', delta, 'ms, progress:', payload.progress)
    } catch (error) {
      console.warn('[Heartbeat] Failed:', error)
      onErrorRef.current?.(error as Error)
    }
  }, [])
  
  // 更新进度 (防抖) - 更新当前进度并触发心跳
  const updateProgress = useCallback((progress: number, location?: string) => {
    // 更新当前进度（不会被清空，后续心跳会继续发送这个值）
    currentProgressRef.current = { progress, location }
    
    if (progressDebounceRef.current) {
      clearTimeout(progressDebounceRef.current)
    }
    
    progressDebounceRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        sendHeartbeat()
      }
    }, PROGRESS_DEBOUNCE)
  }, [sendHeartbeat])
  
  // 立即同步
  const syncNow = useCallback(async () => {
    await sendHeartbeat()
  }, [sendHeartbeat])
  
  // 设置定时心跳 - 只在 sessionId 变化时重新设置
  useEffect(() => {
    if (!enabled || !sessionId) {
      return
    }
    
    isMountedRef.current = true
    console.log('[Heartbeat] Starting for session:', sessionId)
    lastHeartbeatRef.current = Date.now()
    
    // 清除旧的定时器
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current)
    }
    
    // 启动新的定时器
    heartbeatIntervalRef.current = setInterval(() => {
      if (isMountedRef.current && enabledRef.current && sessionIdRef.current) {
        sendHeartbeat()
      }
    }, HEARTBEAT_INTERVAL)
    
    return () => {
      console.log('[Heartbeat] Stopping for session:', sessionId)
      isMountedRef.current = false
      
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current)
        heartbeatIntervalRef.current = null
      }
      
      if (progressDebounceRef.current) {
        clearTimeout(progressDebounceRef.current)
        progressDebounceRef.current = null
      }
    }
  }, [sessionId, enabled, sendHeartbeat])
  
  return {
    updateProgress,
    syncNow,
    totalReadingTime: totalReadingTimeRef.current,
  }
}

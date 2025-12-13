/**
 * useOnlineStatus.ts
 * 
 * 网络状态检测 Hook
 * 
 * 功能:
 * - 监听 online/offline 事件检测网络状态变化
 * - 使用 navigator.onLine 获取初始状态
 * - 提供 isOnline 状态和上次变化时间
 * - 触发 online/offline 时执行回调
 * 
 * @see App-First改造计划.md - Phase 1.1
 */

import { useState, useEffect, useCallback, useRef } from 'react'

export interface OnlineStatusOptions {
  /** 网络恢复时的回调 */
  onOnline?: () => void
  /** 网络断开时的回调 */
  onOffline?: () => void
}

export interface OnlineStatusReturn {
  /** 当前是否在线 */
  isOnline: boolean
  /** 上次状态变化的时间戳 */
  lastChangedAt: number | null
  /** 离线持续时间（毫秒），在线时为 0 */
  offlineDuration: number
}

/**
 * 网络状态检测 Hook
 * 
 * @example
 * ```tsx
 * const { isOnline, offlineDuration } = useOnlineStatus({
 *   onOnline: () => toast.success('网络已恢复'),
 *   onOffline: () => toast.warning('网络已断开'),
 * })
 * ```
 */
export function useOnlineStatus(options: OnlineStatusOptions = {}): OnlineStatusReturn {
  const { onOnline, onOffline } = options

  // 使用 navigator.onLine 作为初始状态
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    // SSR 兼容：服务端默认返回 true
    if (typeof navigator === 'undefined') return true
    return navigator.onLine
  })

  const [lastChangedAt, setLastChangedAt] = useState<number | null>(null)
  const [offlineDuration, setOfflineDuration] = useState<number>(0)

  // 使用 ref 保存回调，避免 effect 依赖变化
  const onOnlineRef = useRef(onOnline)
  const onOfflineRef = useRef(onOffline)

  // 记录离线开始时间
  const offlineStartRef = useRef<number | null>(null)

  // 更新 ref
  useEffect(() => {
    onOnlineRef.current = onOnline
    onOfflineRef.current = onOffline
  }, [onOnline, onOffline])

  // 处理上线事件
  const handleOnline = useCallback(() => {
    console.log('[useOnlineStatus] Network online')
    setIsOnline(true)
    setLastChangedAt(Date.now())

    // 计算离线持续时间
    if (offlineStartRef.current) {
      const duration = Date.now() - offlineStartRef.current
      setOfflineDuration(duration)
      offlineStartRef.current = null
      console.log(`[useOnlineStatus] Offline duration: ${duration}ms`)
    }

    // 执行回调
    onOnlineRef.current?.()
  }, [])

  // 处理离线事件
  const handleOffline = useCallback(() => {
    console.log('[useOnlineStatus] Network offline')
    setIsOnline(false)
    setLastChangedAt(Date.now())
    offlineStartRef.current = Date.now()
    setOfflineDuration(0)

    // 执行回调
    onOfflineRef.current?.()
  }, [])

  // 设置事件监听
  useEffect(() => {
    // SSR 兼容
    if (typeof window === 'undefined') return

    // 添加事件监听
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // 初始化离线开始时间
    if (!navigator.onLine) {
      offlineStartRef.current = Date.now()
    }

    // 清理函数
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [handleOnline, handleOffline])

  // 定时更新离线持续时间（仅在离线时）
  useEffect(() => {
    if (isOnline) return

    const interval = setInterval(() => {
      if (offlineStartRef.current) {
        setOfflineDuration(Date.now() - offlineStartRef.current)
      }
    }, 1000) // 每秒更新一次

    return () => clearInterval(interval)
  }, [isOnline])

  return {
    isOnline,
    lastChangedAt,
    offlineDuration,
  }
}

/**
 * 格式化离线持续时间
 * @param ms 毫秒数
 * @returns 格式化字符串 (如 "5分钟" 或 "1小时30分钟")
 */
export function formatOfflineDuration(ms: number): string {
  if (ms < 1000) return '刚刚'

  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    const remainingMinutes = minutes % 60
    if (remainingMinutes > 0) {
      return `${hours}小时${remainingMinutes}分钟`
    }
    return `${hours}小时`
  }

  if (minutes > 0) {
    return `${minutes}分钟`
  }

  return `${seconds}秒`
}

export default useOnlineStatus

/**
 * useBookFileCache.ts - 本地文件缓存状态管理 Hook (App-First 版)
 *
 * 职责：
 * - 追踪书籍文件的本地缓存状态
 * - 提供下载状态管理
 * - 使用 bookStorage.ts 的原生 IndexedDB API
 *
 * 替代原有的 useLocalBookCache.ts (基于 Dexie)
 *
 * @see 09 - APP-FIRST架构改造计划.md
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { isBookCached } from '@/lib/bookStorage'

export type CacheStatus = 'cloud' | 'downloading' | 'ready'

interface BookCacheState {
  [bookId: string]: CacheStatus
}

export interface UseBookFileCacheReturn {
  /** 获取指定书籍的缓存状态 */
  getBookCacheStatus: (bookId: string) => CacheStatus
  /** 标记书籍正在下载 */
  markDownloading: (bookId: string) => void
  /** 标记书籍已下载完成 */
  markDownloaded: (bookId: string) => void
  /** 刷新缓存状态 */
  refresh: () => Promise<void>
  /** 是否正在加载初始状态 */
  isLoading: boolean
}

/**
 * 本地文件缓存状态管理 Hook
 *
 * @param bookIds - 需要追踪的书籍 ID 列表
 * @returns 缓存状态管理函数
 */
export function useBookFileCache(bookIds: string[]): UseBookFileCacheReturn {
  const [cacheState, setCacheState] = useState<BookCacheState>({})
  const [isLoading, setIsLoading] = useState(true)
  const mountedRef = useRef(true)

  // 加载缓存状态
  const loadCacheStatus = useCallback(async () => {
    if (bookIds.length === 0) {
      setCacheState({})
      setIsLoading(false)
      return
    }

    try {
      const results = await Promise.all(
        bookIds.map(async (bookId) => {
          const isCached = await isBookCached(bookId)
          return { bookId, isCached }
        })
      )

      if (!mountedRef.current) return

      const newState: BookCacheState = {}
      for (const { bookId, isCached } of results) {
        // 保留正在下载的状态
        if (cacheState[bookId] === 'downloading') {
          newState[bookId] = 'downloading'
        } else {
          newState[bookId] = isCached ? 'ready' : 'cloud'
        }
      }
      setCacheState(newState)
    } catch (error) {
      console.error('[useBookFileCache] Failed to load cache status:', error)
    } finally {
      if (mountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [bookIds, cacheState])

  // 初始化和 bookIds 变化时加载
  useEffect(() => {
    loadCacheStatus()
  }, [bookIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  // 监听缓存事件
  useEffect(() => {
    const handleBookCached = (event: CustomEvent<{ bookId: string }>) => {
      const { bookId } = event.detail
      setCacheState((prev) => ({
        ...prev,
        [bookId]: 'ready'
      }))
    }

    const handleBookDeleted = (event: CustomEvent<{ bookId: string }>) => {
      const { bookId } = event.detail
      setCacheState((prev) => ({
        ...prev,
        [bookId]: 'cloud'
      }))
    }

    window.addEventListener('book_cached', handleBookCached as EventListener)
    window.addEventListener('book_deleted', handleBookDeleted as EventListener)

    return () => {
      window.removeEventListener('book_cached', handleBookCached as EventListener)
      window.removeEventListener('book_deleted', handleBookDeleted as EventListener)
    }
  }, [])

  // 组件卸载标记
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // 获取缓存状态
  const getBookCacheStatus = useCallback(
    (bookId: string): CacheStatus => {
      return cacheState[bookId] || 'cloud'
    },
    [cacheState]
  )

  // 标记正在下载
  const markDownloading = useCallback((bookId: string) => {
    setCacheState((prev) => ({
      ...prev,
      [bookId]: 'downloading'
    }))
  }, [])

  // 标记已下载
  const markDownloaded = useCallback((bookId: string) => {
    setCacheState((prev) => ({
      ...prev,
      [bookId]: 'ready'
    }))
  }, [])

  return {
    getBookCacheStatus,
    markDownloading,
    markDownloaded,
    refresh: loadCacheStatus,
    isLoading
  }
}

// 兼容性导出（保持向后兼容）
export const useLocalBookCache = useBookFileCache

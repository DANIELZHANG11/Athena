/**
 * 本地书籍缓存 Hook
 *
 * 说明：
 * - 批量检查 IndexedDB 缓存并计算统计信息
 * - 提供标记下载中/已下载、删除缓存与 UI 状态映射
 * - 通过窗口事件 `book_cached` 通知其它模块刷新
 */
/**
 * useLocalBookCache
 * 管理本地书籍缓存状态的 Hook
 * 
 * 功能:
 * - 批量检查书籍是否已缓存到 IndexedDB
 * - 提供单本书籍的缓存操作（下载、删除）
 * - 监听缓存状态变化
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { isBookCached, deleteBookFile, getCacheStats, type CacheStats } from '@/lib/bookStorage'

export interface LocalCacheState {
  /** 已缓存的书籍 ID 集合 */
  cachedBookIds: Set<string>
  /** 正在下载的书籍 ID 集合 */
  downloadingBookIds: Set<string>
  /** 缓存统计信息 */
  stats: CacheStats | null
  /** 是否正在加载状态 */
  isLoading: boolean
}

export interface UseLocalBookCacheReturn extends LocalCacheState {
  /** 检查单本书是否已缓存 */
  isBookCachedLocally: (bookId: string) => boolean
  /** 检查单本书是否正在下载 */
  isBookDownloading: (bookId: string) => boolean
  /** 获取书籍在 UI 上应该显示的状态 */
  getBookCacheStatus: (bookId: string) => 'cloud' | 'downloading' | 'ready'
  /** 刷新缓存状态 */
  refresh: () => Promise<void>
  /** 标记某本书开始下载 */
  markDownloading: (bookId: string) => void
  /** 标记某本书下载完成 */
  markDownloaded: (bookId: string) => void
  /** 删除本地缓存 */
  removeFromCache: (bookId: string) => Promise<void>
}

export function useLocalBookCache(bookIds: string[]): UseLocalBookCacheReturn {
  const [state, setState] = useState<LocalCacheState>({
    cachedBookIds: new Set(),
    downloadingBookIds: new Set(),
    stats: null,
    isLoading: true,
  })
  
  const isMountedRef = useRef(true)
  // 使用 ref 来存储 bookIds，避免依赖数组引用变化导致无限循环
  const bookIdsRef = useRef<string[]>(bookIds)
  const bookIdsKey = bookIds.join(',')
  
  // 更新 ref
  useEffect(() => {
    bookIdsRef.current = bookIds
  }, [bookIdsKey])

  // 批量检查缓存状态
  const checkCacheStatus = useCallback(async () => {
    if (!isMountedRef.current) return
    const currentBookIds = bookIdsRef.current
    
    if (currentBookIds.length === 0) {
      setState(prev => ({ ...prev, isLoading: false }))
      return
    }
    
    try {
      const results = await Promise.all(
        currentBookIds.map(async (id) => {
          const cached = await isBookCached(id)
          return { id, cached }
        })
      )
      
      const cachedIds = new Set(
        results.filter(r => r.cached).map(r => r.id)
      )
      
      const stats = await getCacheStats()
      
      if (isMountedRef.current) {
        setState(prev => ({
          ...prev,
          cachedBookIds: cachedIds,
          stats,
          isLoading: false,
        }))
      }
    } catch (error) {
      console.error('[LocalBookCache] Failed to check cache status:', error)
      if (isMountedRef.current) {
        setState(prev => ({ ...prev, isLoading: false }))
      }
    }
  }, []) // 移除 bookIds 依赖，使用 ref 代替

  // 初始化和 bookIds 变化时检查
  useEffect(() => {
    isMountedRef.current = true
    checkCacheStatus()
    
    return () => {
      isMountedRef.current = false
    }
  }, [bookIdsKey, checkCacheStatus]) // 使用 bookIdsKey 字符串而非数组

  // 监听书籍下载完成事件
  useEffect(() => {
    const handleBookCached = (e: CustomEvent<{ bookId: string }>) => {
      const { bookId } = e.detail
      setState(prev => {
        const newCached = new Set(prev.cachedBookIds)
        newCached.add(bookId)
        const newDownloading = new Set(prev.downloadingBookIds)
        newDownloading.delete(bookId)
        return {
          ...prev,
          cachedBookIds: newCached,
          downloadingBookIds: newDownloading,
        }
      })
    }
    
    window.addEventListener('book_cached', handleBookCached as EventListener)
    return () => {
      window.removeEventListener('book_cached', handleBookCached as EventListener)
    }
  }, [])

  const isBookCachedLocally = useCallback((bookId: string): boolean => {
    return state.cachedBookIds.has(bookId)
  }, [state.cachedBookIds])

  const isBookDownloading = useCallback((bookId: string): boolean => {
    return state.downloadingBookIds.has(bookId)
  }, [state.downloadingBookIds])

  const getBookCacheStatus = useCallback((bookId: string): 'cloud' | 'downloading' | 'ready' => {
    if (state.downloadingBookIds.has(bookId)) return 'downloading'
    if (state.cachedBookIds.has(bookId)) return 'ready'
    return 'cloud'
  }, [state.cachedBookIds, state.downloadingBookIds])

  const markDownloading = useCallback((bookId: string) => {
    setState(prev => {
      const newDownloading = new Set(prev.downloadingBookIds)
      newDownloading.add(bookId)
      return { ...prev, downloadingBookIds: newDownloading }
    })
  }, [])

  const markDownloaded = useCallback((bookId: string) => {
    setState(prev => {
      const newCached = new Set(prev.cachedBookIds)
      newCached.add(bookId)
      const newDownloading = new Set(prev.downloadingBookIds)
      newDownloading.delete(bookId)
      return {
        ...prev,
        cachedBookIds: newCached,
        downloadingBookIds: newDownloading,
      }
    })
    // 广播事件
    window.dispatchEvent(new CustomEvent('book_cached', { detail: { bookId } }))
  }, [])

  const removeFromCache = useCallback(async (bookId: string) => {
    try {
      await deleteBookFile(bookId)
      setState(prev => {
        const newCached = new Set(prev.cachedBookIds)
        newCached.delete(bookId)
        return { ...prev, cachedBookIds: newCached }
      })
    } catch (error) {
      console.error('[LocalBookCache] Failed to remove from cache:', error)
      throw error
    }
  }, [])

  return {
    ...state,
    isBookCachedLocally,
    isBookDownloading,
    getBookCacheStatus,
    refresh: checkCacheStatus,
    markDownloading,
    markDownloaded,
    removeFromCache,
  }
}

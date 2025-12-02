/**
 * useReadingProgress
 * 阅读进度管理 Hook
 * 
 * 功能:
 * - 获取指定书籍的阅读进度
 * - 恢复上次阅读位置
 * - 提供进度百分比和位置信息
 */

import { useState, useEffect, useCallback } from 'react'
import api from '@/lib/api'

export interface ReadingProgressData {
  bookId: string
  progress: number        // 0-1 之间的进度值
  lastLocation: string | object | null  // EPUB CFI 或 PDF 页码（可能是字符串或对象）
  updatedAt: string
}

interface UseReadingProgressOptions {
  bookId: string
  enabled?: boolean
}

interface UseReadingProgressReturn {
  progress: ReadingProgressData | null
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useReadingProgress(options: UseReadingProgressOptions): UseReadingProgressReturn {
  const { bookId, enabled = true } = options
  
  const [progress, setProgress] = useState<ReadingProgressData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const fetchProgress = useCallback(async () => {
    if (!bookId || !enabled) return
    
    setIsLoading(true)
    setError(null)
    
    try {
      const response = await api.get('/reading-sessions/progress')
      const data = response.data?.data || []
      
      // 查找当前书籍的进度
      const bookProgress = data.find((item: any) => item.book_id === bookId)
      
      if (bookProgress) {
        console.log('[ReadingProgress] Found progress for book:', bookId, {
          progress: bookProgress.progress,
          lastLocation: bookProgress.last_location,
          lastLocationType: typeof bookProgress.last_location
        })
        setProgress({
          bookId: bookProgress.book_id,
          progress: bookProgress.progress,
          lastLocation: bookProgress.last_location,
          updatedAt: bookProgress.updated_at,
        })
      } else {
        setProgress(null)
        console.log('[ReadingProgress] No progress found for book:', bookId)
      }
    } catch (e: any) {
      console.error('[ReadingProgress] Failed to fetch:', e)
      setError(e.message || 'Failed to fetch reading progress')
    } finally {
      setIsLoading(false)
    }
  }, [bookId, enabled])
  
  useEffect(() => {
    fetchProgress()
  }, [fetchProgress])
  
  return {
    progress,
    isLoading,
    error,
    refetch: fetchProgress,
  }
}

/**
 * 解析 EPUB CFI 位置
 * location 可能是字符串（JSON 格式）或已解析的对象
 */
export function parseEpubLocation(location: string | object | null): { cfi: string } | null {
  if (!location) return null
  
  try {
    // 如果已经是对象
    if (typeof location === 'object') {
      const obj = location as any
      if (obj.cfi) {
        return { cfi: obj.cfi }
      }
      return null
    }
    
    // 如果是字符串
    if (typeof location === 'string') {
      // 尝试 JSON 解析
      try {
        const parsed = JSON.parse(location)
        if (parsed.cfi) {
          return { cfi: parsed.cfi }
        }
      } catch {
        // 可能是直接的 CFI 字符串
        if (location.startsWith('epubcfi')) {
          return { cfi: location }
        }
      }
    }
  } catch (e) {
    console.error('[parseEpubLocation] Error:', e)
  }
  
  return null
}

/**
 * 解析 PDF 页码位置
 * location 可能是字符串（JSON 格式）或已解析的对象
 */
export function parsePdfLocation(location: string | object | null): { page: number } | null {
  if (!location) return null
  
  try {
    // 如果已经是对象
    if (typeof location === 'object') {
      const obj = location as any
      if (typeof obj.page === 'number') {
        return { page: obj.page }
      }
      return null
    }
    
    // 如果是字符串
    if (typeof location === 'string') {
      try {
        const parsed = JSON.parse(location)
        if (typeof parsed.page === 'number') {
          return { page: parsed.page }
        }
      } catch {
        // 尝试直接解析数字
        const page = parseInt(location, 10)
        if (!isNaN(page)) {
          return { page }
        }
      }
    }
  } catch (e) {
    console.error('[parsePdfLocation] Error:', e)
  }
  
  return null
}

/**
 * 格式化阅读进度为百分比字符串
 */
export function formatProgress(progress: number): string {
  return `${Math.round(progress * 100)}%`
}

/**
 * 格式化阅读时间
 */
export function formatReadingTime(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  
  if (hours > 0) {
    return `${hours}小时${remainingMinutes}分钟`
  }
  return `${minutes}分钟`
}

export default useReadingProgress

/**
 * useProgressData - 阅读进度数据统一入口 Hook (PowerSync Only)
 *
 * 直接使用 PowerSync SQLite 作为唯一数据源
 * 替代原有的 useReadingProgress, useOfflineProgressV2 等
 *
 * @see 09 - APP-FIRST架构改造计划.md Phase 3
 */

import { useMemo, useCallback, useRef, useEffect } from 'react'
import { useQuery } from '@powersync/react'
import { usePowerSyncDatabase } from '@/lib/powersync'

// ============================================================================
// 类型定义
// ============================================================================

export interface ReadingProgressData {
  bookId: string
  currentCfi?: string
  currentPage?: number
  totalPages?: number
  percentage: number
  lastReadAt: string
}

interface ProgressRow {
  id: string
  book_id: string
  current_cfi: string | null
  current_page: number | null
  total_pages: number | null
  percentage: number
  last_read_at: string
  updated_at: string
}

// ============================================================================
// Hook 实现
// ============================================================================

/**
 * 获取书籍的阅读进度
 */
export function useProgressData(bookId: string | null) {
  const db = usePowerSyncDatabase()

  const { data, isLoading, error } = useQuery<ProgressRow>(
    bookId
      ? 'SELECT * FROM reading_progress WHERE book_id = ? ORDER BY updated_at DESC LIMIT 1'
      : 'SELECT * FROM reading_progress WHERE 1=0',
    bookId ? [bookId] : []
  )

  const progress: ReadingProgressData | null = useMemo(() => {
    if (!data?.[0]) return null

    const row = data[0]
    return {
      bookId: row.book_id,
      currentCfi: row.current_cfi ?? undefined,
      currentPage: row.current_page ?? undefined,
      totalPages: row.total_pages ?? undefined,
      percentage: row.percentage,
      lastReadAt: row.last_read_at,
    }
  }, [data])

  // 防抖保存进度
  const saveTimeoutRef = useRef<number | null>(null)
  const pendingUpdateRef = useRef<Partial<ReadingProgressData> | null>(null)

  // 保存进度（防抖 1 秒）
  const saveProgress = useCallback(async (
    updates: {
      currentCfi?: string
      currentPage?: number
      totalPages?: number
      percentage?: number
    },
    immediate = false
  ) => {
    if (!db || !bookId) {
      console.warn('[useProgressData] Cannot save: db or bookId not available')
      return
    }

    // 合并待处理更新
    pendingUpdateRef.current = {
      ...pendingUpdateRef.current,
      ...updates,
    }

    // 清除之前的定时器
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    const doSave = async () => {
      const pending = pendingUpdateRef.current
      if (!pending) return

      pendingUpdateRef.current = null
      const now = new Date().toISOString()

      try {
        // 检查是否已存在进度记录
        const existing = await db.get<{ id: string }>(
          'SELECT id FROM reading_progress WHERE book_id = ?',
          [bookId]
        )

        if (existing) {
          // 更新现有记录
          const fields: string[] = ['last_read_at = ?', 'updated_at = ?']
          const values: (string | number | null)[] = [now, now]

          if (pending.currentCfi !== undefined) {
            fields.push('current_cfi = ?')
            values.push(pending.currentCfi ?? null)
          }
          if (pending.currentPage !== undefined) {
            fields.push('current_page = ?')
            values.push(pending.currentPage ?? null)
          }
          if (pending.totalPages !== undefined) {
            fields.push('total_pages = ?')
            values.push(pending.totalPages ?? null)
          }
          if (pending.percentage !== undefined) {
            fields.push('percentage = ?')
            values.push(pending.percentage)
          }

          values.push(existing.id)
          await db.execute(
            `UPDATE reading_progress SET ${fields.join(', ')} WHERE id = ?`,
            values
          )
        } else {
          // 创建新记录
          const id = crypto.randomUUID()
          await db.execute(
            `INSERT INTO reading_progress (id, book_id, current_cfi, current_page, total_pages, percentage, last_read_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              bookId,
              pending.currentCfi ?? null,
              pending.currentPage ?? null,
              pending.totalPages ?? null,
              pending.percentage ?? 0,
              now,
              now
            ]
          )
        }

        console.log('[useProgressData] Progress saved:', { bookId, ...pending })
      } catch (err) {
        console.error('[useProgressData] Failed to save progress:', err)
      }
    }

    if (immediate) {
      await doSave()
    } else {
      // 防抖 1 秒
      saveTimeoutRef.current = setTimeout(doSave, 1000) as unknown as number
    }
  }, [db, bookId])

  // 组件卸载时保存待处理的更新
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      // 立即保存待处理的更新
      if (pendingUpdateRef.current && db && bookId) {
        const pending = pendingUpdateRef.current
        const now = new Date().toISOString()
        
        db.get<{ id: string }>('SELECT id FROM reading_progress WHERE book_id = ?', [bookId])
          .then(existing => {
            if (existing) {
              db.execute(
                'UPDATE reading_progress SET current_cfi = ?, current_page = ?, percentage = ?, last_read_at = ?, updated_at = ? WHERE id = ?',
                [pending.currentCfi ?? null, pending.currentPage ?? null, pending.percentage ?? 0, now, now, existing.id]
              )
            }
          })
          .catch(console.error)
      }
    }
  }, [db, bookId])

  return {
    progress,
    isLoading,
    error,
    saveProgress,
    isReady: !!db,
  }
}

/**
 * 获取所有阅读进度（用于首页显示）
 */
export function useAllProgressData(options: { limit?: number } = {}) {
  const db = usePowerSyncDatabase()
  const { limit = 10 } = options

  const sql = `
    SELECT rp.*, b.title as book_title, b.author as book_author, b.cover_path
    FROM reading_progress rp
    INNER JOIN books b ON rp.book_id = b.id
    WHERE b.deleted_at IS NULL
    ORDER BY rp.last_read_at DESC
    LIMIT ?
  `

  interface ProgressWithBook extends ProgressRow {
    book_title: string
    book_author: string | null
    cover_path: string | null
  }

  const { data, isLoading, error } = useQuery<ProgressWithBook>(sql, [limit])

  const recentBooks = useMemo(() => {
    if (!data) return []

    return data.map(row => ({
      bookId: row.book_id,
      title: row.book_title,
      author: row.book_author ?? undefined,
      coverPath: row.cover_path ?? undefined,
      percentage: row.percentage,
      currentPage: row.current_page ?? undefined,
      totalPages: row.total_pages ?? undefined,
      lastReadAt: row.last_read_at,
    }))
  }, [data])

  return {
    recentBooks,
    isLoading,
    error,
    isReady: !!db,
  }
}

/**
 * 记录阅读会话（开始/结束）
 */
export function useReadingSession(bookId: string | null) {
  const db = usePowerSyncDatabase()
  const sessionIdRef = useRef<string | null>(null)
  const startTimeRef = useRef<Date | null>(null)

  const startSession = useCallback(async () => {
    if (!db || !bookId) return null

    const id = crypto.randomUUID()
    const now = new Date()
    const isoNow = now.toISOString()

    try {
      await db.execute(
        `INSERT INTO reading_sessions (id, book_id, started_at, duration_seconds, pages_read, created_at)
         VALUES (?, ?, ?, 0, 0, ?)`,
        [id, bookId, isoNow, isoNow]
      )

      sessionIdRef.current = id
      startTimeRef.current = now
      console.log('[useReadingSession] Session started:', id)
      return id
    } catch (err) {
      console.error('[useReadingSession] Failed to start session:', err)
      return null
    }
  }, [db, bookId])

  const endSession = useCallback(async (pagesRead = 0) => {
    if (!db || !sessionIdRef.current || !startTimeRef.current) return

    const duration = Math.round((Date.now() - startTimeRef.current.getTime()) / 1000)
    const now = new Date().toISOString()

    try {
      await db.execute(
        'UPDATE reading_sessions SET ended_at = ?, duration_seconds = ?, pages_read = ? WHERE id = ?',
        [now, duration, pagesRead, sessionIdRef.current]
      )

      console.log('[useReadingSession] Session ended:', {
        id: sessionIdRef.current,
        duration,
        pagesRead
      })

      sessionIdRef.current = null
      startTimeRef.current = null
    } catch (err) {
      console.error('[useReadingSession] Failed to end session:', err)
    }
  }, [db])

  // 组件卸载时结束会话
  useEffect(() => {
    return () => {
      if (sessionIdRef.current && startTimeRef.current && db) {
        const duration = Math.round((Date.now() - startTimeRef.current.getTime()) / 1000)
        const now = new Date().toISOString()
        
        db.execute(
          'UPDATE reading_sessions SET ended_at = ?, duration_seconds = ? WHERE id = ?',
          [now, duration, sessionIdRef.current]
        ).catch(console.error)
      }
    }
  }, [db])

  return {
    startSession,
    endSession,
    isReady: !!db,
  }
}

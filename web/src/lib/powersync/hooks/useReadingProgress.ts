/**
 * useReadingProgress - 阅读进度 Live Query Hook
 *
 * 提供实时响应式的阅读进度数据查询
 * 支持 PowerSync (App-First) 和 Dexie (Legacy) 双模式
 *
 * @see 09 - APP-FIRST架构改造计划.md Phase 2
 */

import { useMemo } from 'react'
import { useQuery } from '@powersync/react'
import { usePowerSyncDatabase, useIsAppFirstEnabled } from '../PowerSyncProvider'

// ============================================================================
// 类型定义
// ============================================================================

export interface ReadingProgress {
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
export function useReadingProgress(bookId: string | null) {
  const isAppFirstEnabled = useIsAppFirstEnabled()
  const db = usePowerSyncDatabase()

  const { data, isLoading, error } = useQuery<ReadingProgress>(
    bookId
      ? 'SELECT * FROM reading_progress WHERE book_id = ? ORDER BY updated_at DESC LIMIT 1'
      : 'SELECT * FROM reading_progress WHERE 1=0',
    bookId ? [bookId] : []
  )

  if (!isAppFirstEnabled || !db || !bookId) {
    return {
      progress: null,
      isLoading: false,
      error: null,
      isAppFirstEnabled: false
    }
  }

  return {
    progress: data?.[0] ?? null,
    isLoading,
    error,
    isAppFirstEnabled: true
  }
}

/**
 * 获取所有阅读进度（用于首页展示最近阅读）
 */
export function useAllReadingProgress(options: { limit?: number; orderBy?: 'last_read_at' | 'percentage' } = {}) {
  const isAppFirstEnabled = useIsAppFirstEnabled()
  const db = usePowerSyncDatabase()

  const { limit = 10, orderBy = 'last_read_at' } = options

  const sql = useMemo(() => {
    return `SELECT * FROM reading_progress ORDER BY ${orderBy} DESC LIMIT ${limit}`
  }, [orderBy, limit])

  const { data, isLoading, error } = useQuery<ReadingProgress>(sql, [])

  if (!isAppFirstEnabled || !db) {
    return {
      progressList: [] as ReadingProgress[],
      isLoading: false,
      error: null,
      isAppFirstEnabled: false
    }
  }

  return {
    progressList: data ?? [],
    isLoading,
    error,
    isAppFirstEnabled: true
  }
}

/**
 * 获取最近阅读的书籍（带书籍信息）
 */
export function useRecentlyReadBooks(limit = 5) {
  const isAppFirstEnabled = useIsAppFirstEnabled()
  const db = usePowerSyncDatabase()

  const sql = `
    SELECT b.*, rp.percentage, rp.current_page, rp.last_read_at
    FROM reading_progress rp
    INNER JOIN books b ON rp.book_id = b.id
    WHERE b.deleted_at IS NULL
    ORDER BY rp.last_read_at DESC
    LIMIT ?
  `

  interface RecentBook {
    id: string
    title: string
    author: string | null
    cover_path: string | null
    percentage: number
    current_page: number | null
    last_read_at: string
  }

  const { data, isLoading, error } = useQuery<RecentBook>(sql, [limit])

  if (!isAppFirstEnabled || !db) {
    return {
      recentBooks: [] as RecentBook[],
      isLoading: false,
      error: null,
      isAppFirstEnabled: false
    }
  }

  return {
    recentBooks: data ?? [],
    isLoading,
    error,
    isAppFirstEnabled: true
  }
}

/**
 * 阅读进度写入操作
 */
export function useReadingProgressMutations() {
  const db = usePowerSyncDatabase()
  const isAppFirstEnabled = useIsAppFirstEnabled()

  const updateProgress = async (
    bookId: string,
    updates: {
      currentCfi?: string | null
      currentPage?: number | null
      totalPages?: number | null
      percentage?: number
    }
  ) => {
    if (!db || !isAppFirstEnabled) {
      throw new Error('PowerSync not available')
    }

    const now = new Date().toISOString()

    // 检查是否已存在进度记录
    const existing = await db.get<{ id: string }>(
      'SELECT id FROM reading_progress WHERE book_id = ?',
      [bookId]
    )

    if (existing) {
      // 更新现有记录
      const fields: string[] = []
      const values: (string | number | null)[] = []

      if (updates.currentCfi !== undefined) {
        fields.push('current_cfi = ?')
        values.push(updates.currentCfi)
      }
      if (updates.currentPage !== undefined) {
        fields.push('current_page = ?')
        values.push(updates.currentPage)
      }
      if (updates.totalPages !== undefined) {
        fields.push('total_pages = ?')
        values.push(updates.totalPages)
      }
      if (updates.percentage !== undefined) {
        fields.push('percentage = ?')
        values.push(updates.percentage)
      }

      fields.push('last_read_at = ?')
      values.push(now)
      fields.push('updated_at = ?')
      values.push(now)
      values.push(existing.id)

      await db.execute(
        `UPDATE reading_progress SET ${fields.join(', ')} WHERE id = ?`,
        values
      )

      return existing.id
    } else {
      // 创建新记录
      const id = crypto.randomUUID()

      await db.execute(
        `INSERT INTO reading_progress (id, book_id, current_cfi, current_page, total_pages, percentage, last_read_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          bookId,
          updates.currentCfi ?? null,
          updates.currentPage ?? null,
          updates.totalPages ?? null,
          updates.percentage ?? 0,
          now,
          now
        ]
      )

      return id
    }
  }

  const deleteProgress = async (bookId: string) => {
    if (!db || !isAppFirstEnabled) {
      throw new Error('PowerSync not available')
    }

    await db.execute('DELETE FROM reading_progress WHERE book_id = ?', [bookId])
  }

  return {
    updateProgress,
    deleteProgress,
    isAvailable: isAppFirstEnabled && !!db
  }
}

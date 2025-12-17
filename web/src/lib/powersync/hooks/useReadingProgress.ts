/**
 * useReadingProgress - 阅读进度 Live Query Hook
 *
 * ⚠️ 字段名必须与 PostgreSQL / PowerSync Schema 完全一致！
 * 
 * PostgreSQL reading_progress 表字段：
 * - id, user_id, book_id, device_id
 * - progress (REAL 0-1)
 * - last_position (TEXT) - CFI 字符串
 * - last_location (TEXT JSON) - { currentPage, totalPages }
 * - finished_at (TIMESTAMPTZ)
 * - updated_at (TIMESTAMPTZ)
 *
 * @see docker/powersync/sync_rules.yaml
 * @see web/src/lib/powersync/schema.ts
 */

import { useMemo } from 'react'
import { useQuery } from '@powersync/react'
import { usePowerSyncDatabase, useIsAppFirstEnabled } from '../PowerSyncProvider'
import { useAuthStore } from '@/stores/auth'
import { generateUUID, getDeviceId } from '@/lib/utils'

// ============================================================================
// 类型定义 - 与 PostgreSQL 完全一致
// ============================================================================

/**
 * reading_progress 表行结构
 * 字段名与 PostgreSQL 完全一致
 */
export interface ReadingProgressRow {
  id: string
  user_id: string
  book_id: string
  device_id: string | null
  progress: number              // REAL 0-1
  last_position: string | null  // CFI 字符串
  last_location: string | null  // JSON: { currentPage, totalPages }
  finished_at: string | null
  updated_at: string
}

// 向后兼容的别名
export type ReadingProgress = ReadingProgressRow

/**
 * 解析 last_location JSON
 */
function parseLastLocation(json: string | null): { currentPage?: number; totalPages?: number } {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json)
    return {
      currentPage: typeof parsed.currentPage === 'number' ? parsed.currentPage : undefined,
      totalPages: typeof parsed.totalPages === 'number' ? parsed.totalPages : undefined,
    }
  } catch {
    return {}
  }
}

/**
 * 构建 last_location JSON
 */
function buildLastLocation(currentPage?: number | null, totalPages?: number | null, existing?: string | null): string {
  const current = parseLastLocation(existing ?? null)
  return JSON.stringify({
    currentPage: currentPage ?? current.currentPage,
    totalPages: totalPages ?? current.totalPages,
  })
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
 * 使用正确字段名: progress, updated_at
 */
export function useAllReadingProgress(options: { limit?: number; orderBy?: 'updated_at' | 'progress' } = {}) {
  const isAppFirstEnabled = useIsAppFirstEnabled()
  const db = usePowerSyncDatabase()

  const { limit = 10, orderBy = 'updated_at' } = options

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
 * 使用正确字段名: progress, last_location, updated_at
 */
export function useRecentlyReadBooks(limit = 5) {
  const isAppFirstEnabled = useIsAppFirstEnabled()
  const db = usePowerSyncDatabase()

  // 使用与 PostgreSQL 一致的字段名
  const sql = `
    SELECT b.*, rp.progress, rp.last_location, rp.updated_at
    FROM reading_progress rp
    INNER JOIN books b ON rp.book_id = b.id
    WHERE b.deleted_at IS NULL
    ORDER BY rp.updated_at DESC
    LIMIT ?
  `

  interface RecentBook {
    id: string
    title: string
    author: string | null
    cover_url: string | null
    progress: number
    last_location: string | null
    updated_at: string
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
 * 使用与 PostgreSQL 一致的字段名: progress, last_position, last_location, updated_at
 */
export function useReadingProgressMutations() {
  const db = usePowerSyncDatabase()
  const isAppFirstEnabled = useIsAppFirstEnabled()

  /**
   * 更新阅读进度
   * 业务层参数会映射到 PostgreSQL 字段名
   */
  const updateProgress = async (
    bookId: string,
    updates: {
      currentCfi?: string | null      // → last_position
      currentPage?: number | null     // → last_location.currentPage
      totalPages?: number | null      // → last_location.totalPages
      percentage?: number             // → progress
    }
  ) => {
    if (!db || !isAppFirstEnabled) {
      throw new Error('PowerSync not available')
    }

    const now = new Date().toISOString()
    const userId = useAuthStore.getState().user?.id || ''
    const deviceId = getDeviceId()

    // 检查是否已存在进度记录 - 使用 book_id + user_id 匹配
    const existingRows = await db.getAll<{ id: string; last_location: string | null }>(
      'SELECT id, last_location FROM reading_progress WHERE book_id = ? AND user_id = ?',
      [bookId, userId]
    )
    const existing = existingRows[0]

    if (existing) {
      // 更新现有记录 - 使用 book_id + user_id 匹配
      const fields: string[] = []
      const values: (string | number | null)[] = []

      if (updates.currentCfi !== undefined) {
        fields.push('last_position = ?')  // 不是 current_cfi
        values.push(updates.currentCfi)
      }
      if (updates.currentPage !== undefined || updates.totalPages !== undefined) {
        fields.push('last_location = ?')  // 不是 current_page/total_pages
        values.push(buildLastLocation(updates.currentPage, updates.totalPages, existing.last_location))
      }
      if (updates.percentage !== undefined) {
        fields.push('progress = ?')  // 不是 percentage
        // 强制归一化：如果传入 > 1 的数（如25），除以100；如果是 0-1，保持不变
        const normalizedProgress = updates.percentage > 1 ? updates.percentage / 100 : updates.percentage
        values.push(normalizedProgress)
      }

      fields.push('updated_at = ?')  // 不是 last_read_at
      values.push(now)
      values.push(bookId)
      values.push(userId)

      await db.execute(
        `UPDATE reading_progress SET ${fields.join(', ')} WHERE book_id = ? AND user_id = ?`,
        values
      )

      return existing.id
    } else {
      // 创建新记录 - 使用 PostgreSQL 字段名
      const id = generateUUID()
      
      // 归一化进度值
      const rawProgress = updates.percentage ?? 0
      const normalizedProgress = rawProgress > 1 ? rawProgress / 100 : rawProgress

      await db.execute(
        `INSERT INTO reading_progress (id, user_id, device_id, book_id, last_position, last_location, progress, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          userId,
          deviceId,
          bookId,
          updates.currentCfi ?? null,
          buildLastLocation(updates.currentPage, updates.totalPages, null),
          normalizedProgress,
          now
        ]
      )

      return id
    }
  }

  /**
   * 标记书籍已读完
   * 修复：使用 book_id + user_id 进行匹配，而不是 id
   */
  const markAsFinished = async (bookId: string) => {
    if (!db || !isAppFirstEnabled) {
      throw new Error('PowerSync not available')
    }

    const now = new Date().toISOString()
    const userId = useAuthStore.getState().user?.id || ''
    const deviceId = getDeviceId()

    // 先查询是否存在记录 - 使用 book_id + user_id 匹配
    const existingRows = await db.getAll<{ id: string }>(
      'SELECT id FROM reading_progress WHERE book_id = ? AND user_id = ?',
      [bookId, userId]
    )
    const existing = existingRows[0]

    if (existing) {
      // 更新现有记录 - 使用 book_id + user_id 匹配
      await db.execute(
        'UPDATE reading_progress SET progress = 1.0, finished_at = ?, updated_at = ? WHERE book_id = ? AND user_id = ?',
        [now, now, bookId, userId]
      )
      return existing.id
    } else {
      // 插入新记录
      const id = generateUUID()

      await db.execute(
        `INSERT INTO reading_progress (id, user_id, device_id, book_id, progress, finished_at, updated_at)
         VALUES (?, ?, ?, ?, 1.0, ?, ?)`,
        [id, userId, deviceId, bookId, now, now]
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

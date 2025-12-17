/**
 * useHighlights - 高亮 Live Query Hook
 *
 * 提供实时响应式的高亮数据查询
 * 支持 PowerSync (App-First) 和 Dexie (Legacy) 双模式
 *
 * @see 09 - APP-FIRST架构改造计划.md Phase 2
 */

import { useMemo } from 'react'
import { useQuery } from '@powersync/react'
import { usePowerSyncDatabase, useIsAppFirstEnabled } from '../PowerSyncProvider'
import { useAuthStore } from '@/stores/auth'
import { generateUUID, getDeviceId } from '@/lib/utils'

// ============================================================================
// 类型定义
// ============================================================================

export interface Highlight {
  id: string
  book_id: string
  chapter_index: number | null
  cfi_range: string
  page_number: number | null
  text_content: string
  color: string
  note: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface UseHighlightsOptions {
  /** 按书籍 ID 筛选 */
  bookId?: string
  /** 按章节筛选 */
  chapterIndex?: number
  /** 按颜色筛选 */
  color?: string
  /** 是否包含已删除的高亮 */
  includeDeleted?: boolean
  /** 排序字段 */
  orderBy?: 'created_at' | 'updated_at' | 'page_number'
  /** 排序方向 */
  orderDirection?: 'asc' | 'desc'
  /** 限制数量 */
  limit?: number
}

// ============================================================================
// Hook 实现
// ============================================================================

/**
 * 获取高亮列表
 */
export function useHighlights(options: UseHighlightsOptions = {}) {
  const isAppFirstEnabled = useIsAppFirstEnabled()
  const db = usePowerSyncDatabase()

  const {
    bookId,
    chapterIndex,
    color,
    includeDeleted = false,
    orderBy = 'created_at',
    orderDirection = 'desc',
    limit
  } = options

  // 构建 SQL 查询
  const { sql, params } = useMemo(() => {
    let query = 'SELECT * FROM highlights'
    const conditions: string[] = []
    const queryParams: (string | number)[] = []

    if (!includeDeleted) {
      conditions.push('deleted_at IS NULL')
    }

    if (bookId) {
      conditions.push('book_id = ?')
      queryParams.push(bookId)
    }

    if (chapterIndex !== undefined) {
      conditions.push('chapter_index = ?')
      queryParams.push(chapterIndex)
    }

    if (color) {
      conditions.push('color = ?')
      queryParams.push(color)
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    query += ` ORDER BY ${orderBy} ${orderDirection.toUpperCase()}`

    if (limit) {
      query += ` LIMIT ${limit}`
    }

    return { sql: query, params: queryParams }
  }, [bookId, chapterIndex, color, includeDeleted, orderBy, orderDirection, limit])

  // PowerSync Live Query
  const { data, isLoading, error } = useQuery<Highlight>(sql, params)

  if (!isAppFirstEnabled || !db) {
    return {
      highlights: [] as Highlight[],
      isLoading: false,
      error: null,
      isAppFirstEnabled: false
    }
  }

  return {
    highlights: data ?? [],
    isLoading,
    error,
    isAppFirstEnabled: true
  }
}

/**
 * 获取单条高亮
 */
export function useHighlight(highlightId: string | null) {
  const isAppFirstEnabled = useIsAppFirstEnabled()
  const db = usePowerSyncDatabase()

  const { data, isLoading, error } = useQuery<Highlight>(
    highlightId ? 'SELECT * FROM highlights WHERE id = ?' : 'SELECT * FROM highlights WHERE 1=0',
    highlightId ? [highlightId] : []
  )

  if (!isAppFirstEnabled || !db || !highlightId) {
    return {
      highlight: null,
      isLoading: false,
      error: null,
      isAppFirstEnabled: false
    }
  }

  return {
    highlight: data?.[0] ?? null,
    isLoading,
    error,
    isAppFirstEnabled: true
  }
}

/**
 * 获取书籍的高亮数量
 */
export function useHighlightCount(bookId?: string) {
  const isAppFirstEnabled = useIsAppFirstEnabled()
  const db = usePowerSyncDatabase()

  const sql = bookId
    ? 'SELECT COUNT(*) as count FROM highlights WHERE book_id = ? AND deleted_at IS NULL'
    : 'SELECT COUNT(*) as count FROM highlights WHERE deleted_at IS NULL'

  const params = bookId ? [bookId] : []

  const { data, isLoading, error } = useQuery<{ count: number }>(sql, params)

  if (!isAppFirstEnabled || !db) {
    return {
      count: 0,
      isLoading: false,
      error: null,
      isAppFirstEnabled: false
    }
  }

  return {
    count: data?.[0]?.count ?? 0,
    isLoading,
    error,
    isAppFirstEnabled: true
  }
}

/**
 * 高亮写入操作
 */
export function useHighlightMutations() {
  const db = usePowerSyncDatabase()
  const isAppFirstEnabled = useIsAppFirstEnabled()

  const addHighlight = async (highlight: Omit<Highlight, 'id' | 'created_at' | 'updated_at' | 'deleted_at'> & { id?: string }) => {
    if (!db || !isAppFirstEnabled) {
      throw new Error('PowerSync not available')
    }

    const id = highlight.id || generateUUID()
    const now = new Date().toISOString()
    // 使用正确的 user_id 和 device_id - 从 AuthStore 和 localStorage 获取
    const userId = useAuthStore.getState().user?.id || ''
    const deviceId = getDeviceId()

    await db.execute(
      `INSERT INTO highlights (id, user_id, device_id, book_id, chapter_index, cfi_range, page_number, text_content, color, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        deviceId,
        highlight.book_id,
        highlight.chapter_index,
        highlight.cfi_range,
        highlight.page_number,
        highlight.text_content,
        highlight.color,
        highlight.note,
        now,
        now
      ]
    )

    return id
  }

  const updateHighlight = async (id: string, updates: Partial<Highlight>) => {
    if (!db || !isAppFirstEnabled) {
      throw new Error('PowerSync not available')
    }

    const fields = Object.keys(updates).filter(k => k !== 'id' && k !== 'created_at')
    if (fields.length === 0) return

    const setClause = fields.map(f => `${f} = ?`).join(', ')
    const values = fields.map(f => updates[f as keyof Highlight])
    values.push(new Date().toISOString()) // updated_at
    values.push(id)

    await db.execute(
      `UPDATE highlights SET ${setClause}, updated_at = ? WHERE id = ?`,
      values
    )
  }

  const deleteHighlight = async (id: string, soft = true) => {
    if (!db || !isAppFirstEnabled) {
      throw new Error('PowerSync not available')
    }

    if (soft) {
      await db.execute(
        'UPDATE highlights SET deleted_at = ?, updated_at = ? WHERE id = ?',
        [new Date().toISOString(), new Date().toISOString(), id]
      )
    } else {
      await db.execute('DELETE FROM highlights WHERE id = ?', [id])
    }
  }

  return {
    addHighlight,
    updateHighlight,
    deleteHighlight,
    isAvailable: isAppFirstEnabled && !!db
  }
}

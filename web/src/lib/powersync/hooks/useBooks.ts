/**
 * useBooks - 书籍 Live Query Hook
 *
 * 提供实时响应式的书籍数据查询
 * 支持 PowerSync (App-First) 和 Dexie (Legacy) 双模式
 *
 * @see 09 - APP-FIRST架构改造计划.md Phase 2
 */

import { useMemo } from 'react'
import { useQuery } from '@powersync/react'
import { usePowerSyncDatabase, useIsAppFirstEnabled } from '../PowerSyncProvider'
import { useAuthStore } from '@/stores/auth'
import { generateUUID } from '@/lib/utils'

// ============================================================================
// 类型定义
// ============================================================================

/**
 * books 表结构 - 与 PostgreSQL/PowerSync Schema 完全一致
 * @see docker/powersync/sync_rules.yaml
 * @see web/src/lib/powersync/schema.ts
 */
export interface Book {
  id: string
  user_id: string
  title: string
  author: string | null
  cover_url: string | null        // 不是 cover_path
  file_type: string | null        // 不是 format
  file_size: number | null
  content_sha256: string | null   // 不是 file_hash
  storage_key: string | null      // 不是 file_path
  metadata_confirmed: number | null
  is_digitalized: number | null
  initial_digitalization_confidence: number | null
  page_count: number | null       // 不是 total_pages
  ocr_status: string | null
  conversion_status: string | null
  converted_epub_key: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface UseBookOptions {
  /** 是否包含已删除的书籍 */
  includeDeleted?: boolean
  /** 排序字段 */
  orderBy?: 'title' | 'author' | 'created_at' | 'updated_at'
  /** 排序方向 */
  orderDirection?: 'asc' | 'desc'
  /** 搜索关键词 */
  search?: string
  /** 限制数量 */
  limit?: number
}

// ============================================================================
// Hook 实现
// ============================================================================

/**
 * 获取所有书籍列表
 */
export function useBooks(options: UseBookOptions = {}) {
  const isAppFirstEnabled = useIsAppFirstEnabled()
  const db = usePowerSyncDatabase()

  const {
    includeDeleted = false,
    orderBy = 'updated_at',
    orderDirection = 'desc',
    search,
    limit
  } = options

  // 构建 SQL 查询
  const sql = useMemo(() => {
    let query = 'SELECT * FROM books'
    const conditions: string[] = []

    if (!includeDeleted) {
      conditions.push('deleted_at IS NULL')
    }

    if (search) {
      conditions.push("(title LIKE ? OR author LIKE ?)")
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    query += ` ORDER BY ${orderBy} ${orderDirection.toUpperCase()}`

    if (limit) {
      query += ` LIMIT ${limit}`
    }

    return query
  }, [includeDeleted, search, orderBy, orderDirection, limit])

  // 构建参数
  const params = useMemo(() => {
    if (search) {
      const searchPattern = `%${search}%`
      return [searchPattern, searchPattern]
    }
    return []
  }, [search])

  // PowerSync Live Query
  const { data, isLoading, error } = useQuery<Book>(sql, params)

  // 如果 App-First 未启用，返回空数据（Dexie fallback 由上层处理）
  if (!isAppFirstEnabled || !db) {
    return {
      books: [] as Book[],
      isLoading: false,
      error: null,
      isAppFirstEnabled: false
    }
  }

  return {
    books: data ?? [],
    isLoading,
    error,
    isAppFirstEnabled: true
  }
}

/**
 * 获取单本书籍
 */
export function useBook(bookId: string | null) {
  const isAppFirstEnabled = useIsAppFirstEnabled()
  const db = usePowerSyncDatabase()

  const { data, isLoading, error } = useQuery<Book>(
    bookId ? 'SELECT * FROM books WHERE id = ?' : 'SELECT * FROM books WHERE 1=0',
    bookId ? [bookId] : []
  )

  if (!isAppFirstEnabled || !db || !bookId) {
    return {
      book: null,
      isLoading: false,
      error: null,
      isAppFirstEnabled: false
    }
  }

  return {
    book: data?.[0] ?? null,
    isLoading,
    error,
    isAppFirstEnabled: true
  }
}

/**
 * 获取书籍数量
 */
export function useBookCount() {
  const isAppFirstEnabled = useIsAppFirstEnabled()
  const db = usePowerSyncDatabase()

  const { data, isLoading, error } = useQuery<{ count: number }>(
    'SELECT COUNT(*) as count FROM books WHERE deleted_at IS NULL',
    []
  )

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
 * 书籍写入操作（需要在组件中使用）
 */
export function useBookMutations() {
  const db = usePowerSyncDatabase()
  const isAppFirstEnabled = useIsAppFirstEnabled()

  /**
   * 添加书籍 - 使用与 PostgreSQL 一致的字段名
   */
  const addBook = async (book: Partial<Book> & { title: string }) => {
    if (!db || !isAppFirstEnabled) {
      throw new Error('PowerSync not available')
    }

    const id = book.id || generateUUID()
    const now = new Date().toISOString()
    const userId = useAuthStore.getState().user?.id || ''

    await db.execute(
      `INSERT INTO books (id, user_id, title, author, cover_url, file_type, file_size, content_sha256, storage_key, page_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        book.title,
        book.author ?? null,
        book.cover_url ?? null,
        book.file_type ?? null,
        book.file_size ?? null,
        book.content_sha256 ?? null,
        book.storage_key ?? null,
        book.page_count ?? null,
        now,
        now
      ]
    )

    return id
  }

  const updateBook = async (id: string, updates: Partial<Book>) => {
    if (!db || !isAppFirstEnabled) {
      throw new Error('PowerSync not available')
    }

    const fields = Object.keys(updates).filter(k => k !== 'id' && k !== 'created_at')
    if (fields.length === 0) return

    const setClause = fields.map(f => `${f} = ?`).join(', ')
    const values = fields.map(f => updates[f as keyof Book])
    values.push(new Date().toISOString()) // updated_at
    values.push(id)

    await db.execute(
      `UPDATE books SET ${setClause}, updated_at = ? WHERE id = ?`,
      values
    )
  }

  const deleteBook = async (id: string, soft = true) => {
    if (!db || !isAppFirstEnabled) {
      throw new Error('PowerSync not available')
    }

    if (soft) {
      await db.execute(
        'UPDATE books SET deleted_at = ?, updated_at = ? WHERE id = ?',
        [new Date().toISOString(), new Date().toISOString(), id]
      )
    } else {
      await db.execute('DELETE FROM books WHERE id = ?', [id])
    }
  }

  return {
    addBook,
    updateBook,
    deleteBook,
    isAvailable: isAppFirstEnabled && !!db
  }
}

/**
 * useShelves - 书架 Live Query Hook
 *
 * 提供实时响应式的书架数据查询
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

export interface Shelf {
  id: string
  name: string
  description: string | null
  color: string | null
  icon: string | null
  sort_order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface ShelfBook {
  id: string
  shelf_id: string
  book_id: string
  sort_order: number
  added_at: string
}

export interface ShelfWithBooks extends Shelf {
  bookCount: number
}

// ============================================================================
// Hook 实现
// ============================================================================

/**
 * 获取所有书架
 */
export function useShelves(options: { includeDeleted?: boolean } = {}) {
  const isAppFirstEnabled = useIsAppFirstEnabled()
  const db = usePowerSyncDatabase()

  const { includeDeleted = false } = options

  const sql = includeDeleted
    ? 'SELECT * FROM shelves ORDER BY sort_order ASC, name ASC'
    : 'SELECT * FROM shelves WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC'

  const { data, isLoading, error } = useQuery<Shelf>(sql, [])

  if (!isAppFirstEnabled || !db) {
    return {
      shelves: [] as Shelf[],
      isLoading: false,
      error: null,
      isAppFirstEnabled: false
    }
  }

  return {
    shelves: data ?? [],
    isLoading,
    error,
    isAppFirstEnabled: true
  }
}

/**
 * 获取书架及其书籍数量
 */
export function useShelvesWithBookCount() {
  const isAppFirstEnabled = useIsAppFirstEnabled()
  const db = usePowerSyncDatabase()

  const sql = `
    SELECT s.*, COALESCE(sb.book_count, 0) as bookCount
    FROM shelves s
    LEFT JOIN (
      SELECT shelf_id, COUNT(*) as book_count
      FROM shelf_books
      GROUP BY shelf_id
    ) sb ON s.id = sb.shelf_id
    WHERE s.deleted_at IS NULL
    ORDER BY s.sort_order ASC, s.name ASC
  `

  const { data, isLoading, error } = useQuery<ShelfWithBooks>(sql, [])

  if (!isAppFirstEnabled || !db) {
    return {
      shelves: [] as ShelfWithBooks[],
      isLoading: false,
      error: null,
      isAppFirstEnabled: false
    }
  }

  return {
    shelves: data ?? [],
    isLoading,
    error,
    isAppFirstEnabled: true
  }
}

/**
 * 获取单个书架
 */
export function useShelf(shelfId: string | null) {
  const isAppFirstEnabled = useIsAppFirstEnabled()
  const db = usePowerSyncDatabase()

  const { data, isLoading, error } = useQuery<Shelf>(
    shelfId ? 'SELECT * FROM shelves WHERE id = ?' : 'SELECT * FROM shelves WHERE 1=0',
    shelfId ? [shelfId] : []
  )

  if (!isAppFirstEnabled || !db || !shelfId) {
    return {
      shelf: null,
      isLoading: false,
      error: null,
      isAppFirstEnabled: false
    }
  }

  return {
    shelf: data?.[0] ?? null,
    isLoading,
    error,
    isAppFirstEnabled: true
  }
}

/**
 * 获取书架中的书籍 ID 列表
 */
export function useShelfBookIds(shelfId: string | null) {
  const isAppFirstEnabled = useIsAppFirstEnabled()
  const db = usePowerSyncDatabase()

  const sql = shelfId
    ? 'SELECT book_id FROM shelf_books WHERE shelf_id = ? ORDER BY sort_order ASC'
    : 'SELECT book_id FROM shelf_books WHERE 1=0'

  const { data, isLoading, error } = useQuery<{ book_id: string }>(
    sql,
    shelfId ? [shelfId] : []
  )

  const bookIds = useMemo(() => data?.map(row => row.book_id) ?? [], [data])

  if (!isAppFirstEnabled || !db || !shelfId) {
    return {
      bookIds: [] as string[],
      isLoading: false,
      error: null,
      isAppFirstEnabled: false
    }
  }

  return {
    bookIds,
    isLoading,
    error,
    isAppFirstEnabled: true
  }
}

/**
 * 获取书籍所属的书架列表
 */
export function useBookShelves(bookId: string | null) {
  const isAppFirstEnabled = useIsAppFirstEnabled()
  const db = usePowerSyncDatabase()

  const sql = bookId
    ? `
      SELECT s.*
      FROM shelves s
      INNER JOIN shelf_books sb ON s.id = sb.shelf_id
      WHERE sb.book_id = ? AND s.deleted_at IS NULL
      ORDER BY s.name ASC
    `
    : 'SELECT * FROM shelves WHERE 1=0'

  const { data, isLoading, error } = useQuery<Shelf>(sql, bookId ? [bookId] : [])

  if (!isAppFirstEnabled || !db || !bookId) {
    return {
      shelves: [] as Shelf[],
      isLoading: false,
      error: null,
      isAppFirstEnabled: false
    }
  }

  return {
    shelves: data ?? [],
    isLoading,
    error,
    isAppFirstEnabled: true
  }
}

/**
 * 书架写入操作
 */
export function useShelfMutations() {
  const db = usePowerSyncDatabase()
  const isAppFirstEnabled = useIsAppFirstEnabled()

  const addShelf = async (shelf: { name: string; description?: string; color?: string; icon?: string }) => {
    if (!db || !isAppFirstEnabled) {
      throw new Error('PowerSync not available')
    }

    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    // 获取最大排序值
    const maxOrder = await db.get<{ max_order: number }>(
      'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM shelves'
    )

    await db.execute(
      `INSERT INTO shelves (id, name, description, color, icon, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        shelf.name,
        shelf.description ?? null,
        shelf.color ?? null,
        shelf.icon ?? null,
        (maxOrder?.max_order ?? 0) + 1,
        now,
        now
      ]
    )

    return id
  }

  const updateShelf = async (id: string, updates: Partial<Omit<Shelf, 'id' | 'created_at'>>) => {
    if (!db || !isAppFirstEnabled) {
      throw new Error('PowerSync not available')
    }

    const fields = Object.keys(updates).filter(k => k !== 'id' && k !== 'created_at')
    if (fields.length === 0) return

    const setClause = fields.map(f => `${f} = ?`).join(', ')
    const values = fields.map(f => updates[f as keyof typeof updates])
    values.push(new Date().toISOString()) // updated_at
    values.push(id)

    await db.execute(
      `UPDATE shelves SET ${setClause}, updated_at = ? WHERE id = ?`,
      values
    )
  }

  const deleteShelf = async (id: string, soft = true) => {
    if (!db || !isAppFirstEnabled) {
      throw new Error('PowerSync not available')
    }

    if (soft) {
      await db.execute(
        'UPDATE shelves SET deleted_at = ?, updated_at = ? WHERE id = ?',
        [new Date().toISOString(), new Date().toISOString(), id]
      )
    } else {
      // 先删除书架-书籍关联
      await db.execute('DELETE FROM shelf_books WHERE shelf_id = ?', [id])
      await db.execute('DELETE FROM shelves WHERE id = ?', [id])
    }
  }

  const addBookToShelf = async (shelfId: string, bookId: string) => {
    if (!db || !isAppFirstEnabled) {
      throw new Error('PowerSync not available')
    }

    // 检查是否已存在
    const existing = await db.get<{ id: string }>(
      'SELECT id FROM shelf_books WHERE shelf_id = ? AND book_id = ?',
      [shelfId, bookId]
    )

    if (existing) return existing.id

    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    // 获取最大排序值
    const maxOrder = await db.get<{ max_order: number }>(
      'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM shelf_books WHERE shelf_id = ?',
      [shelfId]
    )

    await db.execute(
      `INSERT INTO shelf_books (id, shelf_id, book_id, sort_order, added_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, shelfId, bookId, (maxOrder?.max_order ?? 0) + 1, now]
    )

    return id
  }

  const removeBookFromShelf = async (shelfId: string, bookId: string) => {
    if (!db || !isAppFirstEnabled) {
      throw new Error('PowerSync not available')
    }

    await db.execute(
      'DELETE FROM shelf_books WHERE shelf_id = ? AND book_id = ?',
      [shelfId, bookId]
    )
  }

  return {
    addShelf,
    updateShelf,
    deleteShelf,
    addBookToShelf,
    removeBookFromShelf,
    isAvailable: isAppFirstEnabled && !!db
  }
}

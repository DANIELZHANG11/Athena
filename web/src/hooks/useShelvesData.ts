/**
 * useShelvesData - 书架数据统一入口 Hook (PowerSync Only)
 *
 * 直接使用 PowerSync SQLite 作为唯一数据源
 * 替代原有的 useOfflineShelves, useOfflineShelvesV2 等
 *
 * @see 09 - APP-FIRST架构改造计划.md Phase 3
 */

import { useMemo, useCallback } from 'react'
import { useQuery } from '@powersync/react'
import { usePowerSyncDatabase, usePowerSyncState } from '@/lib/powersync'
import { useAuthStore } from '@/stores/auth'
import { generateUUID } from '@/lib/utils'

// ============================================================================
// 类型定义
// ============================================================================

export interface ShelfData {
  id: string
  name: string
  description?: string
  color?: string
  icon?: string
  sortOrder: number
  bookCount: number
  createdAt: string
  updatedAt: string
}

export interface ShelfBookData {
  bookId: string
  title: string
  author?: string
  coverPath?: string
  addedAt: string
}

interface ShelfRow {
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

interface ShelfWithCountRow extends ShelfRow {
  book_count: number
}

interface ShelfBookRow {
  id: string
  shelf_id: string
  book_id: string
  sort_order: number
  added_at: string
  // 关联的书籍信息
  title: string
  author: string | null
  cover_path: string | null
}

// ============================================================================
// Hook 实现
// ============================================================================

/**
 * 获取所有书架列表（带书籍数量）
 */
export function useShelvesData() {
  const db = usePowerSyncDatabase()
  const { isInitialized } = usePowerSyncState()
  const isReady = isInitialized && db !== null

  const EMPTY_QUERY = 'SELECT * FROM shelves WHERE 1=0'
  
  const sql = isReady
    ? `
    SELECT s.*, COALESCE(sb.book_count, 0) as book_count
    FROM shelves s
    LEFT JOIN (
      SELECT shelf_id, COUNT(*) as book_count
      FROM shelf_books
      GROUP BY shelf_id
    ) sb ON s.id = sb.shelf_id
    WHERE s.deleted_at IS NULL
    ORDER BY s.sort_order ASC, s.name ASC
  `
    : EMPTY_QUERY

  const { data, isLoading, error } = useQuery<ShelfWithCountRow>(sql, [])

  const shelves: ShelfData[] = useMemo(() => {
    if (!data) return []

    return data.map((row): ShelfData => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      color: row.color ?? undefined,
      icon: row.icon ?? undefined,
      sortOrder: row.sort_order,
      bookCount: row.book_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }, [data])

  // 创建书架
  const createShelf = useCallback(async (shelf: { name: string; description?: string; color?: string; icon?: string }) => {
    if (!db) throw new Error('Database not available')

    const id = generateUUID()
    const now = new Date().toISOString()
    // 使用正确的 user_id - 从 AuthStore 获取
    const userId = useAuthStore.getState().user?.id || ''

    // 获取最大排序值 - 使用 getAll 避免空结果异常
    const maxOrderRows = await db.getAll<{ max_order: number }>(
      'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM shelves'
    )
    const maxOrder = maxOrderRows[0]?.max_order ?? 0

    await db.execute(
      `INSERT INTO shelves (id, user_id, name, description, color, icon, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        shelf.name,
        shelf.description ?? null,
        shelf.color ?? null,
        shelf.icon ?? null,
        maxOrder + 1,
        now,
        now
      ]
    )

    return id
  }, [db])

  // 更新书架
  const updateShelf = useCallback(async (id: string, updates: Partial<Omit<ShelfData, 'id' | 'createdAt' | 'bookCount'>>) => {
    if (!db) throw new Error('Database not available')

    const now = new Date().toISOString()
    const fields: string[] = ['updated_at = ?']
    const values: (string | number | null)[] = [now]

    if (updates.name !== undefined) {
      fields.push('name = ?')
      values.push(updates.name)
    }
    if (updates.description !== undefined) {
      fields.push('description = ?')
      values.push(updates.description ?? null)
    }
    if (updates.color !== undefined) {
      fields.push('color = ?')
      values.push(updates.color ?? null)
    }
    if (updates.icon !== undefined) {
      fields.push('icon = ?')
      values.push(updates.icon ?? null)
    }
    if (updates.sortOrder !== undefined) {
      fields.push('sort_order = ?')
      values.push(updates.sortOrder)
    }

    values.push(id)
    await db.execute(`UPDATE shelves SET ${fields.join(', ')} WHERE id = ?`, values)
  }, [db])

  // 删除书架
  const deleteShelf = useCallback(async (id: string) => {
    if (!db) throw new Error('Database not available')

    const now = new Date().toISOString()
    await db.execute(
      'UPDATE shelves SET deleted_at = ?, updated_at = ? WHERE id = ?',
      [now, now, id]
    )
  }, [db])

  return {
    shelves,
    isLoading: !isReady || isLoading,
    error,
    createShelf,
    updateShelf,
    deleteShelf,
    isReady,
  }
}

/**
 * 获取书架详情及其书籍
 */
export function useShelfData(shelfId: string | null) {
  const db = usePowerSyncDatabase()
  const userId = useAuthStore(s => s.user?.id)

  // 书架信息
  const { data: shelfData, isLoading: shelfLoading } = useQuery<ShelfRow>(
    shelfId ? 'SELECT * FROM shelves WHERE id = ? AND deleted_at IS NULL' : 'SELECT * FROM shelves WHERE 1=0',
    shelfId ? [shelfId] : []
  )

  // 书架中的书籍
  const booksSql = shelfId
    ? `
      SELECT sb.*, b.title, b.author, b.cover_path
      FROM shelf_books sb
      INNER JOIN books b ON sb.book_id = b.id
      WHERE sb.shelf_id = ? AND b.deleted_at IS NULL
      ORDER BY sb.sort_order ASC, sb.added_at DESC
    `
    : 'SELECT * FROM shelf_books WHERE 1=0'

  const { data: booksData, isLoading: booksLoading } = useQuery<ShelfBookRow>(
    booksSql,
    shelfId ? [shelfId] : []
  )

  const shelf: ShelfData | null = useMemo(() => {
    if (!shelfData?.[0]) return null

    const row = shelfData[0]
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      color: row.color ?? undefined,
      icon: row.icon ?? undefined,
      sortOrder: row.sort_order,
      bookCount: booksData?.length ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }, [shelfData, booksData])

  const books: ShelfBookData[] = useMemo(() => {
    if (!booksData) return []

    return booksData.map((row): ShelfBookData => ({
      bookId: row.book_id,
      title: row.title,
      author: row.author ?? undefined,
      coverPath: row.cover_path ?? undefined,
      addedAt: row.added_at,
    }))
  }, [booksData])

  // 添加书籍到书架
  const addBook = useCallback(async (bookId: string) => {
    if (!db || !shelfId || !userId) throw new Error('Database, shelfId or userId not available')

    // 检查是否已存在 - 使用 getAll 避免空结果异常
    const existingRows = await db.getAll<{ id: string }>(
      'SELECT id FROM shelf_books WHERE shelf_id = ? AND book_id = ?',
      [shelfId, bookId]
    )

    if (existingRows.length > 0) return existingRows[0].id

    const id = generateUUID()
    const now = new Date().toISOString()

    // 获取最大排序值 - 使用 getAll 避免空结果异常
    const maxOrderRows = await db.getAll<{ max_order: number }>(
      'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM shelf_books WHERE shelf_id = ?',
      [shelfId]
    )
    const maxOrder = maxOrderRows[0]?.max_order ?? 0

    await db.execute(
      `INSERT INTO shelf_books (id, user_id, shelf_id, book_id, sort_order, added_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, userId, shelfId, bookId, maxOrder + 1, now]
    )

    return id
  }, [db, shelfId, userId])

  // 从书架移除书籍
  const removeBook = useCallback(async (bookId: string) => {
    if (!db || !shelfId) throw new Error('Database or shelfId not available')

    await db.execute(
      'DELETE FROM shelf_books WHERE shelf_id = ? AND book_id = ?',
      [shelfId, bookId]
    )
  }, [db, shelfId])

  // 更新书籍排序
  const reorderBooks = useCallback(async (bookIds: string[]) => {
    if (!db || !shelfId) throw new Error('Database or shelfId not available')

    // 批量更新排序
    for (let i = 0; i < bookIds.length; i++) {
      await db.execute(
        'UPDATE shelf_books SET sort_order = ? WHERE shelf_id = ? AND book_id = ?',
        [i + 1, shelfId, bookIds[i]]
      )
    }
  }, [db, shelfId])

  return {
    shelf,
    books,
    isLoading: shelfLoading || booksLoading,
    addBook,
    removeBook,
    reorderBooks,
    isReady: !!db,
  }
}

/**
 * 获取书籍所属的书架列表
 */
export function useBookShelvesData(bookId: string | null) {
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

  const { data, isLoading, error } = useQuery<ShelfRow>(sql, bookId ? [bookId] : [])

  const shelves: ShelfData[] = useMemo(() => {
    if (!data) return []

    return data.map((row): ShelfData => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      color: row.color ?? undefined,
      icon: row.icon ?? undefined,
      sortOrder: row.sort_order,
      bookCount: 0, // 此查询不包含书籍数量
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }, [data])

  // 将书籍添加到指定书架
  const addToShelf = useCallback(async (shelfId: string) => {
    if (!db || !bookId) throw new Error('Database or bookId not available')

    const existingRows = await db.getAll<{ id: string }>(
      'SELECT id FROM shelf_books WHERE shelf_id = ? AND book_id = ?',
      [shelfId, bookId]
    )

    if (existingRows.length > 0) return

    const id = generateUUID()
    const now = new Date().toISOString()
    // 使用正确的 user_id - 从 AuthStore 获取
    const userId = useAuthStore.getState().user?.id || ''

    const maxOrderRows = await db.getAll<{ max_order: number }>(
      'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM shelf_books WHERE shelf_id = ?',
      [shelfId]
    )
    const maxOrder = maxOrderRows[0]?.max_order ?? 0

    await db.execute(
      `INSERT INTO shelf_books (id, user_id, shelf_id, book_id, sort_order, added_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, userId, shelfId, bookId, maxOrder + 1, now]
    )
  }, [db, bookId])

  // 从指定书架移除书籍
  const removeFromShelf = useCallback(async (shelfId: string) => {
    if (!db || !bookId) throw new Error('Database or bookId not available')

    await db.execute(
      'DELETE FROM shelf_books WHERE shelf_id = ? AND book_id = ?',
      [shelfId, bookId]
    )
  }, [db, bookId])

  return {
    shelves,
    isLoading,
    error,
    addToShelf,
    removeFromShelf,
    isReady: !!db,
  }
}

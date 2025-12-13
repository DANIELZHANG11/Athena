/**
 * useNotes - 笔记 Live Query Hook
 *
 * 提供实时响应式的笔记数据查询
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

export interface Note {
  id: string
  book_id: string
  chapter_index: number | null
  cfi_range: string | null
  page_number: number | null
  content: string
  color: string | null
  tags: string | null // JSON array string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface UseNotesOptions {
  /** 按书籍 ID 筛选 */
  bookId?: string
  /** 按章节筛选 */
  chapterIndex?: number
  /** 是否包含已删除的笔记 */
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
 * 获取笔记列表
 */
export function useNotes(options: UseNotesOptions = {}) {
  const isAppFirstEnabled = useIsAppFirstEnabled()
  const db = usePowerSyncDatabase()

  const {
    bookId,
    chapterIndex,
    includeDeleted = false,
    orderBy = 'created_at',
    orderDirection = 'desc',
    limit
  } = options

  // 构建 SQL 查询
  const { sql, params } = useMemo(() => {
    let query = 'SELECT * FROM notes'
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

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    query += ` ORDER BY ${orderBy} ${orderDirection.toUpperCase()}`

    if (limit) {
      query += ` LIMIT ${limit}`
    }

    return { sql: query, params: queryParams }
  }, [bookId, chapterIndex, includeDeleted, orderBy, orderDirection, limit])

  // PowerSync Live Query
  const { data, isLoading, error } = useQuery<Note>(sql, params)

  if (!isAppFirstEnabled || !db) {
    return {
      notes: [] as Note[],
      isLoading: false,
      error: null,
      isAppFirstEnabled: false
    }
  }

  return {
    notes: data ?? [],
    isLoading,
    error,
    isAppFirstEnabled: true
  }
}

/**
 * 获取单条笔记
 */
export function useNote(noteId: string | null) {
  const isAppFirstEnabled = useIsAppFirstEnabled()
  const db = usePowerSyncDatabase()

  const { data, isLoading, error } = useQuery<Note>(
    noteId ? 'SELECT * FROM notes WHERE id = ?' : 'SELECT * FROM notes WHERE 1=0',
    noteId ? [noteId] : []
  )

  if (!isAppFirstEnabled || !db || !noteId) {
    return {
      note: null,
      isLoading: false,
      error: null,
      isAppFirstEnabled: false
    }
  }

  return {
    note: data?.[0] ?? null,
    isLoading,
    error,
    isAppFirstEnabled: true
  }
}

/**
 * 获取书籍的笔记数量
 */
export function useNoteCount(bookId?: string) {
  const isAppFirstEnabled = useIsAppFirstEnabled()
  const db = usePowerSyncDatabase()

  const sql = bookId
    ? 'SELECT COUNT(*) as count FROM notes WHERE book_id = ? AND deleted_at IS NULL'
    : 'SELECT COUNT(*) as count FROM notes WHERE deleted_at IS NULL'

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
 * 笔记写入操作
 */
export function useNoteMutations() {
  const db = usePowerSyncDatabase()
  const isAppFirstEnabled = useIsAppFirstEnabled()

  const addNote = async (note: Omit<Note, 'id' | 'created_at' | 'updated_at' | 'deleted_at'> & { id?: string }) => {
    if (!db || !isAppFirstEnabled) {
      throw new Error('PowerSync not available')
    }

    const id = note.id || crypto.randomUUID()
    const now = new Date().toISOString()

    await db.execute(
      `INSERT INTO notes (id, book_id, chapter_index, cfi_range, page_number, content, color, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        note.book_id,
        note.chapter_index,
        note.cfi_range,
        note.page_number,
        note.content,
        note.color,
        note.tags,
        now,
        now
      ]
    )

    return id
  }

  const updateNote = async (id: string, updates: Partial<Note>) => {
    if (!db || !isAppFirstEnabled) {
      throw new Error('PowerSync not available')
    }

    const fields = Object.keys(updates).filter(k => k !== 'id' && k !== 'created_at')
    if (fields.length === 0) return

    const setClause = fields.map(f => `${f} = ?`).join(', ')
    const values = fields.map(f => updates[f as keyof Note])
    values.push(new Date().toISOString()) // updated_at
    values.push(id)

    await db.execute(
      `UPDATE notes SET ${setClause}, updated_at = ? WHERE id = ?`,
      values
    )
  }

  const deleteNote = async (id: string, soft = true) => {
    if (!db || !isAppFirstEnabled) {
      throw new Error('PowerSync not available')
    }

    if (soft) {
      await db.execute(
        'UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ?',
        [new Date().toISOString(), new Date().toISOString(), id]
      )
    } else {
      await db.execute('DELETE FROM notes WHERE id = ?', [id])
    }
  }

  return {
    addNote,
    updateNote,
    deleteNote,
    isAvailable: isAppFirstEnabled && !!db
  }
}

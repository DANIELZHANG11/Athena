/**
 * useNotesData - 笔记数据统一入口 Hook (PowerSync Only)
 *
 * 直接使用 PowerSync SQLite 作为唯一数据源
 *
 * @see 09 - APP-FIRST架构改造计划.md Phase 3
 */

import { useMemo, useCallback } from 'react'
import { useQuery } from '@powersync/react'
import { usePowerSyncDatabase, usePowerSyncState } from '@/lib/powersync'
import { useAuthStore } from '@/stores/auth'
import { generateUUID, getDeviceId } from '@/lib/utils'

// ============================================================================
// 类型定义
// ============================================================================

export interface NoteItem {
  id: string
  bookId: string
  bookTitle?: string
  chapterIndex?: number
  cfiRange?: string
  pageNumber?: number
  content: string
  color?: string
  tags?: string[]
  createdAt: string
  updatedAt: string
}

export interface HighlightItem {
  id: string
  bookId: string
  bookTitle?: string
  chapterIndex?: number
  cfiRange: string
  pageNumber?: number
  textContent: string
  color: string
  note?: string
  createdAt: string
  updatedAt: string
}

interface NoteRow {
  id: string
  book_id: string
  chapter_index: number | null
  cfi_range: string | null
  page_number: number | null
  content: string
  color: string | null
  tags: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

interface HighlightRow {
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

interface BookTitleRow {
  id: string
  title: string
}

interface UseNotesDataOptions {
  bookId?: string
  limit?: number
  search?: string
}

// ============================================================================
// Hook 实现
// ============================================================================

/**
 * 获取笔记列表
 */
export function useNotesData(options: UseNotesDataOptions = {}) {
  const db = usePowerSyncDatabase()
  const { isInitialized } = usePowerSyncState()
  const isReady = isInitialized && db !== null
  const { bookId, limit, search } = options

  const EMPTY_NOTES_QUERY = 'SELECT * FROM notes WHERE 1=0'
  const EMPTY_BOOKS_QUERY = 'SELECT id, title FROM books WHERE 1=0'

  // 笔记查询
  const notesSql = useMemo(() => {
    if (!isReady) return EMPTY_NOTES_QUERY
    
    let sql = 'SELECT * FROM notes WHERE deleted_at IS NULL'
    const conditions: string[] = []

    if (bookId) {
      conditions.push('book_id = ?')
    }

    if (search) {
      conditions.push('content LIKE ?')
    }

    if (conditions.length > 0) {
      sql += ' AND ' + conditions.join(' AND ')
    }

    sql += ' ORDER BY updated_at DESC'
    if (limit) {
      sql += ` LIMIT ${limit}`
    }
    return sql
  }, [isReady, bookId, limit, search])

  const notesParams = useMemo(() => {
    if (!isReady) return []
    const params: any[] = []
    if (bookId) params.push(bookId)
    if (search) params.push(`%${search}%`)
    return params
  }, [isReady, bookId, search])

  // 书籍标题查询（用于显示书名）
  const booksTitlesSql = isReady 
    ? 'SELECT id, title FROM books WHERE deleted_at IS NULL'
    : EMPTY_BOOKS_QUERY

  const { data: notesData, isLoading, error } = useQuery<NoteRow>(notesSql, notesParams)
  const { data: booksData } = useQuery<BookTitleRow>(booksTitlesSql, [])

  // 书籍标题映射
  const bookTitles = useMemo(() => {
    const map = new Map<string, string>()
    booksData?.forEach(b => map.set(b.id, b.title))
    return map
  }, [booksData])

  // 转换为 UI 格式
  const notes: NoteItem[] = useMemo(() => {
    if (!notesData) return []

    return notesData.map((note): NoteItem => ({
      id: note.id,
      bookId: note.book_id,
      bookTitle: bookTitles.get(note.book_id),
      chapterIndex: note.chapter_index ?? undefined,
      cfiRange: note.cfi_range ?? undefined,
      pageNumber: note.page_number ?? undefined,
      content: note.content,
      color: note.color ?? undefined,
      tags: note.tags ? JSON.parse(note.tags) : undefined,
      createdAt: note.created_at,
      updatedAt: note.updated_at,
    }))
  }, [notesData, bookTitles])

  // 写入操作
  const addNote = useCallback(async (note: Omit<NoteItem, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (!db) throw new Error('Database not available')

    const id = generateUUID()
    const now = new Date().toISOString()
    // 使用正确的 user_id 和 device_id - 从 AuthStore 和 localStorage 获取
    const userId = useAuthStore.getState().user?.id || ''
    const deviceId = getDeviceId()

    await db.execute(
      `INSERT INTO notes (id, user_id, device_id, book_id, chapter_index, cfi_range, page_number, content, color, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        deviceId,
        note.bookId,
        note.chapterIndex ?? null,
        note.cfiRange ?? null,
        note.pageNumber ?? null,
        note.content,
        note.color ?? null,
        note.tags ? JSON.stringify(note.tags) : null,
        now,
        now
      ]
    )

    return id
  }, [db])

  const updateNote = useCallback(async (id: string, content: string, tags?: string[]) => {
    if (!db) throw new Error('Database not available')

    const now = new Date().toISOString()
    await db.execute(
      'UPDATE notes SET content = ?, tags = ?, updated_at = ? WHERE id = ?',
      [content, tags ? JSON.stringify(tags) : null, now, id]
    )
  }, [db])

  const deleteNote = useCallback(async (id: string) => {
    if (!db) throw new Error('Database not available')

    const now = new Date().toISOString()
    await db.execute(
      'UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ?',
      [now, now, id]
    )
  }, [db])

  return {
    notes,
    isLoading: !isReady || isLoading,
    error,
    addNote,
    updateNote,
    deleteNote,
    isReady,
  }
}

/**
 * 获取高亮列表
 */
export function useHighlightsData(options: UseNotesDataOptions = {}) {
  const db = usePowerSyncDatabase()
  const { isInitialized } = usePowerSyncState()
  const isReady = isInitialized && db !== null
  const { bookId, limit, search } = options

  const EMPTY_HIGHLIGHTS_QUERY = 'SELECT * FROM highlights WHERE 1=0'
  const EMPTY_BOOKS_QUERY = 'SELECT id, title FROM books WHERE 1=0'

  // 高亮查询
  const highlightsSql = useMemo(() => {
    if (!isReady) return EMPTY_HIGHLIGHTS_QUERY
    
    let sql = 'SELECT * FROM highlights WHERE deleted_at IS NULL'
    const conditions: string[] = []

    if (bookId) {
      conditions.push('book_id = ?')
    }

    if (search) {
      conditions.push('text_content LIKE ?')
    }

    if (conditions.length > 0) {
      sql += ' AND ' + conditions.join(' AND ')
    }

    sql += ' ORDER BY updated_at DESC'
    if (limit) {
      sql += ` LIMIT ${limit}`
    }
    return sql
  }, [isReady, bookId, limit, search])

  const highlightsParams = useMemo(() => {
    if (!isReady) return []
    const params: any[] = []
    if (bookId) params.push(bookId)
    if (search) params.push(`%${search}%`)
    return params
  }, [isReady, bookId, search])

  // 书籍标题查询
  const booksTitlesSql = isReady
    ? 'SELECT id, title FROM books WHERE deleted_at IS NULL'
    : EMPTY_BOOKS_QUERY

  const { data: highlightsData, isLoading, error } = useQuery<HighlightRow>(highlightsSql, highlightsParams)
  const { data: booksData } = useQuery<BookTitleRow>(booksTitlesSql, [])

  // 书籍标题映射
  const bookTitles = useMemo(() => {
    const map = new Map<string, string>()
    booksData?.forEach(b => map.set(b.id, b.title))
    return map
  }, [booksData])

  // 转换为 UI 格式
  const highlights: HighlightItem[] = useMemo(() => {
    if (!highlightsData) return []

    return highlightsData.map((h): HighlightItem => ({
      id: h.id,
      bookId: h.book_id,
      bookTitle: bookTitles.get(h.book_id),
      chapterIndex: h.chapter_index ?? undefined,
      cfiRange: h.cfi_range,
      pageNumber: h.page_number ?? undefined,
      textContent: h.text_content,
      color: h.color,
      note: h.note ?? undefined,
      createdAt: h.created_at,
      updatedAt: h.updated_at,
    }))
  }, [highlightsData, bookTitles])

  // 写入操作
  const addHighlight = useCallback(async (highlight: Omit<HighlightItem, 'id' | 'createdAt' | 'updatedAt' | 'bookTitle'>) => {
    if (!db) throw new Error('Database not available')

    const id = generateUUID()
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
        highlight.bookId,
        highlight.chapterIndex ?? null,
        highlight.cfiRange,
        highlight.pageNumber ?? null,
        highlight.textContent,
        highlight.color,
        highlight.note ?? null,
        now,
        now
      ]
    )

    return id
  }, [db])

  const updateHighlight = useCallback(async (id: string, updates: { color?: string; note?: string }) => {
    if (!db) throw new Error('Database not available')

    const now = new Date().toISOString()
    const fields: string[] = ['updated_at = ?']
    const values: (string | null)[] = [now]

    if (updates.color !== undefined) {
      fields.push('color = ?')
      values.push(updates.color)
    }
    if (updates.note !== undefined) {
      fields.push('note = ?')
      values.push(updates.note)
    }

    values.push(id)
    await db.execute(`UPDATE highlights SET ${fields.join(', ')} WHERE id = ?`, values)
  }, [db])

  const deleteHighlight = useCallback(async (id: string) => {
    if (!db) throw new Error('Database not available')

    const now = new Date().toISOString()
    await db.execute(
      'UPDATE highlights SET deleted_at = ?, updated_at = ? WHERE id = ?',
      [now, now, id]
    )
  }, [db])

  return {
    highlights,
    isLoading: !isReady || isLoading,
    error,
    addHighlight,
    updateHighlight,
    deleteHighlight,
    isReady,
  }
}

/**
 * 获取书籍的笔记和高亮组合数据
 */
export function useBookAnnotations(bookId: string) {
  const { notes, isLoading: notesLoading, addNote, updateNote, deleteNote } = useNotesData({ bookId })
  const { highlights, isLoading: highlightsLoading, addHighlight, updateHighlight, deleteHighlight } = useHighlightsData({ bookId })

  return {
    notes,
    highlights,
    isLoading: notesLoading || highlightsLoading,
    // 笔记操作
    addNote,
    updateNote,
    deleteNote,
    // 高亮操作
    addHighlight,
    updateHighlight,
    deleteHighlight,
  }
}

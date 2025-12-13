/**
 * useBooksData - 书籍数据统一入口 Hook (PowerSync Only)
 *
 * 直接使用 PowerSync SQLite 作为唯一数据源
 * 不再使用 Dexie 或 libraryStorage
 *
 * @see 09 - APP-FIRST架构改造计划.md Phase 3
 */

import { useMemo, useCallback } from 'react'
import { useQuery } from '@powersync/react'
import { usePowerSyncDatabase } from '@/lib/powersync'
import { useAuthStore } from '@/stores/auth'

// ============================================================================
// 类型定义
// ============================================================================

export interface BookItem {
  id: string
  title: string
  author?: string
  coverUrl?: string
  progress?: number
  isFinished?: boolean
  downloadUrl?: string
  updatedAt?: string
  createdAt?: string
  ocrStatus?: string | null
  isImageBased?: boolean
  conversionStatus?: string | null
  originalFormat?: string
  totalPages?: number | null
}

interface BookRow {
  id: string
  title: string
  author: string | null
  cover_path: string | null
  file_path: string
  file_size: number
  file_hash: string
  format: string
  publisher: string | null
  language: string | null
  isbn: string | null
  description: string | null
  total_pages: number | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  // 扩展字段（需要后端同步）
  ocr_status?: string | null
  is_image_based?: number | null
  conversion_status?: string | null
  original_format?: string | null
}

interface ProgressRow {
  book_id: string
  percentage: number
}

interface UseBooksDataOptions {
  /** 排序方式 */
  sortBy?: 'recent' | 'title' | 'author' | 'upload'
  /** 是否包含已删除 */
  includeDeleted?: boolean
  /** 搜索关键词 */
  search?: string
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useBooksData(options: UseBooksDataOptions = {}) {
  const db = usePowerSyncDatabase()
  const accessToken = useAuthStore(s => s.accessToken)

  const { sortBy = 'recent', includeDeleted = false, search } = options

  // 构建排序 SQL
  const orderClause = useMemo(() => {
    switch (sortBy) {
      case 'title':
        return 'ORDER BY title COLLATE NOCASE ASC'
      case 'author':
        return 'ORDER BY author COLLATE NOCASE ASC'
      case 'upload':
        return 'ORDER BY created_at DESC'
      case 'recent':
      default:
        return 'ORDER BY updated_at DESC'
    }
  }, [sortBy])

  // 主查询：书籍列表
  const booksSql = useMemo(() => {
    let sql = 'SELECT * FROM books'
    const conditions: string[] = []

    if (!includeDeleted) {
      conditions.push('deleted_at IS NULL')
    }

    if (search) {
      conditions.push("(title LIKE ? OR author LIKE ?)")
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }

    sql += ` ${orderClause}`
    return sql
  }, [includeDeleted, search, orderClause])

  const booksParams = useMemo(() => {
    if (search) {
      const pattern = `%${search}%`
      return [pattern, pattern]
    }
    return []
  }, [search])

  // 阅读进度查询
  const progressSql = 'SELECT book_id, percentage FROM reading_progress'

  // Live Queries
  const { data: booksData, isLoading: booksLoading, error: booksError } = useQuery<BookRow>(booksSql, booksParams)
  const { data: progressData } = useQuery<ProgressRow>(progressSql, [])

  // 构建进度映射
  const progressMap = useMemo(() => {
    const map = new Map<string, number>()
    if (progressData) {
      progressData.forEach(p => {
        map.set(p.book_id, Math.round(p.percentage * 100))
      })
    }
    return map
  }, [progressData])

  // 转换为 UI 格式
  const items: BookItem[] = useMemo(() => {
    if (!booksData) return []

    const token = accessToken || localStorage.getItem('access_token') || ''

    return booksData.map((book): BookItem => ({
      id: book.id,
      title: book.title || '未命名',
      author: book.author || undefined,
      coverUrl: book.id && token
        ? `/api/v1/books/${book.id}/cover?token=${encodeURIComponent(token)}`
        : undefined,
      progress: progressMap.get(book.id) || 0,
      isFinished: (progressMap.get(book.id) || 0) >= 100,
      updatedAt: book.updated_at,
      createdAt: book.created_at,
      ocrStatus: book.ocr_status || null,
      isImageBased: book.is_image_based === 1,
      conversionStatus: book.conversion_status || null,
      originalFormat: book.original_format || book.format,
      totalPages: book.total_pages,
    }))
  }, [booksData, progressMap, accessToken])

  // 书籍统计
  const stats = useMemo(() => {
    const total = items.length
    const finished = items.filter(i => i.isFinished).length
    const inProgress = items.filter(i => (i.progress ?? 0) > 0 && !i.isFinished).length
    const notStarted = total - finished - inProgress

    return { total, finished, inProgress, notStarted }
  }, [items])

  // 检查是否有正在处理的书籍
  const hasProcessing = useMemo(() =>
    items.some(item =>
      item.ocrStatus === 'pending' || item.ocrStatus === 'processing' ||
      item.conversionStatus === 'pending' || item.conversionStatus === 'processing'
    ),
    [items]
  )

  // 获取正在处理的书籍 ID
  const processingBookIds = useMemo(() => {
    return items
      .filter(item =>
        item.ocrStatus === 'pending' || item.ocrStatus === 'processing' ||
        item.conversionStatus === 'pending' || item.conversionStatus === 'processing'
      )
      .map(item => item.id)
  }, [items])

  // 刷新函数（PowerSync 自动同步，这里只是触发一次手动同步请求）
  const refresh = useCallback(async () => {
    if (!db) return

    try {
      // 触发 PowerSync 同步（如果已连接）
      // 注意：PowerSync 会自动管理同步，此处仅作为手动触发的入口
      console.log('[useBooksData] Manual refresh triggered')
    } catch (error) {
      console.error('[useBooksData] Refresh error:', error)
    }
  }, [db])

  // 更新书籍元数据
  const updateBook = useCallback(async (id: string, updates: { title?: string; author?: string }) => {
    if (!db) throw new Error('Database not available')

    const now = new Date().toISOString()
    const fields: string[] = ['updated_at = ?']
    const values: any[] = [now]

    if (updates.title !== undefined) {
      fields.push('title = ?')
      values.push(updates.title)
    }
    if (updates.author !== undefined) {
      fields.push('author = ?')
      values.push(updates.author)
    }

    if (fields.length === 1) return // No updates

    values.push(id)
    await db.execute(`UPDATE books SET ${fields.join(', ')} WHERE id = ?`, values)
  }, [db])

  return {
    /** 书籍列表 */
    items,
    /** 加载状态 */
    isLoading: booksLoading,
    /** 错误信息 */
    error: booksError,
    /** 书籍统计 */
    stats,
    /** 是否有正在处理的书籍 */
    hasProcessing,
    /** 正在处理的书籍 ID 列表 */
    processingBookIds,
    /** 手动刷新 */
    refresh,
    /** 更新书籍 */
    updateBook,
    /** 数据库是否可用 */
    isReady: !!db,
  }
}

/**
 * 获取单本书籍数据
 */
export function useBookData(bookId: string | null) {
  const db = usePowerSyncDatabase()
  const accessToken = useAuthStore(s => s.accessToken)

  const { data, isLoading, error } = useQuery<BookRow>(
    bookId ? 'SELECT * FROM books WHERE id = ?' : 'SELECT * FROM books WHERE 1=0',
    bookId ? [bookId] : []
  )

  const { data: progressData } = useQuery<ProgressRow>(
    bookId ? 'SELECT book_id, percentage FROM reading_progress WHERE book_id = ?' : 'SELECT book_id, percentage FROM reading_progress WHERE 1=0',
    bookId ? [bookId] : []
  )

  const book: BookItem | null = useMemo(() => {
    if (!data?.[0]) return null

    const bookRow = data[0]
    const token = accessToken || localStorage.getItem('access_token') || ''
    const progress = progressData?.[0]?.percentage ?? 0

    return {
      id: bookRow.id,
      title: bookRow.title || '未命名',
      author: bookRow.author || undefined,
      coverUrl: bookRow.id && token
        ? `/api/v1/books/${bookRow.id}/cover?token=${encodeURIComponent(token)}`
        : undefined,
      progress: Math.round(progress * 100),
      isFinished: progress >= 1,
      updatedAt: bookRow.updated_at,
      createdAt: bookRow.created_at,
      ocrStatus: bookRow.ocr_status || null,
      isImageBased: bookRow.is_image_based === 1,
      conversionStatus: bookRow.conversion_status || null,
      originalFormat: bookRow.original_format || bookRow.format,
      totalPages: bookRow.total_pages,
    }
  }, [data, progressData, accessToken])

  return {
    book,
    isLoading,
    error,
    isReady: !!db,
  }
}

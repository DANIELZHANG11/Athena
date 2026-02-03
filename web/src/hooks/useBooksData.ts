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
import { usePowerSyncDatabase, usePowerSyncState } from '@/lib/powersync'
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
  fileSize?: number  // 文件大小（字节），用于验证缓存有效性
}

interface BookRow {
  id: string
  title: string
  author: string | null
  cover_url: string | null
  storage_key: string
  file_size: number
  content_sha256: string | null
  file_type: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  // 扩展字段
  ocr_status?: string | null
  is_digitalized?: number | null
  initial_digitalization_confidence?: number | null
  conversion_status?: string | null
}

/**
 * reading_progress 表行结构
 * 使用 progress 字段 (REAL 0-1) 和 finished_at 字段
 */
interface ProgressRow {
  book_id: string
  progress: number  // 0-1, 不是 percentage
  finished_at: string | null  // ISO 8601 时间戳，表示已读完
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
  const { isInitialized, isConnected } = usePowerSyncState()
  const accessToken = useAuthStore(s => s.accessToken)

  const { sortBy = 'recent', includeDeleted = false, search } = options

  // 检查 PowerSync 是否准备就绪
  const isReady = isInitialized && db !== null

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

  // 阅读进度查询 - 使用正确的字段名 progress 和 finished_at
  const progressSql = 'SELECT book_id, progress, finished_at FROM reading_progress'

  // Live Queries - 只有在 PowerSync 完全就绪时才执行真实查询
  // 使用稳定的空查询作为占位符，避免 Hook 顺序问题
  const EMPTY_BOOKS_QUERY = 'SELECT * FROM books WHERE 1=0'
  const EMPTY_PROGRESS_QUERY = 'SELECT book_id, progress, finished_at FROM reading_progress WHERE 1=0'
  
  const safeBooksQuery = isReady ? booksSql : EMPTY_BOOKS_QUERY
  const safeProgressQuery = isReady ? progressSql : EMPTY_PROGRESS_QUERY
  const safeBooksParams = isReady ? booksParams : []
  
  const { data: booksData, isLoading: booksLoading, error: booksError } = useQuery<BookRow>(safeBooksQuery, safeBooksParams)
  const { data: progressData } = useQuery<ProgressRow>(safeProgressQuery, [])

  // 构建进度映射 - 同时存储 progress 和 finished_at
  const progressMap = useMemo(() => {
    const map = new Map<string, { progress: number; finishedAt: string | null }>()
    if (progressData) {
      console.log('[useBooksData] Progress data from DB:', progressData)
      progressData.forEach(p => {
        map.set(p.book_id, {
          progress: Math.round((p.progress ?? 0) * 100),
          finishedAt: p.finished_at
        })
      })
    }
    return map
  }, [progressData])

  // 转换为 UI 格式
  const items: BookItem[] = useMemo(() => {
    if (!booksData) return []

    const token = accessToken || localStorage.getItem('access_token') || ''

    return booksData.map((book): BookItem => {
      const progressInfo = progressMap.get(book.id)
      const progress = progressInfo?.progress || 0
      // isFinished 优先检查 finished_at 字段，其次检查 progress >= 100
      const isFinished = progressInfo?.finishedAt ? true : progress >= 100
      
      return {
        id: book.id,
        title: book.title || '未命名',
        author: book.author || undefined,
        // 只有当 PowerSync 同步的 cover_url 有值时，才生成封面访问 URL
        // 封面是二进制文件，通过 REST API 代理获取（编码宪法 3.3 规定）
        coverUrl: book.cover_url && book.id && token
          ? `/api/v1/books/${book.id}/cover?token=${encodeURIComponent(token)}`
          : undefined,
        progress,
        isFinished,
        updatedAt: book.updated_at,
        createdAt: book.created_at,
        ocrStatus: book.ocr_status || null,
        // isImageBased = !is_digitalized || (is_digitalized && confidence < 0.8)
        isImageBased: book.is_digitalized !== 1 || (book.is_digitalized === 1 && (book.initial_digitalization_confidence ?? 1) < 0.8),
        conversionStatus: book.conversion_status || null,
        originalFormat: book.file_type || undefined,
        // 【2026-01-30 修复】添加 fileSize 用于缓存验证（OCR 后文件大小会变化）
        fileSize: book.file_size || undefined,
      }
    })
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
    /** 加载状态 - 包含 PowerSync 未初始化的情况 */
    isLoading: !isReady || booksLoading,
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
    /** PowerSync 数据库是否完全就绪 */
    isReady,
    /** PowerSync 是否已连接到服务器 */
    isConnected,
  }
}

/**
 * 获取单本书籍数据
 */
export function useBookData(bookId: string | null) {
  const db = usePowerSyncDatabase()
  const { isInitialized } = usePowerSyncState()
  const accessToken = useAuthStore(s => s.accessToken)

  const isReady = isInitialized && db !== null

  // 在 PowerSync 初始化完成前使用空查询
  const bookQuery = isReady && bookId
    ? 'SELECT * FROM books WHERE id = ? AND deleted_at IS NULL'
    : 'SELECT * FROM books WHERE 1=0'
  
  const progressQuery = isReady && bookId
    ? 'SELECT book_id, progress FROM reading_progress WHERE book_id = ?'
    : 'SELECT book_id, progress FROM reading_progress WHERE 1=0'

  const { data, isLoading, error } = useQuery<BookRow>(
    bookQuery,
    isReady && bookId ? [bookId] : []
  )

  const { data: progressData } = useQuery<ProgressRow>(
    progressQuery,
    isReady && bookId ? [bookId] : []
  )

  const book: BookItem | null = useMemo(() => {
    if (!data?.[0]) return null

    const bookRow = data[0]
    const token = accessToken || localStorage.getItem('access_token') || ''
    const progress = progressData?.[0]?.progress ?? 0

    return {
      id: bookRow.id,
      title: bookRow.title || '未命名',
      author: bookRow.author || undefined,
      // 只有当 PowerSync 同步的 cover_url 有值时，才生成封面访问 URL
      // 封面是二进制文件，通过 REST API 代理获取（编码宪法 3.3 规定）
      coverUrl: bookRow.cover_url && bookRow.id && token
        ? `/api/v1/books/${bookRow.id}/cover?token=${encodeURIComponent(token)}`
        : undefined,
      progress: Math.round(progress * 100),
      isFinished: progress >= 1,
      updatedAt: bookRow.updated_at,
      createdAt: bookRow.created_at,
      ocrStatus: bookRow.ocr_status || null,
      // isImageBased = !is_digitalized || (is_digitalized && confidence < 0.8)
      isImageBased: bookRow.is_digitalized !== 1 || (bookRow.is_digitalized === 1 && (bookRow.initial_digitalization_confidence ?? 1) < 0.8),
      conversionStatus: bookRow.conversion_status || null,
      originalFormat: bookRow.file_type || undefined,
      fileSize: bookRow.file_size || undefined,  // 添加文件大小用于缓存验证
    }
  }, [data, progressData, accessToken])

  return {
    book,
    isLoading: !isReady || isLoading,
    error,
    isReady,
  }
}

// ============================================================================
// 书架视图 Hook
// ============================================================================

interface ShelfRow {
  id: string
  name: string
  description: string | null
  sort_order: number | null
  created_at: string
}

interface ShelfBookRow {
  shelf_id: string
  book_id: string
  sort_order: number | null
}

export interface ShelfWithBooks {
  id: string
  name: string
  books: BookItem[]
}

/**
 * 获取按书架分组的书籍数据
 */
export function useShelvesWithBooks() {
  const db = usePowerSyncDatabase()
  const { isInitialized } = usePowerSyncState()
  const accessToken = useAuthStore(s => s.accessToken)

  const isReady = isInitialized && db !== null

  // 查询书架列表
  const EMPTY_QUERY = 'SELECT * FROM shelves WHERE 1=0'
  const shelvesQuery = isReady 
    ? 'SELECT * FROM shelves WHERE is_deleted = 0 OR is_deleted IS NULL ORDER BY sort_order ASC, name ASC'
    : EMPTY_QUERY
  
  const { data: shelvesData, isLoading: shelvesLoading } = useQuery<ShelfRow>(shelvesQuery, [])

  // 查询书架-书籍关联
  const shelfBooksQuery = isReady
    ? 'SELECT shelf_id, book_id, sort_order FROM shelf_books ORDER BY sort_order ASC'
    : 'SELECT shelf_id, book_id, sort_order FROM shelf_books WHERE 1=0'
  
  const { data: shelfBooksData } = useQuery<ShelfBookRow>(shelfBooksQuery, [])

  // 查询所有书籍
  const booksQuery = isReady
    ? 'SELECT * FROM books WHERE deleted_at IS NULL'
    : 'SELECT * FROM books WHERE 1=0'
  
  const { data: booksData } = useQuery<BookRow>(booksQuery, [])

  // 查询阅读进度 - 使用正确的字段名 progress
  const progressQuery = isReady
    ? 'SELECT book_id, progress FROM reading_progress'
    : 'SELECT book_id, progress FROM reading_progress WHERE 1=0'
  
  const { data: progressData } = useQuery<ProgressRow>(progressQuery, [])

  // 构建进度映射
  const progressMap = useMemo(() => {
    const map = new Map<string, number>()
    if (progressData) {
      progressData.forEach(p => {
        map.set(p.book_id, Math.round((p.progress ?? 0) * 100))
      })
    }
    return map
  }, [progressData])

  // 构建书籍映射
  const booksMap = useMemo(() => {
    const map = new Map<string, BookItem>()
    const token = accessToken || localStorage.getItem('access_token') || ''
    
    if (booksData) {
      booksData.forEach(book => {
        map.set(book.id, {
          id: book.id,
          title: book.title || '未命名',
          author: book.author || undefined,
          // 只有当 PowerSync 同步的 cover_url 有值时，才生成封面访问 URL
          coverUrl: book.cover_url && book.id && token
            ? `/api/v1/books/${book.id}/cover?token=${encodeURIComponent(token)}`
            : undefined,
          progress: progressMap.get(book.id) || 0,
          isFinished: (progressMap.get(book.id) || 0) >= 100,
          updatedAt: book.updated_at,
          createdAt: book.created_at,
          ocrStatus: book.ocr_status || null,
          // isImageBased = !is_digitalized || (is_digitalized && confidence < 0.8)
          isImageBased: book.is_digitalized !== 1 || (book.is_digitalized === 1 && (book.initial_digitalization_confidence ?? 1) < 0.8),
          conversionStatus: book.conversion_status || null,
          originalFormat: book.file_type || undefined,
        })
      })
    }
    return map
  }, [booksData, progressMap, accessToken])

  // 构建书架-书籍映射
  const shelfBooksMap = useMemo(() => {
    const map = new Map<string, string[]>()
    if (shelfBooksData) {
      shelfBooksData.forEach(sb => {
        const bookIds = map.get(sb.shelf_id) || []
        bookIds.push(sb.book_id)
        map.set(sb.shelf_id, bookIds)
      })
    }
    return map
  }, [shelfBooksData])

  // 已分配到书架的书籍 ID 集合
  const assignedBookIds = useMemo(() => {
    const set = new Set<string>()
    if (shelfBooksData) {
      shelfBooksData.forEach(sb => set.add(sb.book_id))
    }
    return set
  }, [shelfBooksData])

  // 构建书架列表（含书籍）
  const shelves: ShelfWithBooks[] = useMemo(() => {
    if (!shelvesData) return []

    return shelvesData.map(shelf => ({
      id: shelf.id,
      name: shelf.name,
      books: (shelfBooksMap.get(shelf.id) || [])
        .map(bookId => booksMap.get(bookId))
        .filter((book): book is BookItem => book !== undefined)
    }))
  }, [shelvesData, shelfBooksMap, booksMap])

  // 未分配书架的书籍
  const unshelvedBooks: BookItem[] = useMemo(() => {
    if (!booksData) return []
    
    return Array.from(booksMap.values())
      .filter(book => !assignedBookIds.has(book.id))
  }, [booksMap, assignedBookIds, booksData])

  return {
    shelves,
    unshelvedBooks,
    isLoading: !isReady || shelvesLoading,
    isReady,
  }
}

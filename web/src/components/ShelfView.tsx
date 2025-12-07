/**
 * ShelfView.tsx
 * 
 * 书架视图组件
 * - 分组折叠式书架卡片
 * - 书籍水平滚动（Netflix 风格）
 * - 「未分类」特殊书架显示不在任何书架的书籍
 * 
 * 遵循 UIUX 设计规范：
 * - 毛玻璃效果、圆角 16px、动效 200ms
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronRight,
  Library,
  Loader2,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import BookCard from './BookCard'

// ================== 类型定义 ==================

interface BookItem {
  id: string
  title: string
  author?: string
  coverUrl?: string
  progress?: number
  isFinished?: boolean
  ocrStatus?: string | null
  isImageBased?: boolean
}

interface Shelf {
  id: string
  name: string
  description?: string
  book_count: number
  created_at: string
}

interface ShelfWithBooks extends Shelf {
  books: BookItem[]
  isExpanded: boolean
  isLoading: boolean
}

interface ShelfViewProps {
  /** 所有书籍列表 */
  books: BookItem[]
  /** 书籍删除回调 */
  onBookDeleted: (bookId: string) => void
  /** 已读完状态变更回调 */
  onFinishedChange: (bookId: string, finished: boolean) => void
  /** 元数据更新回调 */
  onMetadataChange: (bookId: string, metadata: { title?: string; author?: string }) => void
  /** OCR 触发回调 */
  onOcrTrigger: (bookId: string) => void
  /** 点击书籍回调 */
  onBookClick: (bookId: string) => void
}

// ================== API 函数 ==================

/** 获取用户的所有书架 */
async function fetchShelves(): Promise<Shelf[]> {
  const token = useAuthStore.getState().accessToken
  const res = await fetch('/api/v1/shelves', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error('Failed to fetch shelves')
  }
  const data = await res.json()
  return data.data?.items || []
}

/** 获取书架内的书籍 */
async function fetchShelfBooks(shelfId: string): Promise<string[]> {
  const token = useAuthStore.getState().accessToken
  const res = await fetch(`/api/v1/shelves/${shelfId}/items`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    return []
  }
  const data = await res.json()
  // 后端返回格式: { status, data: [...] } 或 { status, data: { items: [...] } }
  const items = Array.isArray(data.data) ? data.data : (data.data?.items || [])
  return items.map((item: any) => item.book_id || item.id)
}

/** 删除书架 */
async function deleteShelf(shelfId: string): Promise<void> {
  const token = useAuthStore.getState().accessToken
  const res = await fetch(`/api/v1/shelves/${shelfId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error('Failed to delete shelf')
  }
}

// ================== 组件 ==================

export default function ShelfView({
  books,
  onBookDeleted,
  onFinishedChange,
  onMetadataChange,
  onOcrTrigger,
  onBookClick,
}: ShelfViewProps) {
  const { t } = useTranslation('common')
  
  const [loading, setLoading] = useState(true)
  const [shelves, setShelves] = useState<ShelfWithBooks[]>([])
  const [shelfBookIds, setShelfBookIds] = useState<Map<string, string[]>>(new Map())
  const [error, setError] = useState<string | null>(null)

  // 加载书架数据的函数
  const loadShelves = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const shelvesData = await fetchShelves()
      const shelvesWithBooks: ShelfWithBooks[] = shelvesData.map((shelf) => ({
        ...shelf,
        books: [],
        isExpanded: true, // 默认展开
        isLoading: false,
      }))
      setShelves(shelvesWithBooks)

      // 并行加载所有书架的书籍
      const bookIdsMap = new Map<string, string[]>()
      await Promise.all(
        shelvesData.map(async (shelf) => {
          const ids = await fetchShelfBooks(shelf.id)
          bookIdsMap.set(shelf.id, ids)
        })
      )
      setShelfBookIds(bookIdsMap)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // 初始加载
  useEffect(() => {
    loadShelves()
  }, [loadShelves])

  // 监听书架变更事件，自动刷新
  useEffect(() => {
    const handleShelfChange = () => {
      loadShelves()
    }
    window.addEventListener('shelf-changed', handleShelfChange)
    return () => {
      window.removeEventListener('shelf-changed', handleShelfChange)
    }
  }, [loadShelves])

  // 计算每个书架的书籍
  const shelvesWithBooks = useMemo(() => {
    return shelves.map((shelf) => {
      const bookIds = shelfBookIds.get(shelf.id) || []
      const shelfBooks = books.filter((book) => bookIds.includes(book.id))
      return {
        ...shelf,
        books: shelfBooks,
        book_count: shelfBooks.length,
      }
    })
  }, [shelves, shelfBookIds, books])

  // 计算未分类书籍
  const uncategorizedBooks = useMemo(() => {
    const allShelfBookIds = new Set<string>()
    shelfBookIds.forEach((ids) => ids.forEach((id) => allShelfBookIds.add(id)))
    return books.filter((book) => !allShelfBookIds.has(book.id))
  }, [books, shelfBookIds])

  // 切换书架展开/收起
  const toggleShelf = useCallback((shelfId: string) => {
    setShelves((prev) =>
      prev.map((shelf) =>
        shelf.id === shelfId ? { ...shelf, isExpanded: !shelf.isExpanded } : shelf
      )
    )
  }, [])

  // 删除书架
  const handleDeleteShelf = useCallback(async (shelfId: string) => {
    try {
      await deleteShelf(shelfId)
      setShelves((prev) => prev.filter((s) => s.id !== shelfId))
      setShelfBookIds((prev) => {
        const next = new Map(prev)
        next.delete(shelfId)
        return next
      })
    } catch (e) {
      console.error('Failed to delete shelf:', e)
    }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    )
  }

  // 如果没有书架和书籍
  if (shelves.length === 0 && books.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-4">
          <Library className="w-8 h-8 text-blue-500" />
        </div>
        <p className="text-sm text-gray-500">{t('shelf.empty_hint')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 书架列表 */}
      {shelvesWithBooks.map((shelf) => (
        <ShelfSection
          key={shelf.id}
          shelf={shelf}
          onToggle={() => toggleShelf(shelf.id)}
          onDelete={() => handleDeleteShelf(shelf.id)}
          onBookDeleted={onBookDeleted}
          onFinishedChange={onFinishedChange}
          onMetadataChange={onMetadataChange}
          onOcrTrigger={onOcrTrigger}
          onBookClick={onBookClick}
        />
      ))}

      {/* 未分类书籍 */}
      {uncategorizedBooks.length > 0 && (
        <ShelfSection
          shelf={{
            id: '__uncategorized__',
            name: t('shelf.uncategorized'),
            book_count: uncategorizedBooks.length,
            books: uncategorizedBooks,
            isExpanded: true,
            isLoading: false,
            created_at: '',
          }}
          isUncategorized
          onToggle={() => {}}
          onBookDeleted={onBookDeleted}
          onFinishedChange={onFinishedChange}
          onMetadataChange={onMetadataChange}
          onOcrTrigger={onOcrTrigger}
          onBookClick={onBookClick}
        />
      )}
    </div>
  )
}

// ================== 书架分组组件 ==================

interface ShelfSectionProps {
  shelf: ShelfWithBooks
  isUncategorized?: boolean
  onToggle: () => void
  onDelete?: () => void
  onBookDeleted: (bookId: string) => void
  onFinishedChange: (bookId: string, finished: boolean) => void
  onMetadataChange: (bookId: string, metadata: { title?: string; author?: string }) => void
  onOcrTrigger: (bookId: string) => void
  onBookClick: (bookId: string) => void
}

function ShelfSection({
  shelf,
  isUncategorized = false,
  onToggle,
  onDelete,
  onBookDeleted,
  onFinishedChange,
  onMetadataChange,
  onOcrTrigger,
  onBookClick,
}: ShelfSectionProps) {
  const { t } = useTranslation('common')
  const [showMenu, setShowMenu] = useState(false)

  return (
    <div
      className={cn(
        'rounded-2xl overflow-hidden',
        'bg-white/60 dark:bg-gray-900/60 backdrop-blur-lg',
        'border border-gray-200/50 dark:border-white/10',
        'transition-all duration-fast'
      )}
    >
      {/* 书架头部 */}
      <div
        className={cn(
          'w-full flex items-center justify-between p-4',
          'hover:bg-gray-100/50 dark:hover:bg-gray-800/50',
          'transition-colors duration-fast cursor-pointer'
        )}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center',
              isUncategorized ? 'bg-gray-500/10' : 'bg-blue-500/10'
            )}
          >
            <Library
              className={cn(
                'w-5 h-5',
                isUncategorized ? 'text-gray-500' : 'text-blue-600'
              )}
            />
          </div>
          <div className="text-left">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              {shelf.name}
            </h3>
            <p className="text-sm text-gray-500">
              {shelf.book_count > 0
                ? t('shelf.book_count', { count: shelf.book_count })
                : t('shelf.book_count_zero')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 操作菜单 - 非未分类书架 */}
          {!isUncategorized && onDelete && (
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMenu(!showMenu)
                }}
                className="p-2 rounded-lg hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <MoreHorizontal className="w-4 h-4 text-gray-500" />
              </button>

              {showMenu && (
                <div
                  className={cn(
                    'absolute right-0 top-full mt-1 w-40 z-10',
                    'bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl',
                    'rounded-xl shadow-lg border border-gray-200/50 dark:border-white/10',
                    'py-1 animate-in fade-in-0 zoom-in-95 duration-fast'
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => {
                      setShowMenu(false)
                      onDelete()
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>删除书架</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 展开/收起图标 */}
          {shelf.isExpanded ? (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronRight className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </div>

      {/* 书籍列表 - 水平滚动 */}
      {shelf.isExpanded && (
        <div className="px-4 pb-4">
          {shelf.books.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">
              {t('shelf.book_count_zero')}
            </div>
          ) : (
            <div className="overflow-x-auto scrollbar-hide">
              <div className="flex gap-4 pb-2" style={{ minWidth: 'min-content' }}>
                {shelf.books.map((book) => (
                  <div key={book.id} className="shrink-0 w-[120px]">
                    <BookCard
                      id={book.id}
                      variant="grid"
                      title={book.title}
                      author={book.author}
                      coverUrl={book.coverUrl}
                      progress={book.progress}
                      isFinished={book.isFinished}
                      ocrStatus={book.ocrStatus}
                      isImageBased={book.isImageBased}
                      onDeleted={onBookDeleted}
                      onFinishedChange={onFinishedChange}
                      onMetadataChange={onMetadataChange}
                      onOcrTrigger={onOcrTrigger}
                      onClick={() => onBookClick(book.id)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

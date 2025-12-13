/**
 * AddToShelfDialog.tsx
 * 
 * 「加入书架」对话框组件
 * - 显示已有书架列表供用户选择（可多选）
 * - 支持创建新书架
 * - 实时校验同名书架
 * 
 * 遵循 UIUX 设计规范：
 * - 毛玻璃效果：bg-white/95 backdrop-blur-xl
 * - 圆角：rounded-2xl
 * - 动效：duration-fast (150ms) - 使用 Motion Token
 */

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  Library,
  X,
  Loader2,
  Check,
  AlertCircle,
  FolderPlus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import {
  addBookToShelf as addBookToShelfLocal,
  removeBookFromShelf as removeBookFromShelfLocal,
  getAllShelves as getAllShelvesLocal,
  getBookShelfIds as getBookShelfIdsLocal,
} from '@/lib/shelvesStorage'

// ================== 类型定义 ==================

interface Shelf {
  id: string
  name: string
  description?: string
  book_count: number
  created_at: string
}

interface AddToShelfDialogProps {
  bookId: string
  bookTitle: string
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}

// ================== API 函数 ==================

/** 获取用户的所有书架 - 优先从本地存储读取 */
async function fetchShelves(): Promise<Shelf[]> {
  // 先从本地存储获取（确保离线时也能工作）
  const localShelves = await getAllShelvesLocal()
  
  // 如果在线，同时从服务器获取并合并
  if (navigator.onLine) {
    try {
      const token = useAuthStore.getState().accessToken
      const res = await fetch('/api/v1/shelves', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        const serverShelves = data.data?.items || []
        // 合并：服务器数据为主，但保留本地未同步的书架
        const serverIds = new Set(serverShelves.map((s: Shelf) => s.id))
        const localOnly = localShelves.filter(s => s.localId && !serverIds.has(s.id))
        return [
          ...serverShelves,
          ...localOnly.map(s => ({
            id: s.id,
            name: s.name,
            description: s.description,
            book_count: s.bookCount,
            created_at: new Date(s.createdAt).toISOString(),
          }))
        ]
      }
    } catch (e) {
      console.warn('[AddToShelfDialog] Failed to fetch shelves from server:', e)
    }
  }
  
  // 离线或服务器失败时，使用本地数据
  return localShelves.map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    book_count: s.bookCount,
    created_at: new Date(s.createdAt).toISOString(),
  }))
}

/** 获取书籍所属的书架 ID 列表 - 优先从本地存储读取 */
async function fetchBookShelves(bookId: string): Promise<string[]> {
  // 先从本地存储获取
  const localShelfIds = await getBookShelfIdsLocal(bookId)
  
  // 如果在线，同时从服务器获取并合并
  if (navigator.onLine) {
    try {
      const token = useAuthStore.getState().accessToken
      const res = await fetch(`/api/v1/books/${bookId}/shelves`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        const serverIds = (data.data?.items || []).map((s: Shelf) => s.id)
        // 合并本地和服务器的书架 ID
        return [...new Set([...serverIds, ...localShelfIds])]
      }
    } catch (e) {
      console.warn('[AddToShelfDialog] Failed to fetch book shelves from server:', e)
    }
  }
  
  return localShelfIds
}

/** 创建新书架 - 返回 { id: string } */
async function createShelf(name: string, description?: string): Promise<{ id: string }> {
  const token = useAuthStore.getState().accessToken
  const res = await fetch('/api/v1/shelves', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, description }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || err.detail || 'Failed to create shelf')
  }
  const data = await res.json()
  return data.data
}

/** 添加书籍到书架 */
async function addBookToShelf(shelfId: string, bookId: string): Promise<void> {
  // 先更新本地存储（立即可见）
  await addBookToShelfLocal(shelfId, bookId)
  
  // 然后同步到服务器（如果在线）
  if (navigator.onLine) {
    const token = useAuthStore.getState().accessToken
    const res = await fetch(`/api/v1/shelves/${shelfId}/items`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ book_id: bookId }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      // 服务器失败不回滚本地（离线优先），但记录错误
      console.warn('[AddToShelfDialog] Server sync failed:', err.message || err.detail)
    }
  }
}

/** 从书架移除书籍 */
async function removeBookFromShelf(shelfId: string, bookId: string): Promise<void> {
  // 先更新本地存储（立即可见）
  await removeBookFromShelfLocal(shelfId, bookId)
  
  // 然后同步到服务器（如果在线）
  if (navigator.onLine) {
    const token = useAuthStore.getState().accessToken
    const res = await fetch(`/api/v1/shelves/${shelfId}/items/${bookId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      // 服务器失败不回滚本地（离线优先），但记录错误
      console.warn('[AddToShelfDialog] Server sync failed:', err.message || err.detail)
    }
  }
}

// ================== 组件 ==================

export default function AddToShelfDialog({
  bookId,
  bookTitle,
  open,
  onClose,
  onSuccess,
}: AddToShelfDialogProps) {
  const { t } = useTranslation('common')

  // 状态
  const [loading, setLoading] = useState(true)
  const [shelves, setShelves] = useState<Shelf[]>([])
  const [selectedShelfIds, setSelectedShelfIds] = useState<Set<string>>(new Set())
  const [originalShelfIds, setOriginalShelfIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  // 创建新书架
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newShelfName, setNewShelfName] = useState('')
  const [creating, setCreating] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  // 保存状态
  const [saving, setSaving] = useState(false)

  // 加载书架列表和书籍所属书架
  useEffect(() => {
    if (open && bookId) {
      setLoading(true)
      setError(null)
      setShowCreateForm(false)
      setNewShelfName('')
      setNameError(null)

      Promise.all([fetchShelves(), fetchBookShelves(bookId)])
        .then(([shelvesData, bookShelfIds]) => {
          setShelves(shelvesData)
          const ids = new Set(bookShelfIds)
          setSelectedShelfIds(ids)
          setOriginalShelfIds(new Set(bookShelfIds))
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false))
    }
  }, [open, bookId])

  // 校验书架名称
  useEffect(() => {
    if (newShelfName.trim()) {
      const exists = shelves.some(
        (s) => s.name?.toLowerCase() === newShelfName.trim().toLowerCase()
      )
      if (exists) {
        setNameError(t('shelf.error.name_exists'))
      } else {
        setNameError(null)
      }
    } else {
      setNameError(null)
    }
  }, [newShelfName, shelves, t])

  // 切换书架选中状态
  const toggleShelf = useCallback((shelfId: string) => {
    setSelectedShelfIds((prev) => {
      const next = new Set(prev)
      if (next.has(shelfId)) {
        next.delete(shelfId)
      } else {
        next.add(shelfId)
      }
      return next
    })
  }, [])

  // 创建新书架
  const handleCreateShelf = useCallback(async () => {
    const name = newShelfName.trim()
    if (!name || nameError) return

    setCreating(true)
    try {
      const result = await createShelf(name)
      // 后端只返回 { id }，需要构造完整的 Shelf 对象
      const newShelf: Shelf = {
        id: result.id,
        name: name,
        description: '',
        book_count: 0,
        created_at: new Date().toISOString(),
      }
      setShelves((prev) => [...prev, newShelf])
      setSelectedShelfIds((prev) => new Set(prev).add(newShelf.id))
      setNewShelfName('')
      setShowCreateForm(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }, [newShelfName, nameError])

  // 保存更改
  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)

    try {
      // 计算需要添加和移除的书架
      const toAdd = [...selectedShelfIds].filter((id) => !originalShelfIds.has(id))
      const toRemove = [...originalShelfIds].filter((id) => !selectedShelfIds.has(id))

      // 执行添加操作
      await Promise.all(toAdd.map((shelfId) => addBookToShelf(shelfId, bookId)))

      // 执行移除操作
      await Promise.all(toRemove.map((shelfId) => removeBookFromShelf(shelfId, bookId)))

      // 触发书架变更事件，通知 ShelfView 刷新
      window.dispatchEvent(new CustomEvent('shelf-changed'))

      onSuccess?.()
      onClose()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }, [bookId, selectedShelfIds, originalShelfIds, onSuccess, onClose])

  // 检查是否有更改
  const hasChanges = (() => {
    if (selectedShelfIds.size !== originalShelfIds.size) return true
    for (const id of selectedShelfIds) {
      if (!originalShelfIds.has(id)) return true
    }
    return false
  })()

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-to-shelf-title"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 animate-in fade-in-0 duration-fast"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }}
      />

      {/* Dialog Content */}
      <div
        className={cn(
          'relative z-10 w-full max-w-md',
          'rounded-2xl shadow-2xl',
          'animate-in fade-in-0 zoom-in-95 duration-fast'
        )}
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        }}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200/50">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-500/10">
              <Library className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 id="add-to-shelf-title" className="text-lg font-semibold text-gray-900">
                {t('shelf.add_to_shelf')}
              </h2>
              <p className="text-sm text-gray-500 truncate max-w-60">
                {bookTitle}
              </p>
            </div>
          </div>
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onClose()
            }}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors duration-fast"
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 max-h-[400px] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
            </div>
          ) : error && !shelves.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
              <p className="text-sm text-gray-600">{error}</p>
              <button
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setError(null)
                }}
                className="mt-4 px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              >
                {t('common.retry')}
              </button>
            </div>
          ) : (
            <>
              {/* 书架列表 */}
              {shelves.length > 0 && (
                <div className="space-y-2 mb-4">
                  <p className="text-sm font-medium text-gray-700 mb-3">
                    {t('shelf.select_shelf')}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {shelves.map((shelf) => {
                      const isSelected = selectedShelfIds.has(shelf.id)
                      return (
                        <button
                          key={shelf.id}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            toggleShelf(shelf.id)
                          }}
                          className={cn(
                            'flex items-center gap-2 p-3 rounded-xl text-left transition-all duration-fast',
                            'border-2',
                            isSelected
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                          )}
                        >
                          <div
                            className={cn(
                              'shrink-0 w-5 h-5 rounded-md flex items-center justify-center',
                              isSelected ? 'bg-blue-500' : 'bg-gray-200'
                            )}
                          >
                            {isSelected && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {shelf.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {t('shelf.book_count', { count: shelf.book_count })}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 分隔线 */}
              {shelves.length > 0 && (
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-xs text-gray-400">{t('shelf.or')}</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
              )}

              {/* 创建新书架 */}
              {showCreateForm ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-gray-700">
                    {t('shelf.create_new')}
                  </p>
                  <div className="relative">
                    <input
                      type="text"
                      value={newShelfName}
                      onChange={(e) => setNewShelfName(e.target.value)}
                      placeholder={t('shelf.name_placeholder')}
                      className={cn(
                        'w-full px-4 py-3 rounded-xl border-2 text-sm',
                        'focus:outline-none focus:ring-0 transition-colors duration-fast',
                        nameError
                          ? 'border-red-300 focus:border-red-500'
                          : 'border-gray-200 focus:border-blue-500'
                      )}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !nameError && newShelfName.trim()) {
                          e.preventDefault()
                          e.stopPropagation()
                          handleCreateShelf()
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          e.stopPropagation()
                          setShowCreateForm(false)
                          setNewShelfName('')
                        }
                      }}
                    />
                    {nameError && (
                      <p className="absolute -bottom-5 left-0 text-xs text-red-500">
                        {nameError}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 mt-6">
                    <button
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setShowCreateForm(false)
                        setNewShelfName('')
                      }}
                      className="flex-1 px-4 py-2.5 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors duration-fast"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        handleCreateShelf()
                      }}
                      disabled={!newShelfName.trim() || !!nameError || creating}
                      className={cn(
                        'flex-1 px-4 py-2.5 text-sm text-white rounded-xl transition-colors duration-fast',
                        'flex items-center justify-center gap-2',
                        !newShelfName.trim() || !!nameError || creating
                          ? 'bg-blue-300 cursor-not-allowed'
                          : 'bg-blue-500 hover:bg-blue-600'
                      )}
                    >
                      {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                      {t('shelf.create_and_add')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setShowCreateForm(true)
                  }}
                  className={cn(
                    'w-full flex items-center justify-center gap-2 p-4 rounded-xl',
                    'border-2 border-dashed border-gray-300 hover:border-blue-400',
                    'text-gray-600 hover:text-blue-600',
                    'transition-colors duration-fast'
                  )}
                >
                  <FolderPlus className="w-5 h-5" />
                  <span className="text-sm font-medium">{t('shelf.create_new')}</span>
                </button>
              )}

              {/* 错误提示 */}
              {error && shelves.length > 0 && (
                <div className="mt-4 p-3 bg-red-50 rounded-xl flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && shelves.length > 0 && !showCreateForm && (
          <div className="px-6 py-4 border-t border-gray-200/50 flex gap-3">
            <button
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onClose()
              }}
              className="flex-1 px-4 py-2.5 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors duration-fast"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleSave()
              }}
              disabled={!hasChanges || saving}
              className={cn(
                'flex-1 px-4 py-2.5 text-sm text-white rounded-xl transition-colors duration-fast',
                'flex items-center justify-center gap-2',
                !hasChanges || saving
                  ? 'bg-blue-300 cursor-not-allowed'
                  : 'bg-blue-500 hover:bg-blue-600'
              )}
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('common.save')}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

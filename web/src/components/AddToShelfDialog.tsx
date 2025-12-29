/**
 * AddToShelfDialog.tsx
 * 
 * 「加入书架」对话框组件
 * - 显示已有书架列表供用户选择（可多选）
 * - 支持创建新书架
 * - 使用 PowerSync 进行本地数据操作
 * 
 * 遵循 UIUX 设计规范：
 * - 毛玻璃效果：bg-white/95 backdrop-blur-xl
 * - 圆角：rounded-2xl
 * - 动效：duration-fast (150ms) - 使用 Motion Token
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
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
import { cn, generateUUID } from '@/lib/utils'
import { usePowerSync, useQuery } from '@powersync/react'
import { useAuthStore } from '@/stores/auth'

// ================== 类型定义 ==================

interface ShelfRow {
  id: string
  name: string
  description: string | null
  book_count: number
}

interface ShelfBookRow {
  shelf_id: string
}

interface AddToShelfDialogProps {
  bookId: string
  bookTitle: string
  open: boolean
  onClose: () => void
  onSuccess?: () => void
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
  const db = usePowerSync()

  // 使用 PowerSync 查询书架列表
  // 注意：is_deleted 可能是 NULL、0 或 FALSE，需要正确处理
  const shelvesQuery = open
    ? `SELECT s.id, s.name, s.description, COALESCE(sb.book_count, 0) as book_count
       FROM shelves s
       LEFT JOIN (
         SELECT shelf_id, COUNT(*) as book_count
         FROM shelf_books
         GROUP BY shelf_id
       ) sb ON s.id = sb.shelf_id
       WHERE s.deleted_at IS NULL
       AND (s.is_deleted IS NULL OR s.is_deleted = 0)
       ORDER BY s.sort_order ASC, s.name ASC`
    : 'SELECT id, name, description, 0 as book_count FROM shelves WHERE 1=0'
  
  const { data: shelvesData, isLoading: shelvesLoading, error: shelvesError } = useQuery<ShelfRow>(shelvesQuery, [])

  // 查询书籍当前所属的书架
  const bookShelvesQuery = open && bookId
    ? 'SELECT shelf_id FROM shelf_books WHERE book_id = ?'
    : 'SELECT shelf_id FROM shelf_books WHERE 1=0'
  
  const { data: bookShelvesData, isLoading: bookShelvesLoading } = useQuery<ShelfBookRow>(
    bookShelvesQuery,
    open && bookId ? [bookId] : []
  )

  // 状态
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

  const loading = shelvesLoading || bookShelvesLoading

  // 如果查询出错，设置错误信息
  useEffect(() => {
    if (shelvesError) {
      console.error('[AddToShelfDialog] Query error:', shelvesError)
      setError(shelvesError.message || '查询书架失败')
    }
  }, [shelvesError])

  // 转换书架数据
  const shelves = useMemo(() => shelvesData || [], [shelvesData])

  // 当对话框打开或书籍书架数据变化时，更新选中状态
  useEffect(() => {
    if (open && bookShelvesData) {
      const ids = new Set(bookShelvesData.map(sb => sb.shelf_id))
      setSelectedShelfIds(ids)
      setOriginalShelfIds(ids)
      setShowCreateForm(false)
      setNewShelfName('')
      setNameError(null)
      setError(null)
    }
  }, [open, bookShelvesData])

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
    if (!name || nameError || !db) return

    setCreating(true)
    try {
      const id = generateUUID()
      const now = new Date().toISOString()

      // 获取最大排序值 - 使用 getAll 避免空结果异常
      const maxOrderResults = await db.getAll<{ max_order: number }>(
        'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM shelves'
      )
      const maxOrder = maxOrderResults[0]?.max_order ?? 0

      // 使用正确的 user_id - 从 AuthStore 获取
      const userId = useAuthStore.getState().user?.id || ''
      await db.execute(
        `INSERT INTO shelves (id, user_id, name, description, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, name, null, maxOrder + 1, now, now]
      )

      // 自动选中新创建的书架
      setSelectedShelfIds((prev) => new Set(prev).add(id))
      setNewShelfName('')
      setShowCreateForm(false)
    } catch (e: any) {
      console.error('[AddToShelfDialog] Failed to create shelf:', e)
      setError(e.message || '创建书架失败')
    } finally {
      setCreating(false)
    }
  }, [newShelfName, nameError, db])

  // 保存更改
  const handleSave = useCallback(async () => {
    if (!db) return
    
    setSaving(true)
    setError(null)

    try {
      // 计算需要添加和移除的书架
      const toAdd = [...selectedShelfIds].filter((id) => !originalShelfIds.has(id))
      const toRemove = [...originalShelfIds].filter((id) => !selectedShelfIds.has(id))

      const now = new Date().toISOString()

      // 执行添加操作
      for (const shelfId of toAdd) {
        // 检查是否已存在 - 使用 getAll 避免空结果异常
        const existingRows = await db.getAll<{ id: string }>(
          'SELECT id FROM shelf_books WHERE shelf_id = ? AND book_id = ?',
          [shelfId, bookId]
        )
        
        if (existingRows.length === 0) {
          const id = generateUUID()
          const maxOrderRows = await db.getAll<{ max_order: number }>(
            'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM shelf_books WHERE shelf_id = ?',
            [shelfId]
          )
          const maxOrder = maxOrderRows[0]?.max_order ?? 0
          
          // 使用正确的 user_id - 从 AuthStore 获取
          const userId = useAuthStore.getState().user?.id || ''
          await db.execute(
            `INSERT INTO shelf_books (id, user_id, shelf_id, book_id, sort_order, added_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [id, userId, shelfId, bookId, maxOrder + 1, now]
          )
        }
      }

      // 执行移除操作
      for (const shelfId of toRemove) {
        await db.execute(
          'DELETE FROM shelf_books WHERE shelf_id = ? AND book_id = ?',
          [shelfId, bookId]
        )
      }

      console.log('[AddToShelfDialog] Saved changes:', { added: toAdd, removed: toRemove })

      onSuccess?.()
      onClose()
    } catch (e: any) {
      console.error('[AddToShelfDialog] Failed to save:', e)
      setError(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }, [db, bookId, selectedShelfIds, originalShelfIds, onSuccess, onClose])

  // 检查是否有更改
  const hasChanges = useMemo(() => {
    if (selectedShelfIds.size !== originalShelfIds.size) return true
    for (const id of selectedShelfIds) {
      if (!originalShelfIds.has(id)) return true
    }
    return false
  }, [selectedShelfIds, originalShelfIds])

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

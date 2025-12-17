/**
 * 最近删除页面
 * 
 * 显示用户软删除的书籍（30天内可恢复）
 * 
 * 功能：
 * - 仅显示封面图（无标题和作者）
 * - 点击封面恢复书籍
 * - 批量选择和操作（恢复/永久删除）
 * - 永久删除仅删除用户私人数据，保留公共数据
 * 
 * @see 06 - UIUX设计系统UI_UX_Design_system.md
 */

import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@powersync/react'
import { usePowerSyncDatabase, usePowerSyncState } from '@/lib/powersync'
import { useAuthStore } from '@/stores/auth'
import { ArrowLeft, Trash2, RotateCcw, Clock, CheckCircle2, Square, CheckSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

// ============================================================================
// 类型定义
// ============================================================================

interface DeletedBookRow {
  id: string
  title: string
  author: string | null
  cover_url: string | null
  deleted_at: string
}

interface DeletedBookItem {
  id: string
  title: string
  author?: string
  coverUrl?: string
  deletedAt: Date
  daysRemaining: number
}

// ============================================================================
// 组件
// ============================================================================

export default function RecentlyDeletedPage() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const db = usePowerSyncDatabase()
  const { isInitialized } = usePowerSyncState()
  const accessToken = useAuthStore(s => s.accessToken)

  // 选择状态
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  // 单本删除确认状态
  const [singleDeleteBook, setSingleDeleteBook] = useState<DeletedBookItem | null>(null)

  const isReady = isInitialized && db !== null

  // 查询已删除的书籍（30天内）
  const EMPTY_QUERY = 'SELECT * FROM books WHERE 1=0'
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const deletedBooksQuery = isReady
    ? `SELECT id, title, author, cover_url, deleted_at 
       FROM books 
       WHERE deleted_at IS NOT NULL 
       AND deleted_at > '${thirtyDaysAgo}'
       ORDER BY deleted_at DESC`
    : EMPTY_QUERY

  const { data: deletedBooksData, isLoading } = useQuery<DeletedBookRow>(deletedBooksQuery, [])

  // 转换数据
  const items: DeletedBookItem[] = useMemo(() => {
    if (!deletedBooksData) return []

    const token = accessToken || localStorage.getItem('access_token') || ''
    const now = new Date()

    return deletedBooksData.map(book => {
      const deletedAt = new Date(book.deleted_at)
      const expiryDate = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000)
      const daysRemaining = Math.max(0, Math.ceil((expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))

      return {
        id: book.id,
        title: book.title || '未命名',
        author: book.author || undefined,
        coverUrl: book.id && token
          ? `/api/v1/books/${book.id}/cover?token=${encodeURIComponent(token)}`
          : undefined,
        deletedAt,
        daysRemaining,
      }
    })
  }, [deletedBooksData, accessToken])

  // 恢复单本书籍
  const handleRestore = useCallback(async (bookId: string, bookTitle: string) => {
    if (!db) return

    try {
      console.log('[RecentlyDeleted] Restoring book:', bookId)
      await db.execute(
        'UPDATE books SET deleted_at = NULL, updated_at = ? WHERE id = ?',
        [new Date().toISOString(), bookId]
      )
      
      toast.success(t('recently_deleted.restore_success', { title: bookTitle }))
    } catch (error) {
      console.error('[RecentlyDeleted] Restore failed:', error)
      toast.error(t('recently_deleted.restore_failed'))
    }
  }, [db, t])

  // 批量恢复
  const handleBatchRestore = useCallback(async () => {
    if (!db || selectedIds.size === 0) return

    try {
      const now = new Date().toISOString()
      for (const bookId of selectedIds) {
        await db.execute(
          'UPDATE books SET deleted_at = NULL, updated_at = ? WHERE id = ?',
          [now, bookId]
        )
      }
      
      toast.success(t('recently_deleted.batch_restore_success', { count: selectedIds.size }))
      setSelectedIds(new Set())
      setIsSelectionMode(false)
    } catch (error) {
      console.error('[RecentlyDeleted] Batch restore failed:', error)
      toast.error(t('recently_deleted.restore_failed'))
    }
  }, [db, selectedIds, t])

  // 永久删除（仅删除用户私人数据）
  const handlePermanentDelete = useCallback(async () => {
    if (!db || selectedIds.size === 0) return

    try {
      for (const bookId of selectedIds) {
        // 删除用户私人数据：笔记、高亮、书签、阅读进度、书架关联
        // 不删除：MinIO文件、封面、OCR结果、向量索引（公共数据）
        await db.execute('DELETE FROM notes WHERE book_id = ?', [bookId])
        await db.execute('DELETE FROM highlights WHERE book_id = ?', [bookId])
        await db.execute('DELETE FROM bookmarks WHERE book_id = ?', [bookId])
        await db.execute('DELETE FROM reading_progress WHERE book_id = ?', [bookId])
        await db.execute('DELETE FROM reading_sessions WHERE book_id = ?', [bookId])
        await db.execute('DELETE FROM shelf_books WHERE book_id = ?', [bookId])
        
        // 硬删除书籍记录
        await db.execute('DELETE FROM books WHERE id = ?', [bookId])
      }
      
      toast.success(t('recently_deleted.delete_success', { count: selectedIds.size }))
      setSelectedIds(new Set())
      setIsSelectionMode(false)
      setConfirmDeleteOpen(false)
    } catch (error) {
      console.error('[RecentlyDeleted] Permanent delete failed:', error)
      toast.error(t('recently_deleted.delete_failed'))
    }
  }, [db, selectedIds, t])

  // 单本书籍永久删除
  const handleSinglePermanentDelete = useCallback(async () => {
    if (!db || !singleDeleteBook) return

    try {
      const bookId = singleDeleteBook.id
      // 删除用户私人数据
      await db.execute('DELETE FROM notes WHERE book_id = ?', [bookId])
      await db.execute('DELETE FROM highlights WHERE book_id = ?', [bookId])
      await db.execute('DELETE FROM bookmarks WHERE book_id = ?', [bookId])
      await db.execute('DELETE FROM reading_progress WHERE book_id = ?', [bookId])
      await db.execute('DELETE FROM reading_sessions WHERE book_id = ?', [bookId])
      await db.execute('DELETE FROM shelf_books WHERE book_id = ?', [bookId])
      
      // 硬删除书籍记录
      await db.execute('DELETE FROM books WHERE id = ?', [bookId])
      
      toast.success(t('recently_deleted.delete_success', { count: 1 }))
      setSingleDeleteBook(null)
    } catch (error) {
      console.error('[RecentlyDeleted] Single permanent delete failed:', error)
      toast.error(t('recently_deleted.delete_failed'))
    }
  }, [db, singleDeleteBook, t])

  // 切换选择
  const toggleSelect = useCallback((bookId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(bookId)) {
        next.delete(bookId)
      } else {
        next.add(bookId)
      }
      return next
    })
  }, [])

  // 全选/取消全选
  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(items.map(b => b.id)))
    }
  }, [selectedIds.size, items])

  // 卡片点击处理
  const handleCardClick = useCallback((book: DeletedBookItem) => {
    if (isSelectionMode) {
      toggleSelect(book.id)
    } else {
      handleRestore(book.id, book.title)
    }
  }, [isSelectionMode, toggleSelect, handleRestore])

  // 渲染加载状态
  if (!isReady || isLoading) {
    return (
      <div className="container mx-auto px-4 py-6 pb-24 md:pb-6 max-w-7xl animate-in fade-in duration-300">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-2xl font-bold">{t('recently_deleted.title')}</h1>
        </div>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-6 pb-24 md:pb-6 max-w-7xl animate-in fade-in duration-300">
      {/* 顶部导航 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold">{t('recently_deleted.title')}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t('recently_deleted.subtitle')}
            </p>
          </div>
        </div>

        {/* 选择模式切换 */}
        {items.length > 0 && (
          <Button
            variant={isSelectionMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setIsSelectionMode(!isSelectionMode)
              if (isSelectionMode) {
                setSelectedIds(new Set())
              }
            }}
          >
            {isSelectionMode ? (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {t('common.cancel')}
              </>
            ) : (
              <>
                <Square className="h-4 w-4 mr-2" />
                {t('recently_deleted.select')}
              </>
            )}
          </Button>
        )}
      </div>

      {/* 选择模式工具栏 */}
      {isSelectionMode && items.length > 0 && (
        <div className="flex items-center justify-between mb-4 p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleSelectAll}
            >
              {selectedIds.size === items.length ? (
                <>
                  <CheckSquare className="h-4 w-4 mr-2" />
                  {t('recently_deleted.deselect_all')}
                </>
              ) : (
                <>
                  <Square className="h-4 w-4 mr-2" />
                  {t('recently_deleted.select_all')}
                </>
              )}
            </Button>
            <span className="text-sm text-muted-foreground">
              {t('recently_deleted.selected_count', { count: selectedIds.size })}
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={selectedIds.size === 0}
              onClick={handleBatchRestore}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {t('recently_deleted.batch_restore')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={selectedIds.size === 0}
              onClick={() => setConfirmDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t('recently_deleted.batch_delete')}
            </Button>
          </div>
        </div>
      )}

      {/* 空状态 */}
      {items.length === 0 && (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <Trash2 className="h-12 w-12 mb-4 opacity-20" />
          <p>{t('recently_deleted.empty')}</p>
        </div>
      )}

      {/* 书籍网格 - 只显示封面 */}
      {items.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3 sm:gap-4">
          {items.map(book => (
            <DeletedBookCard
              key={book.id}
              book={book}
              isSelected={selectedIds.has(book.id)}
              isSelectionMode={isSelectionMode}
              onClick={() => handleCardClick(book)}
              onPermanentDelete={() => setSingleDeleteBook(book)}
            />
          ))}
        </div>
      )}

      {/* 确认删除对话框 - 批量 */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('recently_deleted.confirm_delete_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('recently_deleted.confirm_delete_message', { count: selectedIds.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handlePermanentDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('recently_deleted.batch_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 确认删除对话框 - 单本 */}
      <AlertDialog open={singleDeleteBook !== null} onOpenChange={(open) => !open && setSingleDeleteBook(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('recently_deleted.confirm_delete_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('recently_deleted.confirm_delete_single', { title: singleDeleteBook?.title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSinglePermanentDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('recently_deleted.batch_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ============================================================================
// 已删除书籍卡片组件 - 仅显示封面
// ============================================================================

interface DeletedBookCardProps {
  book: DeletedBookItem
  isSelected: boolean
  isSelectionMode: boolean
  onClick: () => void
  onPermanentDelete: () => void
}

function DeletedBookCard({ book, isSelected, isSelectionMode, onClick, onPermanentDelete }: DeletedBookCardProps) {
  const { t } = useTranslation('common')

  // 处理永久删除按钮点击，阻止冒泡
  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onPermanentDelete()
  }, [onPermanentDelete])

  return (
    <div
      className={cn(
        'relative cursor-pointer',
        'transition-all duration-200 hover:scale-[1.02]',
        isSelected && 'ring-2 ring-primary ring-offset-2 rounded-lg'
      )}
      onClick={onClick}
    >
      {/* 封面图 - 只显示封面，无标题作者 */}
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden shadow-md bg-gray-200 dark:bg-gray-700">
        {book.coverUrl ? (
          <img
            src={book.coverUrl}
            alt={book.title}
            className="w-full h-full object-cover opacity-60"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <Trash2 className="h-8 w-8 opacity-30" />
          </div>
        )}

        {/* 恢复覆盖层 - 非选择模式显示 */}
        {!isSelectionMode && (
          <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center">
            <RotateCcw className="h-6 w-6 text-white mb-1" />
            <span className="text-white font-medium text-xs">
              {t('recently_deleted.tap_to_restore')}
            </span>
          </div>
        )}

        {/* 选择模式覆盖层 */}
        {isSelectionMode && (
          <div className={cn(
            'absolute inset-0 flex items-center justify-center transition-colors',
            isSelected ? 'bg-primary/30' : 'bg-black/30'
          )}>
            {isSelected ? (
              <CheckCircle2 className="h-8 w-8 text-white" />
            ) : (
              <Square className="h-8 w-8 text-white/70" />
            )}
          </div>
        )}

        {/* 剩余天数标签 */}
        <div className="absolute top-1 right-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
          <Clock className="h-2.5 w-2.5" />
          <span>{book.daysRemaining}{t('recently_deleted.days')}</span>
        </div>

        {/* 永久删除按钮 - 非选择模式显示在左上角 */}
        {!isSelectionMode && (
          <button
            onClick={handleDeleteClick}
            className="absolute top-1 left-1 p-1.5 bg-red-500/90 hover:bg-red-600 text-white rounded-full transition-colors shadow-md"
            title={t('recently_deleted.batch_delete')}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* 不显示书籍标题和作者 - 按设计规范 */}
    </div>
  )
}

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, Trash2, CheckCircle, BookOpen, Loader2, FileText, Scan, FolderPlus } from 'lucide-react'
import { cn, generateUUID } from '@/lib/utils'
import { usePowerSync } from '@powersync/react'
import { useAuthStore } from '@/stores/auth'
import BookMetadataDialog from './BookMetadataDialog'
import OcrTriggerDialog from './OcrTriggerDialog'
import AddToShelfDialog from './AddToShelfDialog'

type Props = {
  bookId: string
  bookTitle: string
  bookAuthor?: string
  isFinished?: boolean
  /** OCR 状态: 'pending' | 'processing' | 'completed' | 'failed' | null */
  ocrStatus?: string | null
  /** 是否为图片型 PDF（需要 OCR） */
  isImageBased?: boolean
  onDeleted?: () => void
  onFinishedChange?: (finished: boolean) => void
  /** 元数据更新后的回调 */
  onMetadataChange?: (metadata: { title?: string; author?: string }) => void
  /** OCR 触发成功后的回调 */
  onOcrTrigger?: () => void
  /** 按钮颜色类名 (用于智能反色) */
  buttonClassName?: string
  /** 菜单位置 */
  position?: 'left' | 'right'
}

export default function BookCardMenu({
  bookId,
  bookTitle,
  bookAuthor,
  isFinished = false,
  ocrStatus,
  isImageBased = false,
  onDeleted,
  onFinishedChange,
  onMetadataChange,
  onOcrTrigger,
  buttonClassName = 'text-white',
  position = 'right',
}: Props) {
  const { t } = useTranslation('common')
  const db = usePowerSync()
  const [open, setOpen] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showMetadataDialog, setShowMetadataDialog] = useState(false)
  const [showOcrDialog, setShowOcrDialog] = useState(false)
  const [showShelfDialog, setShowShelfDialog] = useState(false)
  const [loading, setLoading] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, openUpward: false })
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // 计算菜单位置
  const updateMenuPosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      const menuWidth = 180
      const menuHeight = 280 // 预估菜单高度
      
      // 根据 position 属性决定左右对齐
      let left = position === 'right' 
        ? rect.right - menuWidth 
        : rect.left
      
      // 确保菜单不超出视口左右边界
      if (left < 8) left = 8
      if (left + menuWidth > window.innerWidth - 8) {
        left = window.innerWidth - menuWidth - 8
      }
      
      // 检查是否需要向上打开（底部空间不足）
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      const openUpward = spaceBelow < menuHeight && spaceAbove > spaceBelow
      
      setMenuPosition({
        top: openUpward ? rect.top : rect.bottom + 4,
        left,
        openUpward
      })
    }
  }, [position])

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    
    const handleScroll = () => {
      if (open) {
        updateMenuPosition()
      }
    }
    
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      window.addEventListener('scroll', handleScroll, true)
      window.addEventListener('resize', updateMenuPosition)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
        window.removeEventListener('scroll', handleScroll, true)
        window.removeEventListener('resize', updateMenuPosition)
      }
    }
  }, [open, updateMenuPosition])

  const handleToggleFinished = async () => {
    setLoading(true)
    
    const newFinishedState = !isFinished
    const now = new Date().toISOString()
    const userId = useAuthStore.getState().user?.id || ''
    const deviceId = getDeviceId()
    
    try {
      // 使用 reading_progress 表更新进度
      // progress = 1.0 表示已读完, finished_at 记录完成时间
      const newProgress = newFinishedState ? 1.0 : 0.0
      const finishedAt = newFinishedState ? now : null
      
      // 检查是否已有进度记录 - 使用 book_id + user_id 匹配
      const existing = await db.getAll<{ id: string }>(
        'SELECT id FROM reading_progress WHERE book_id = ? AND user_id = ?',
        [bookId, userId]
      )
      
      if (existing.length > 0) {
        // 更新现有记录 - 使用 book_id + user_id 匹配
        await db.execute(
          'UPDATE reading_progress SET progress = ?, finished_at = ?, updated_at = ? WHERE book_id = ? AND user_id = ?',
          [newProgress, finishedAt, now, bookId, userId]
        )
      } else {
        // 插入新记录
        await db.execute(
          `INSERT INTO reading_progress (id, book_id, user_id, device_id, progress, finished_at, updated_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [generateUUID(), bookId, userId, deviceId, newProgress, finishedAt, now]
        )
      }
      
      // 同时更新 books 表的 updated_at
      await db.execute(
        'UPDATE books SET updated_at = ? WHERE id = ?',
        [now, bookId]
      )
      
      console.log('[BookCardMenu] Updated finished status:', bookId, newFinishedState)
      
      onFinishedChange?.(newFinishedState)
      setOpen(false)
    } catch (e) {
      console.error('Failed to toggle finished status:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    setLoading(true)
    try {
      console.log('[BookCardMenu] Soft deleting book:', bookId)
      console.log('[BookCardMenu] Database instance:', db)
      
      if (!db) {
        console.error('[BookCardMenu] Database not available!')
        return
      }
      
      // 软删除：设置 deleted_at 时间戳，保留30天
      const now = new Date().toISOString()
      console.log('[BookCardMenu] Executing UPDATE with:', { now, bookId })
      
      await db.execute(
        'UPDATE books SET deleted_at = ?, updated_at = ? WHERE id = ?',
        [now, now, bookId]
      )
      
      console.log('[BookCardMenu] Execute completed, checking CRUD queue...')
      
      // 检查 CRUD 队列
      try {
        const crudCount = await db.getAll('SELECT count(*) as count FROM ps_crud')
        console.log('[BookCardMenu] CRUD queue count:', crudCount)
      } catch (e) {
        console.log('[BookCardMenu] Could not check CRUD queue:', e)
      }
      
      // 注意：不删除本地文件，保留用于恢复
      // await bookStorage.deleteBook(bookId) // 移除硬删除
      
      console.log('[BookCardMenu] Book soft deleted successfully')
      setShowConfirm(false)
      setOpen(false)
      
      onDeleted?.()
    } catch (e) {
      console.error('[BookCardMenu] Failed to soft delete book:', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* 触发按钮 */}
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          updateMenuPosition()
          setOpen(!open)
        }}
        className={cn(
          'p-2 rounded-full transition-colors',
          'hover:bg-black/10 dark:hover:bg-white/20',
          buttonClassName
        )}
        aria-label={t('common.more_actions')}
      >
        <MoreHorizontal className="w-5 h-5" />
      </button>

      {/* 下拉菜单 - 使用 Portal 渲染到 body 层，避免被父容器裁剪 */}
      {open && createPortal(
        <div
          ref={menuRef}
          className={cn(
            'fixed min-w-[180px]',
            'bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl',
            'shadow-2xl border border-gray-200/50 dark:border-white/10',
            'rounded-xl overflow-hidden',
            'animate-in fade-in-0 zoom-in-95 duration-fast',
            'z-[9999]'
          )}
          style={{ 
            top: menuPosition.openUpward ? 'auto' : menuPosition.top,
            bottom: menuPosition.openUpward ? `${window.innerHeight - menuPosition.top + 4}px` : 'auto',
            left: menuPosition.left,
            transformOrigin: menuPosition.openUpward 
              ? (position === 'right' ? 'bottom right' : 'bottom left')
              : (position === 'right' ? 'top right' : 'top left')
          }}
        >
          {/* 编辑书籍信息 */}
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setShowMetadataDialog(true)
              setOpen(false)
            }}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3',
              'text-left text-sm font-medium',
              'text-label hover:bg-secondary-background',
              'transition-colors duration-fast'
            )}
          >
            <FileText className="w-4 h-4 text-system-blue" />
            <span>{t('book_menu.edit_info')}</span>
          </button>

          {/* OCR 本书 - 仅对图片型 PDF 且未完成 OCR 显示 */}
          {isImageBased && (ocrStatus === null || ocrStatus === 'failed') && (
            <button
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setShowOcrDialog(true)
                setOpen(false)
              }}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3',
                'text-left text-sm font-medium',
                'text-label hover:bg-secondary-background',
                'transition-colors duration-fast'
              )}
            >
              <Scan className="w-4 h-4 text-system-orange" />
              <span>{t('book_menu.ocr_book')}</span>
            </button>
          )}
          
          {/* OCR 进行中 - 显示进度状态 */}
          {isImageBased && (ocrStatus === 'processing' || ocrStatus === 'pending') && (
            <div
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3',
                'text-left text-sm font-medium',
                'text-secondary-label'
              )}
            >
              <Loader2 className="w-4 h-4 animate-spin text-system-orange" />
              <span>{t('book_menu.ocr_processing')}</span>
            </div>
          )}

          {/* 加入书架 */}
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setShowShelfDialog(true)
              setOpen(false)
            }}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3',
              'text-left text-sm font-medium',
              'text-label hover:bg-secondary-background',
              'transition-colors duration-fast'
            )}
          >
            <FolderPlus className="w-4 h-4 text-system-purple" />
            <span>{t('shelf.add_to_shelf')}</span>
          </button>

          {/* 分隔线 */}
          <div className="h-px bg-separator mx-2" />
          
          {/* 标记为已读完 / 继续阅读 */}
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleToggleFinished()
            }}
            disabled={loading}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3',
              'text-left text-sm font-medium',
              'text-label hover:bg-secondary-background',
              'transition-colors duration-fast',
              'disabled:opacity-50'
            )}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin text-secondary-label" />
            ) : isFinished ? (
              <BookOpen className="w-4 h-4 text-system-blue" />
            ) : (
              <CheckCircle className="w-4 h-4 text-system-green" />
            )}
            <span>
              {isFinished ? t('book_menu.mark_continue') : t('book_menu.mark_finished')}
            </span>
          </button>

          {/* 分隔线 */}
          <div className="h-px bg-separator mx-2" />

          {/* 移除本书 */}
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setShowConfirm(true)
              setOpen(false)
            }}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3',
              'text-left text-sm font-medium',
              'text-system-red hover:bg-system-red/10',
              'transition-colors duration-fast'
            )}
          >
            <Trash2 className="w-4 h-4" />
            <span>{t('book_menu.remove_book')}</span>
          </button>
        </div>,
        document.body
      )}

      {/* 删除确认对话框 */}
      {showConfirm && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          {/* 遮罩层 */}
          <div
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            onClick={() => setShowConfirm(false)}
          />

          {/* 对话框内容 */}
          <div
            className={cn(
              'relative w-full max-w-sm',
              'bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl',
              'shadow-2xl border border-gray-200/50 dark:border-white/10',
              'rounded-2xl p-6',
              'animate-in fade-in-0 zoom-in-95 duration-fast'
            )}
          >
            <div className="flex flex-col items-center text-center">
              {/* 警告图标 */}
              <div className="w-12 h-12 rounded-full bg-system-red/10 flex items-center justify-center mb-4">
                <Trash2 className="w-6 h-6 text-system-red" />
              </div>

              {/* 标题 */}
              <h3 className="text-lg font-bold text-label mb-2">
                {t('book_menu.confirm_remove_title', '确认删除')}
              </h3>

              {/* 书名 */}
              <p className="text-base font-medium text-label mb-2 line-clamp-2">
                "{bookTitle}"
              </p>

              {/* 30天恢复提示 */}
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-6 w-full">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  {t('book_menu.soft_delete_notice', '书籍将移至「最近删除」，30天后自动永久删除。在此期间可随时恢复。')}
                </p>
              </div>

              {/* 按钮组 */}
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setShowConfirm(false)}
                  disabled={loading}
                  className={cn(
                    'flex-1 py-3 px-4 rounded-full',
                    'bg-secondary-background text-label',
                    'border border-separator',
                    'font-medium text-sm',
                    'hover:bg-tertiary-background transition-colors',
                    'disabled:opacity-50'
                  )}
                >
                  {t('common.cancel', '取消')}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={loading}
                  className={cn(
                    'flex-1 py-3 px-4 rounded-full',
                    'bg-system-red text-white',
                    'font-medium text-sm',
                    'hover:opacity-90 transition-opacity',
                    'disabled:opacity-50',
                    'flex items-center justify-center gap-2'
                  )}
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t('book_menu.remove_confirm', '确认删除')}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 元数据编辑对话框 */}
      <BookMetadataDialog
        bookId={bookId}
        initialTitle={bookTitle}
        initialAuthor={bookAuthor}
        open={showMetadataDialog}
        onClose={() => setShowMetadataDialog(false)}
        onSuccess={(metadata) => {
          onMetadataChange?.(metadata)
        }}
      />

      {/* OCR 触发对话框 */}
      <OcrTriggerDialog
        bookId={bookId}
        bookTitle={bookTitle}
        open={showOcrDialog}
        onClose={() => setShowOcrDialog(false)}
        onSuccess={() => {
          onOcrTrigger?.()
        }}
      />

      {/* 加入书架对话框 */}
      <AddToShelfDialog
        bookId={bookId}
        bookTitle={bookTitle}
        open={showShelfDialog}
        onClose={() => setShowShelfDialog(false)}
      />
    </>
  )
}

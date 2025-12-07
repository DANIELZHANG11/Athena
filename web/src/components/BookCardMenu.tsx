import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, Trash2, CheckCircle, BookOpen, Loader2, FileText, Scan, FolderPlus } from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { cn } from '@/lib/utils'
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
    try {
      const at = useAuthStore.getState().accessToken || ''
      const res = await fetch('/api/v1/reader/mark-finished', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${at}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ book_id: bookId, finished: !isFinished }),
      })
      if (res.ok) {
        onFinishedChange?.(!isFinished)
        setOpen(false)
      }
    } catch (e) {
      console.error('Failed to toggle finished status:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    setLoading(true)
    try {
      const at = useAuthStore.getState().accessToken || ''
      console.log('[BookCardMenu] Deleting book:', bookId)
      const res = await fetch(`/api/v1/books/${bookId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${at}` },
      })
      console.log('[BookCardMenu] Delete response status:', res.status)
      if (res.ok) {
        console.log('[BookCardMenu] Book deleted successfully, calling onDeleted callback')
        setShowConfirm(false)
        setOpen(false)
        // 确保状态更新后再调用回调
        setTimeout(() => {
          onDeleted?.()
        }, 100)
      } else {
        const errorData = await res.json().catch(() => ({}))
        console.error('[BookCardMenu] Delete failed:', res.status, errorData)
      }
    } catch (e) {
      console.error('[BookCardMenu] Failed to delete book:', e)
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
          {isImageBased && ocrStatus !== 'completed' && ocrStatus !== 'processing' && ocrStatus !== 'pending' && (
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

      {/* 删除确认对话框 - 遵循 UIUX 毛玻璃规范，使用 Portal 避免 transform 影响 */}
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
                {t('book_menu.confirm_remove_title')}
              </h3>

              {/* 书名 */}
              <p className="text-base font-medium text-label mb-2 line-clamp-2">
                "{bookTitle}"
              </p>

              {/* 警告文案 */}
              <p className="text-sm text-secondary-label mb-6">
                {t('book_menu.confirm_remove_message')}
              </p>

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
                  {t('common.cancel')}
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
                  {t('book_menu.remove_confirm')}
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

import { useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  children: React.ReactNode
  onClose?: () => void
  showCloseButton?: boolean
  /** 自定义类名 */
  className?: string
}

export default function Modal({ children, onClose, showCloseButton = false, className }: ModalProps) {
  // ESC 键关闭
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && onClose) {
      onClose()
    }
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    // 阻止背景滚动
    document.body.style.overflow = 'hidden'
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [handleKeyDown])

  // 点击遮罩关闭
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && onClose) {
      onClose()
    }
  }, [onClose])

  return createPortal(
    <div 
      className="fixed inset-0 z-[100] grid place-items-center bg-black/20 backdrop-blur-sm animate-in fade-in-0 duration-fast"
      onClick={handleBackdropClick}
    >
      <div 
        className={cn(
          // 白色毛玻璃效果 + 强阴影 (统一风格)
          // 移动端适配: w-[calc(100%-2rem)] 确保左右留有间隙, max-w-md 限制最大宽度
          'relative w-[calc(100%-2rem)] max-w-md rounded-2xl p-6',
          'bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl',
          'shadow-2xl',
          'border border-gray-200/50 dark:border-white/10',
          // 缩放进入动效 - 从中心由小变大
          'animate-in fade-in-0 zoom-in-95 duration-fast',
          className
        )}
        style={{ transformOrigin: 'center' }}
        onClick={(e) => e.stopPropagation()}
      >
        {showCloseButton && onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full hover:bg-secondary-background transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5 text-secondary-label" />
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body
  )
}
/**
 * NoteConflictContext.tsx
 * 
 * 笔记冲突全局管理 Context
 * 
 * 功能:
 * - 全局监听笔记冲突事件
 * - 显示冲突解决对话框
 * - 冲突队列管理（多个冲突依次处理）
 * 
 * @see NoteConflictDialog - 冲突解决对话框组件
 * @see useSmartHeartbeat - 心跳同步中的冲突检测
 */

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { NoteConflictDialog, type ConflictNote, type OriginalNote } from '@/components/NoteConflictDialog'

interface ConflictItem {
  bookId: string
  conflictNote: ConflictNote
  originalNote: OriginalNote
}

interface NoteConflictContextValue {
  /** 添加冲突到队列 */
  addConflict: (item: ConflictItem) => void
  /** 当前待处理的冲突数量 */
  conflictCount: number
  /** 清空所有冲突 */
  clearConflicts: () => void
}

const NoteConflictContext = createContext<NoteConflictContextValue | null>(null)

export function useNoteConflict(): NoteConflictContextValue {
  const context = useContext(NoteConflictContext)
  if (!context) {
    throw new Error('useNoteConflict must be used within NoteConflictProvider')
  }
  return context
}

interface NoteConflictProviderProps {
  children: ReactNode
}

export function NoteConflictProvider({ children }: NoteConflictProviderProps) {
  // 冲突队列
  const [conflictQueue, setConflictQueue] = useState<ConflictItem[]>([])
  // 当前正在处理的冲突
  const [currentConflict, setCurrentConflict] = useState<ConflictItem | null>(null)
  // 对话框是否打开
  const [dialogOpen, setDialogOpen] = useState(false)

  // 添加冲突到队列
  const addConflict = useCallback((item: ConflictItem) => {
    setConflictQueue(prev => {
      // 避免重复添加同一个冲突
      const exists = prev.some(c => c.conflictNote.id === item.conflictNote.id)
      if (exists) return prev
      return [...prev, item]
    })
  }, [])

  // 清空所有冲突
  const clearConflicts = useCallback(() => {
    setConflictQueue([])
    setCurrentConflict(null)
    setDialogOpen(false)
  }, [])

  // 处理队列中的下一个冲突
  const processNextConflict = useCallback(() => {
    if (conflictQueue.length > 0) {
      const [next, ...rest] = conflictQueue
      setCurrentConflict(next)
      setConflictQueue(rest)
      setDialogOpen(true)
    } else {
      setCurrentConflict(null)
      setDialogOpen(false)
    }
  }, [conflictQueue])

  // 当队列有新冲突且没有正在处理的冲突时，开始处理
  useEffect(() => {
    if (!currentConflict && conflictQueue.length > 0) {
      processNextConflict()
    }
  }, [currentConflict, conflictQueue.length, processNextConflict])

  // 冲突解决后的回调
  const handleResolved = useCallback((resolution: 'keep_original' | 'keep_conflict' | 'keep_both') => {
    console.log('[NoteConflictContext] Conflict resolved:', resolution)
    // 处理下一个冲突
    processNextConflict()
  }, [processNextConflict])

  // 对话框关闭回调（用户可能点击了关闭按钮）
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      // 用户关闭对话框，跳过当前冲突，处理下一个
      processNextConflict()
    }
  }, [processNextConflict])

  // 监听全局冲突事件（由 useSmartHeartbeat 触发）
  useEffect(() => {
    const handleConflictEvent = (event: CustomEvent<ConflictItem>) => {
      addConflict(event.detail)
    }

    window.addEventListener('note-conflict', handleConflictEvent as EventListener)
    return () => {
      window.removeEventListener('note-conflict', handleConflictEvent as EventListener)
    }
  }, [addConflict])

  const value: NoteConflictContextValue = {
    addConflict,
    conflictCount: conflictQueue.length + (currentConflict ? 1 : 0),
    clearConflicts,
  }

  return (
    <NoteConflictContext.Provider value={value}>
      {children}
      
      {/* 冲突解决对话框 */}
      <NoteConflictDialog
        open={dialogOpen}
        onOpenChange={handleOpenChange}
        conflictNote={currentConflict?.conflictNote ?? null}
        originalNote={currentConflict?.originalNote ?? null}
        bookId={currentConflict?.bookId ?? ''}
        onResolved={handleResolved}
      />
    </NoteConflictContext.Provider>
  )
}

/**
 * 触发笔记冲突事件（供外部调用）
 */
export function dispatchNoteConflict(conflict: ConflictItem): void {
  window.dispatchEvent(new CustomEvent('note-conflict', { detail: conflict }))
}

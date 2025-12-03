/**
 * NoteConflictDialog - 笔记冲突解决对话框
 * 
 * 当多设备同步时检测到笔记冲突，显示此对话框让用户选择解决方案：
 * 1. 保留本设备版本
 * 2. 保留其他设备版本
 * 3. 保留两者（创建副本）
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, Copy, Monitor, Smartphone } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import api from '@/lib/api'

export interface ConflictNote {
  /** 冲突副本的服务器 ID */
  id: string
  /** 笔记内容 */
  content: string
  /** 创建设备 */
  deviceId: string
  /** 创建时间 */
  createdAt: string
  /** 原始笔记 ID（被冲突的笔记） */
  conflictOf: string
  /** 位置信息 */
  location?: string
  /** 章节 */
  chapter?: string
}

export interface OriginalNote {
  id: string
  content: string
  deviceId: string
  updatedAt: string
  location?: string
  chapter?: string
}

interface NoteConflictDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 冲突副本 */
  conflictNote: ConflictNote | null
  /** 原始笔记 */
  originalNote: OriginalNote | null
  /** 书籍 ID */
  bookId: string
  /** 解决完成回调 */
  onResolved?: (resolution: 'keep_original' | 'keep_conflict' | 'keep_both') => void
}

export function NoteConflictDialog({
  open,
  onOpenChange,
  conflictNote,
  originalNote,
  bookId,
  onResolved,
}: NoteConflictDialogProps) {
  const { t } = useTranslation('common')
  const [isResolving, setIsResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleResolve = async (resolution: 'keep_original' | 'keep_conflict' | 'keep_both') => {
    if (!conflictNote || !originalNote) return

    setIsResolving(true)
    setError(null)

    try {
      await api.post(`/books/${bookId}/notes/${conflictNote.id}/resolve-conflict`, {
        resolution,
        original_note_id: originalNote.id,
      })

      onResolved?.(resolution)
      onOpenChange(false)
    } catch (err) {
      console.error('[NoteConflictDialog] Failed to resolve:', err)
      setError(t('conflict.error.resolve_failed'))
    } finally {
      setIsResolving(false)
    }
  }

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString()
    } catch {
      return dateStr
    }
  }

  const getDeviceIcon = (deviceId: string) => {
    if (deviceId.startsWith('web_')) {
      return <Monitor className="h-4 w-4" />
    }
    return <Smartphone className="h-4 w-4" />
  }

  const getDeviceName = (deviceId: string) => {
    if (deviceId.startsWith('web_')) {
      return t('conflict.device.web')
    }
    if (deviceId.startsWith('ios_')) {
      return t('conflict.device.ios')
    }
    if (deviceId.startsWith('android_')) {
      return t('conflict.device.android')
    }
    return t('conflict.device.unknown')
  }

  if (!conflictNote || !originalNote) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {t('conflict.dialog.title')}
          </DialogTitle>
          <DialogDescription>
            {t('conflict.dialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
          {/* 原始笔记 */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                {t('conflict.label.original')}
              </span>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {getDeviceIcon(originalNote.deviceId)}
                <span>{getDeviceName(originalNote.deviceId)}</span>
              </div>
            </div>
            <ScrollArea className="h-32 rounded border p-2 bg-muted/30">
              <p className="text-sm whitespace-pre-wrap">{originalNote.content}</p>
            </ScrollArea>
            <p className="text-xs text-muted-foreground">
              {t('conflict.label.updated_at')}: {formatDate(originalNote.updatedAt)}
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleResolve('keep_original')}
              disabled={isResolving}
            >
              <Check className="h-4 w-4 mr-2" />
              {t('conflict.action.keep_this')}
            </Button>
          </div>

          {/* 冲突副本 */}
          <div className="border rounded-lg p-4 space-y-3 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                {t('conflict.label.conflict_copy')}
              </span>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {getDeviceIcon(conflictNote.deviceId)}
                <span>{getDeviceName(conflictNote.deviceId)}</span>
              </div>
            </div>
            <ScrollArea className="h-32 rounded border p-2 bg-background">
              <p className="text-sm whitespace-pre-wrap">{conflictNote.content}</p>
            </ScrollArea>
            <p className="text-xs text-muted-foreground">
              {t('conflict.label.created_at')}: {formatDate(conflictNote.createdAt)}
            </p>
            <Button
              variant="outline"
              className="w-full border-amber-300 dark:border-amber-700"
              onClick={() => handleResolve('keep_conflict')}
              disabled={isResolving}
            >
              <Check className="h-4 w-4 mr-2" />
              {t('conflict.action.keep_this')}
            </Button>
          </div>
        </div>

        {/* 位置信息 */}
        {(originalNote.chapter || originalNote.location) && (
          <div className="text-xs text-muted-foreground border-t pt-3">
            {originalNote.chapter && (
              <span>{t('conflict.label.chapter')}: {originalNote.chapter}</span>
            )}
            {originalNote.location && (
              <span className="ml-4">{t('conflict.label.location')}: {originalNote.location}</span>
            )}
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/30 rounded-lg text-sm">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
            <span className="text-red-700 dark:text-red-300">{error}</span>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="secondary"
            onClick={() => handleResolve('keep_both')}
            disabled={isResolving}
            className="flex-1"
          >
            <Copy className="h-4 w-4 mr-2" />
            {t('conflict.action.keep_both')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isResolving}
          >
            {t('conflict.action.decide_later')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 冲突列表组件 - 显示所有待解决的冲突
 */
interface ConflictListProps {
  bookId: string
  conflicts: Array<{
    conflictNote: ConflictNote
    originalNote: OriginalNote
  }>
  onResolve: (conflictId: string, resolution: 'keep_original' | 'keep_conflict' | 'keep_both') => void
}

export function NoteConflictList({ bookId, conflicts, onResolve }: ConflictListProps) {
  const { t } = useTranslation('common')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  if (conflicts.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-4 w-4" />
        <span className="text-sm font-medium">
          {t('conflict.list.title', { count: conflicts.length })}
        </span>
      </div>

      <div className="space-y-2">
        {conflicts.map((conflict, index) => (
          <button
            key={conflict.conflictNote.id}
            onClick={() => setSelectedIndex(index)}
            className="w-full text-left p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors"
          >
            <p className="text-sm line-clamp-2">{conflict.conflictNote.content}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {new Date(conflict.conflictNote.createdAt).toLocaleString()}
            </p>
          </button>
        ))}
      </div>

      {selectedIndex !== null && conflicts[selectedIndex] && (
        <NoteConflictDialog
          open={true}
          onOpenChange={(open) => !open && setSelectedIndex(null)}
          conflictNote={conflicts[selectedIndex].conflictNote}
          originalNote={conflicts[selectedIndex].originalNote}
          bookId={bookId}
          onResolved={(resolution) => {
            onResolve(conflicts[selectedIndex].conflictNote.id, resolution)
            setSelectedIndex(null)
          }}
        />
      )}
    </div>
  )
}

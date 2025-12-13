/**
 * ConflictResolverDialog.tsx - 笔记冲突解决对话框 (PowerSync 版)
 * 
 * PowerSync 采用 conflict_copy 策略，冲突会自动创建副本
 * 此组件提供简化的冲突查看界面
 * 
 * @see 09 - APP-FIRST架构改造计划.md
 * @see docker/powersync/sync_rules.yaml - conflict_resolution: conflict_copy
 */

import React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertCircle } from 'lucide-react'

interface ConflictResolverDialogProps {
  /** 是否打开对话框 */
  open: boolean
  /** 关闭对话框回调 */
  onClose: () => void
  /** 解决冲突后的回调 */
  onResolved?: () => void
}

/**
 * 冲突解决对话框组件 (PowerSync 版)
 * 
 * PowerSync 自动处理冲突，此对话框仅作为通知
 */
export function ConflictResolverDialog({
  open,
  onClose,
}: ConflictResolverDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-amber-500" />
            同步冲突已处理
          </DialogTitle>
          <DialogDescription>
            PowerSync 已自动创建冲突副本。您可以在笔记列表中查看并手动合并。
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 text-sm text-gray-600 dark:text-gray-400">
          <p>当同一笔记在多个设备上被修改时，系统会自动保留所有版本：</p>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>原始版本保持不变</li>
            <li>冲突版本会标记为副本</li>
            <li>您可以选择保留或删除任一版本</li>
          </ul>
        </div>

        <div className="flex justify-end">
          <Button onClick={onClose}>
            我知道了
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ConflictResolverDialog

/**
 * OfflineIndicator.tsx
 * 
 * 离线状态指示器组件
 * 
 * 功能:
 * - 顶部固定横幅，离线时显示
 * - Apple 风格的橙色警告样式
 * - 显示离线持续时间和待同步项数量
 * - 网络恢复时自动隐藏（带动画）
 * 
 * @see App-First改造计划.md - Phase 1.2
 */

import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { WifiOff, RefreshCw, CloudOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useOnlineStatus, formatOfflineDuration } from '@/hooks/useOnlineStatus'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/components/ui/utils'

export interface OfflineIndicatorProps {
  /** 待同步项数量 */
  pendingCount?: number
  /** 自定义类名 */
  className?: string
  /** 是否显示在固定位置（顶部） */
  fixed?: boolean
}

/**
 * 离线状态指示器组件
 * 
 * @example
 * ```tsx
 * // 基础用法
 * <OfflineIndicator />
 * 
 * // 显示待同步数量
 * <OfflineIndicator pendingCount={5} />
 * 
 * // 非固定位置（嵌入到其他容器）
 * <OfflineIndicator fixed={false} className="rounded-lg" />
 * ```
 */
export function OfflineIndicator({
  pendingCount = 0,
  className,
  fixed = true
}: OfflineIndicatorProps) {
  const { t } = useTranslation('common')
  const { isOnline, offlineDuration } = useOnlineStatus()

  // 在线时不显示
  if (isOnline) return null

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{
            duration: 0.3,
            ease: [0.22, 1, 0.36, 1]  // Apple 风格 easing
          }}
          className={cn(
            // 基础样式
            'flex items-center justify-center gap-2 px-4 py-2',
            'bg-linear-to-r from-orange-500 to-amber-500',
            'text-white text-sm font-medium',
            'shadow-lg',
            // 固定位置样式
            fixed && 'fixed top-0 left-0 right-0 z-50',
            // 非固定位置可自定义
            !fixed && 'rounded-lg',
            className
          )}
          role="alert"
          aria-live="polite"
        >
          {/* 离线图标 */}
          <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />

          {/* 主文案 */}
          <span className="shrink-0">
            {t('offline.mode', '离线模式')}
          </span>

          {/* 分隔符 */}
          <span className="text-white/60 hidden sm:inline">—</span>

          {/* 附加信息 */}
          <span className="text-white/90 text-xs sm:text-sm hidden sm:inline">
            {t('offline.sync_when_online', '您的操作将在恢复网络后同步')}
          </span>

          {/* 待同步数量徽章 */}
          {pendingCount > 0 && (
            <Badge
              variant="outline"
              className="bg-white/20 border-white/30 text-white text-xs ml-1"
            >
              <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
              {t('offline.pending_count', '{{count}} 项待同步', { count: pendingCount })}
            </Badge>
          )}

          {/* 离线时长（仅在长时间离线时显示） */}
          {offlineDuration > 60000 && (
            <span className="text-white/70 text-xs hidden md:inline ml-2">
              {t('offline.duration', '已离线 {{duration}}', {
                duration: formatOfflineDuration(offlineDuration)
              })}
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * 简洁的离线状态徽章
 * 用于在界面某个角落显示离线状态
 */
export function OfflineBadge({ className }: { className?: string }) {
  const { t } = useTranslation('common')
  const { isOnline } = useOnlineStatus()

  if (isOnline) return null

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.2 }}
        >
          <Badge
            variant="outline"
            className={cn(
              'bg-orange-100 border-orange-300 text-orange-700',
              'dark:bg-orange-900/30 dark:border-orange-700 dark:text-orange-300',
              className
            )}
          >
            <CloudOff className="w-3 h-3 mr-1" />
            {t('offline.badge', '离线')}
          </Badge>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default OfflineIndicator

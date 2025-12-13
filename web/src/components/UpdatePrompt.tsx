/**
 * UpdatePrompt.tsx - PWA 更新提示组件
 * 
 * 功能:
 * - 检测 Service Worker 更新
 * - 显示更新提示 Toast
 * - 一键刷新更新
 * 
 * @see App-First改造计划.md - Phase 4.2
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, X } from 'lucide-react'

interface UpdatePromptProps {
  /** 自动检查更新间隔（毫秒），0 表示禁用 */
  checkInterval?: number
}

export function UpdatePrompt({ checkInterval = 60 * 60 * 1000 }: UpdatePromptProps) {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(false)

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      console.log('[PWA] Service Worker registered:', swUrl)

      // 定期检查更新
      if (checkInterval > 0 && registration) {
        setInterval(() => {
          console.log('[PWA] Checking for updates...')
          registration.update()
        }, checkInterval)
      }
    },
    onRegisterError(error) {
      console.error('[PWA] Service Worker registration error:', error)
    },
  })

  // 显示离线就绪通知（可选，3秒后自动消失）
  useEffect(() => {
    if (offlineReady) {
      console.log('[PWA] App is ready for offline use')
      const timer = setTimeout(() => {
        setOfflineReady(false)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [offlineReady, setOfflineReady])

  // 处理更新
  const handleUpdate = () => {
    updateServiceWorker(true)
  }

  // 关闭提示
  const handleDismiss = () => {
    setDismissed(true)
    setNeedRefresh(false)
  }

  // 如果用户已关闭提示，不再显示
  if (dismissed && !needRefresh) {
    return null
  }

  return (
    <AnimatePresence>
      {/* 更新提示 */}
      {needRefresh && !dismissed && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.95 }}
          transition={{ duration: 0.3 }}
          className="fixed bottom-4 right-4 z-50 max-w-sm"
        >
          <div className="rounded-lg bg-indigo-600 p-4 shadow-lg shadow-indigo-500/25">
            <div className="flex items-start gap-3">
              <div className="shrink-0">
                <RefreshCw className="h-6 w-6 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-white">
                  {t('pwa.updateAvailable', '发现新版本')}
                </p>
                <p className="mt-1 text-sm text-indigo-100">
                  {t('pwa.updateDescription', '点击更新以获取最新功能和修复')}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={handleUpdate}
                    className="rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-indigo-600 shadow-sm hover:bg-indigo-50"
                  >
                    {t('pwa.updateNow', '立即更新')}
                  </button>
                  <button
                    onClick={handleDismiss}
                    className="rounded-md px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
                  >
                    {t('pwa.updateLater', '稍后')}
                  </button>
                </div>
              </div>
              <button
                onClick={handleDismiss}
                className="shrink-0 rounded-md p-1 text-indigo-200 hover:bg-indigo-500 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* 离线就绪提示（短暂显示） */}
      {offlineReady && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          transition={{ duration: 0.3 }}
          className="fixed bottom-4 right-4 z-50"
        >
          <div className="rounded-lg bg-green-600 px-4 py-3 shadow-lg">
            <p className="text-sm font-medium text-white">
              ✓ {t('pwa.offlineReady', '应用已准备好离线使用')}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default UpdatePrompt

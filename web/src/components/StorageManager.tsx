/**
 * StorageManager.tsx - 存储空间管理组件
 * 
 * 功能:
 * - 显示存储空间使用情况
 * - 分类显示（书籍、缓存、笔记等）
 * - 清理功能（LRU 策略）
 * - 存储配额警告
 * 
 * @see App-First改造计划.md - Phase 5
 */

import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import {
  Cloud,
  Trash2,
  AlertTriangle,
  BookOpen,
  FileText,
  Image,
  Archive,
} from 'lucide-react'

interface StorageBreakdown {
  books: number
  notes: number
  cache: number
  other: number
  total: number
}

interface StorageInfo {
  used: number
  quota: number
  usagePercent: number
  breakdown: StorageBreakdown
}

interface StorageManagerProps {
  /** 存储使用率警告阈值（0-1） */
  warningThreshold?: number
  /** 是否显示详细分类 */
  showBreakdown?: boolean
  /** 清理完成回调 */
  onCleanup?: (freedBytes: number) => void
}

// 格式化字节数
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function StorageManager({
  warningThreshold = 0.8,
  showBreakdown = true,
  onCleanup,
}: StorageManagerProps) {
  const { t } = useTranslation()
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isCleaning, setIsCleaning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 获取存储信息
  const fetchStorageInfo = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      // 检查 Storage Manager API 支持
      if (!navigator.storage?.estimate) {
        throw new Error('Storage Manager API not supported')
      }

      const estimate = await navigator.storage.estimate()
      const used = estimate.usage || 0
      const quota = estimate.quota || 0

      // 估算各类数据大小
      const breakdown: StorageBreakdown = {
        books: 0,
        notes: 0,
        cache: 0,
        other: 0,
        total: used,
      }

      // 尝试获取 IndexedDB 数据库大小
      if ('indexedDB' in window) {
        try {
          // 估算书籍数据库大小
          const booksDb = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('athena_books', 3)
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })

          const booksTransaction = booksDb.transaction(['books', 'chapters'], 'readonly')
          let booksSize = 0

          await Promise.all([
            new Promise<void>((resolve) => {
              const request = booksTransaction.objectStore('books').openCursor()
              request.onsuccess = () => {
                const cursor = request.result
                if (cursor) {
                  booksSize += JSON.stringify(cursor.value).length
                  cursor.continue()
                } else {
                  resolve()
                }
              }
            }),
            new Promise<void>((resolve) => {
              const request = booksTransaction.objectStore('chapters').openCursor()
              request.onsuccess = () => {
                const cursor = request.result
                if (cursor) {
                  booksSize += JSON.stringify(cursor.value).length
                  cursor.continue()
                } else {
                  resolve()
                }
              }
            }),
          ])

          booksDb.close()
          breakdown.books = booksSize

          // 估算笔记数据库大小
          const notesDb = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('athena_notes', 1)
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })

          const notesTransaction = notesDb.transaction(['notes', 'highlights'], 'readonly')
          let notesSize = 0

          await Promise.all([
            new Promise<void>((resolve) => {
              const request = notesTransaction.objectStore('notes').openCursor()
              request.onsuccess = () => {
                const cursor = request.result
                if (cursor) {
                  notesSize += JSON.stringify(cursor.value).length
                  cursor.continue()
                } else {
                  resolve()
                }
              }
            }),
            new Promise<void>((resolve) => {
              const request = notesTransaction.objectStore('highlights').openCursor()
              request.onsuccess = () => {
                const cursor = request.result
                if (cursor) {
                  notesSize += JSON.stringify(cursor.value).length
                  cursor.continue()
                } else {
                  resolve()
                }
              }
            }),
          ])

          notesDb.close()
          breakdown.notes = notesSize
        } catch (e) {
          console.warn('[StorageManager] Failed to estimate IndexedDB size:', e)
        }
      }

      // 估算缓存大小
      if ('caches' in window) {
        try {
          const cacheNames = await caches.keys()
          for (const cacheName of cacheNames) {
            const cache = await caches.open(cacheName)
            const keys = await cache.keys()
            for (const request of keys) {
              const response = await cache.match(request)
              if (response) {
                const blob = await response.clone().blob()
                breakdown.cache += blob.size
              }
            }
          }
        } catch (e) {
          console.warn('[StorageManager] Failed to estimate cache size:', e)
        }
      }

      // 其他数据
      breakdown.other = Math.max(0, used - breakdown.books - breakdown.notes - breakdown.cache)

      setStorageInfo({
        used,
        quota,
        usagePercent: quota > 0 ? used / quota : 0,
        breakdown,
      })
    } catch (e) {
      console.error('[StorageManager] Failed to fetch storage info:', e)
      setError((e as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // 清理缓存（LRU 策略）
  const cleanupCache = useCallback(async () => {
    setIsCleaning(true)
    let freedBytes = 0

    try {
      // 清理 Service Worker 缓存
      if ('caches' in window) {
        const cacheNames = await caches.keys()

        // 只清理图片和 API 缓存，保留静态资源和书籍内容
        const cachesToClean = cacheNames.filter(name =>
          name.includes('images') || name.includes('api')
        )

        for (const cacheName of cachesToClean) {
          const cache = await caches.open(cacheName)
          const keys = await cache.keys()

          for (const request of keys) {
            const response = await cache.match(request)
            if (response) {
              const blob = await response.clone().blob()
              freedBytes += blob.size
            }
            await cache.delete(request)
          }
        }
      }

      // 清理过期的同步队列数据
      try {
        const syncDb = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('athena_sync', 1)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })

        const transaction = syncDb.transaction(['sync_queue'], 'readwrite')
        const store = transaction.objectStore('sync_queue')
        const syncedIndex = store.index('synced')

        // 删除已同步的记录
        await new Promise<void>((resolve, reject) => {
          const request = syncedIndex.openCursor(IDBKeyRange.only(1))
          request.onsuccess = () => {
            const cursor = request.result
            if (cursor) {
              freedBytes += JSON.stringify(cursor.value).length
              cursor.delete()
              cursor.continue()
            } else {
              resolve()
            }
          }
          request.onerror = () => reject(request.error)
        })

        syncDb.close()
      } catch (e) {
        console.warn('[StorageManager] Failed to cleanup sync queue:', e)
      }

      // 刷新存储信息
      await fetchStorageInfo()

      // 回调
      onCleanup?.(freedBytes)

      console.log('[StorageManager] Cleanup complete, freed:', formatBytes(freedBytes))
    } catch (e) {
      console.error('[StorageManager] Cleanup failed:', e)
      setError((e as Error).message)
    } finally {
      setIsCleaning(false)
    }
  }, [fetchStorageInfo, onCleanup])

  // 初始化加载
  useEffect(() => {
    fetchStorageInfo()
  }, [fetchStorageInfo])

  // 警告状态
  const isWarning = storageInfo && storageInfo.usagePercent >= warningThreshold

  if (isLoading) {
    return (
      <div className="animate-pulse rounded-lg bg-gray-100 p-4 dark:bg-gray-800">
        <div className="h-4 w-1/3 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="mt-3 h-2 rounded bg-gray-200 dark:bg-gray-700" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
        <p className="text-sm text-red-600 dark:text-red-400">
          {t('storage.error', '无法获取存储信息')}: {error}
        </p>
      </div>
    )
  }

  if (!storageInfo) return null

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      {/* 标题和警告 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cloud className="h-5 w-5 text-gray-400" />
          <h3 className="font-medium text-gray-900 dark:text-white">
            {t('storage.title', '存储空间')}
          </h3>
        </div>
        {isWarning && (
          <div className="flex items-center gap-1 text-amber-500">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-xs">{t('storage.warning', '空间不足')}</span>
          </div>
        )}
      </div>

      {/* 使用量进度条 */}
      <div className="mt-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500 dark:text-gray-400">
            {formatBytes(storageInfo.used)} / {formatBytes(storageInfo.quota)}
          </span>
          <span className={isWarning ? 'text-amber-500' : 'text-gray-500 dark:text-gray-400'}>
            {(storageInfo.usagePercent * 100).toFixed(1)}%
          </span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${storageInfo.usagePercent * 100}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className={`h-full rounded-full ${isWarning
                ? 'bg-amber-500'
                : 'bg-indigo-500'
              }`}
          />
        </div>
      </div>

      {/* 分类明细 */}
      {showBreakdown && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-blue-500" />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t('storage.books', '书籍')}: {formatBytes(storageInfo.breakdown.books)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-green-500" />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t('storage.notes', '笔记')}: {formatBytes(storageInfo.breakdown.notes)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Image className="h-4 w-4 text-purple-500" />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t('storage.cache', '缓存')}: {formatBytes(storageInfo.breakdown.cache)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-gray-500" />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t('storage.other', '其他')}: {formatBytes(storageInfo.breakdown.other)}
            </span>
          </div>
        </div>
      )}

      {/* 清理按钮 */}
      <div className="mt-4">
        <button
          onClick={cleanupCache}
          disabled={isCleaning}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
        >
          <Trash2 className={`h-4 w-4 ${isCleaning ? 'animate-spin' : ''}`} />
          {isCleaning
            ? t('storage.cleaning', '清理中...')
            : t('storage.cleanup', '清理缓存')
          }
        </button>
      </div>
    </div>
  )
}

export default StorageManager

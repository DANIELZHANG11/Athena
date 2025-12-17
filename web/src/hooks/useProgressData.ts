/**
 * useProgressData - 阅读进度数据统一入口 Hook (PowerSync Only)
 *
 * 直接使用 PowerSync SQLite 作为唯一数据源
 * 替代原有的 useReadingProgress, useOfflineProgressV2 等
 *
 * 字段映射 (PowerSync Schema → 业务层)：
 * - progress (REAL 0-1) → percentage
 * - last_position (TEXT CFI) → currentCfi
 * - last_location (TEXT JSON) → { currentPage, totalPages }
 * - updated_at → lastReadAt
 * - finished_at → finishedAt
 *
 * @see 09 - APP-FIRST架构改造计划.md Phase 3
 * @see docker/powersync/sync_rules.yaml
 * @modified 2025-12-17 修复字段映射与 PowerSync Schema 一致
 */

import { useMemo, useCallback, useRef, useEffect } from 'react'
import { useQuery } from '@powersync/react'
import { usePowerSyncDatabase, usePowerSyncState } from '@/lib/powersync'
import { useAuthStore } from '@/stores/auth'
import { generateUUID, getDeviceId } from '@/lib/utils'

// ============================================================================
// 类型定义
// ============================================================================

export interface ReadingProgressData {
  bookId: string
  currentCfi?: string       // 来自 last_position
  currentPage?: number      // 来自 last_location JSON
  totalPages?: number       // 来自 last_location JSON
  percentage: number        // 来自 progress (0-1)
  lastReadAt: string        // 来自 updated_at
  finishedAt?: string       // 来自 finished_at
}

/**
 * PowerSync reading_progress 表的原始行结构
 * @see web/src/lib/powersync/schema.ts
 * @see docker/powersync/sync_rules.yaml
 */
interface ProgressRow {
  id: string
  user_id: string
  book_id: string
  device_id: string | null
  progress: number           // REAL 0-1
  last_position: string | null  // CFI 字符串
  last_location: string | null  // JSON: { currentPage, totalPages, ... }
  finished_at: string | null
  updated_at: string
}

/**
 * 解析 last_location JSON
 */
function parseLastLocation(json: string | null): { currentPage?: number; totalPages?: number } {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json)
    return {
      currentPage: typeof parsed.currentPage === 'number' ? parsed.currentPage : undefined,
      totalPages: typeof parsed.totalPages === 'number' ? parsed.totalPages : undefined,
    }
  } catch {
    return {}
  }
}

// ============================================================================
// Hook 实现
// ============================================================================

/**
 * 获取书籍的阅读进度
 */
export function useProgressData(bookId: string | null) {
  const db = usePowerSyncDatabase()
  const { isInitialized } = usePowerSyncState()
  const isReady = isInitialized && db !== null

  const query = isReady && bookId
    ? 'SELECT * FROM reading_progress WHERE book_id = ? ORDER BY updated_at DESC LIMIT 1'
    : 'SELECT * FROM reading_progress WHERE 1=0'

  const { data, isLoading, error } = useQuery<ProgressRow>(
    query,
    isReady && bookId ? [bookId] : []
  )

  const progress: ReadingProgressData | null = useMemo(() => {
    if (!data?.[0]) return null

    const row = data[0]
    const location = parseLastLocation(row.last_location)
    
    return {
      bookId: row.book_id,
      currentCfi: row.last_position ?? undefined,
      currentPage: location.currentPage,
      totalPages: location.totalPages,
      percentage: row.progress ?? 0,
      lastReadAt: row.updated_at,
      finishedAt: row.finished_at ?? undefined,
    }
  }, [data])

  // 防抖保存进度
  const saveTimeoutRef = useRef<number | null>(null)
  const pendingUpdateRef = useRef<Partial<ReadingProgressData> | null>(null)

  // 保存进度（防抖 1 秒）
  const saveProgress = useCallback(async (
    updates: {
      currentCfi?: string
      currentPage?: number
      totalPages?: number
      percentage?: number
    },
    immediate = false
  ) => {
    console.log('[useProgressData] saveProgress called:', { 
      updates, 
      immediate, 
      hasDb: !!db, 
      bookId,
      isReady 
    })
    
    if (!db || !bookId) {
      console.warn('[useProgressData] Cannot save: db or bookId not available', { hasDb: !!db, bookId })
      return
    }

    // 合并待处理更新
    pendingUpdateRef.current = {
      ...pendingUpdateRef.current,
      ...updates,
    }

    // 清除之前的定时器
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    const doSave = async () => {
      const pending = pendingUpdateRef.current
      if (!pending) return

      pendingUpdateRef.current = null
      const now = new Date().toISOString()
      const userId = useAuthStore.getState().user?.id || ''
      const deviceId = getDeviceId()

      try {
        // 检查是否已存在进度记录 - 使用 book_id + user_id 匹配
        // 同时查询 finished_at 用于"已读完"保护
        const existingRows = await db.getAll<{ id: string; last_location: string | null; finished_at: string | null }>(
          'SELECT id, last_location, finished_at FROM reading_progress WHERE book_id = ? AND user_id = ?',
          [bookId, userId]
        )
        const existing = existingRows[0]

        // 🔒 Bug 3 修复: 已读完保护锁
        // 如果书已标记为"已读完"(finished_at 有值)，且当前更新不是进度 100%，
        // 则拒绝保存，防止阅读器的自动保存覆盖"已读完"状态
        if (existing?.finished_at && pending.percentage !== undefined) {
          const normalizedPending = pending.percentage > 1 ? pending.percentage / 100 : pending.percentage
          if (normalizedPending < 1.0) {
            console.log('[useProgressData] 🔒 Blocked: Book is marked as finished, refusing to overwrite with lower progress', {
              bookId,
              finishedAt: existing.finished_at,
              attemptedProgress: normalizedPending
            })
            return // 拒绝保存
          }
        }

        // 构建 last_location JSON
        const buildLastLocation = (existingJson: string | null): string => {
          const current = parseLastLocation(existingJson)
          return JSON.stringify({
            currentPage: pending.currentPage ?? current.currentPage,
            totalPages: pending.totalPages ?? current.totalPages,
          })
        }

        if (existing) {
          // 更新现有记录 - 使用 book_id + user_id 匹配
          const fields: string[] = ['updated_at = ?']
          const values: (string | number | null)[] = [now]

          if (pending.currentCfi !== undefined) {
            fields.push('last_position = ?')
            values.push(pending.currentCfi ?? null)
          }
          if (pending.currentPage !== undefined || pending.totalPages !== undefined) {
            fields.push('last_location = ?')
            values.push(buildLastLocation(existing.last_location))
          }
          if (pending.percentage !== undefined) {
            fields.push('progress = ?')
            // 强制归一化：如果传入 > 1 的数（如25），除以100；如果是 0-1，保持不变
            const normalizedProgress = pending.percentage > 1 ? pending.percentage / 100 : pending.percentage
            values.push(normalizedProgress)
          }

          values.push(bookId)
          values.push(userId)
          await db.execute(
            `UPDATE reading_progress SET ${fields.join(', ')} WHERE book_id = ? AND user_id = ?`,
            values
          )
        } else {
          // 创建新记录
          const id = generateUUID()
          const deviceId = getDeviceId()
          // 归一化进度值
          const rawProgress = pending.percentage ?? 0
          const normalizedProgress = rawProgress > 1 ? rawProgress / 100 : rawProgress
          await db.execute(
            `INSERT INTO reading_progress (id, book_id, user_id, device_id, last_position, last_location, progress, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              bookId,
              userId,  // user_id - 从 AuthStore 获取
              deviceId,  // device_id - 从 localStorage 获取
              pending.currentCfi ?? null,
              buildLastLocation(null),
              normalizedProgress,
              now
            ]
          )
        }

        console.log('[useProgressData] Progress saved:', { bookId, ...pending })
      } catch (err) {
        console.error('[useProgressData] Failed to save progress:', err)
      }
    }

    if (immediate) {
      await doSave()
    } else {
      // 防抖 1 秒
      saveTimeoutRef.current = setTimeout(doSave, 1000) as unknown as number
    }
  }, [db, bookId, isReady])

  // 组件卸载时保存待处理的更新
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      // 立即保存待处理的更新
      if (pendingUpdateRef.current && db && bookId) {
        const pending = pendingUpdateRef.current
        const now = new Date().toISOString()
        const userId = useAuthStore.getState().user?.id || ''
        
        db.getAll<{ id: string; last_location: string | null }>('SELECT id, last_location FROM reading_progress WHERE book_id = ? AND user_id = ?', [bookId, userId])
          .then(rows => {
            const existing = rows[0]
            if (existing) {
              // 构建 last_location JSON
              const currentLoc = parseLastLocation(existing.last_location)
              const newLocation = JSON.stringify({
                currentPage: pending.currentPage ?? currentLoc.currentPage,
                totalPages: pending.totalPages ?? currentLoc.totalPages,
              })
              
              // 归一化进度值
              const rawProgress = pending.percentage ?? 0
              const normalizedProgress = rawProgress > 1 ? rawProgress / 100 : rawProgress
              
              db.execute(
                'UPDATE reading_progress SET last_position = ?, last_location = ?, progress = ?, updated_at = ? WHERE book_id = ? AND user_id = ?',
                [pending.currentCfi ?? null, newLocation, normalizedProgress, now, bookId, userId]
              )
            }
          })
          .catch(console.error)
      }
    }
  }, [db, bookId])

  return {
    progress,
    isLoading: !isReady || isLoading,
    isProgressLoading: !isReady || isLoading,  // 别名，更清晰
    error,
    saveProgress,
    isReady,
  }
}

/**
 * 获取所有阅读进度（用于首页显示）
 * 
 * 按最近更新时间排序，JOIN books 表获取书籍信息
 */
export function useAllProgressData(options: { limit?: number } = {}) {
  const db = usePowerSyncDatabase()
  const { isInitialized } = usePowerSyncState()
  const isReady = isInitialized && db !== null
  const { limit = 10 } = options

  const EMPTY_QUERY = 'SELECT * FROM reading_progress WHERE 1=0'
  
  // 使用正确的字段名：progress, last_position, last_location, updated_at
  // books 表使用 cover_url (来自 sync_rules.yaml 映射)
  const sql = isReady
    ? `
    SELECT rp.*, b.title as book_title, b.author as book_author, b.cover_url
    FROM reading_progress rp
    INNER JOIN books b ON rp.book_id = b.id
    WHERE b.deleted_at IS NULL
    ORDER BY rp.updated_at DESC
    LIMIT ?
  `
    : EMPTY_QUERY

  interface ProgressWithBook extends ProgressRow {
    book_title: string
    book_author: string | null
    cover_url: string | null
  }

  const { data, isLoading, error } = useQuery<ProgressWithBook>(sql, isReady ? [limit] : [])

  const recentBooks = useMemo(() => {
    if (!data) return []

    return data.map(row => {
      const location = parseLastLocation(row.last_location)
      return {
        bookId: row.book_id,
        title: row.book_title,
        author: row.book_author ?? undefined,
        coverUrl: row.cover_url ?? undefined,
        percentage: row.progress ?? 0,
        currentPage: location.currentPage,
        totalPages: location.totalPages,
        lastReadAt: row.updated_at,
      }
    })
  }, [data])

  return {
    recentBooks,
    isLoading: !isReady || isLoading,
    error,
    isReady,
  }
}

/**
 * 记录阅读会话（开始/结束）
 * 
 * reading_sessions 表字段:
 * - id, user_id, book_id, device_id
 * - is_active (INTEGER 0/1)
 * - total_ms (INTEGER 毫秒)
 * - created_at, updated_at
 */
export function useReadingSession(bookId: string | null) {
  const db = usePowerSyncDatabase()
  const sessionIdRef = useRef<string | null>(null)
  const startTimeRef = useRef<Date | null>(null)

  const startSession = useCallback(async () => {
    console.log('[useReadingSession] startSession called:', { hasDb: !!db, bookId })
    if (!db || !bookId) {
      console.warn('[useReadingSession] Cannot start session: db or bookId missing')
      return null
    }

    const id = generateUUID()
    const now = new Date()
    const isoNow = now.toISOString()

    try {
      // 使用正确的字段名: is_active, total_ms, created_at, updated_at
      // 使用正确的 user_id 和 device_id
      const userId = useAuthStore.getState().user?.id || ''
      const deviceId = getDeviceId()
      await db.execute(
        `INSERT INTO reading_sessions (id, book_id, user_id, device_id, is_active, total_ms, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 0, ?, ?)`,
        [id, bookId, userId, deviceId, isoNow, isoNow]
      )

      sessionIdRef.current = id
      startTimeRef.current = now
      console.log('[useReadingSession] Session started:', id)
      return id
    } catch (err) {
      console.error('[useReadingSession] Failed to start session:', err)
      return null
    }
  }, [db, bookId])

  const endSession = useCallback(async () => {
    if (!db || !sessionIdRef.current || !startTimeRef.current) return

    // 计算持续时间（毫秒）
    const durationMs = Date.now() - startTimeRef.current.getTime()
    const now = new Date().toISOString()

    try {
      // 使用正确的字段名: is_active=0 表示结束, total_ms 存储毫秒
      await db.execute(
        'UPDATE reading_sessions SET is_active = 0, total_ms = ?, updated_at = ? WHERE id = ?',
        [durationMs, now, sessionIdRef.current]
      )

      console.log('[useReadingSession] Session ended:', {
        id: sessionIdRef.current,
        durationMs,
        durationMinutes: Math.round(durationMs / 60000)
      })

      sessionIdRef.current = null
      startTimeRef.current = null
    } catch (err) {
      console.error('[useReadingSession] Failed to end session:', err)
    }
  }, [db])

  // 组件卸载时结束会话
  useEffect(() => {
    return () => {
      if (sessionIdRef.current && startTimeRef.current && db) {
        const durationMs = Date.now() - startTimeRef.current.getTime()
        const now = new Date().toISOString()
        
        db.execute(
          'UPDATE reading_sessions SET is_active = 0, total_ms = ?, updated_at = ? WHERE id = ?',
          [durationMs, now, sessionIdRef.current]
        ).catch(console.error)
      }
    }
  }, [db])

  return {
    startSession,
    endSession,
    isReady: !!db,
  }
}

/**
 * TTS 进度同步服务
 *
 * @description 处理 TTS 听书进度到 PowerSync/PostgreSQL 的同步
 * 使用 2 分钟间隔节流同步，避免频繁写入
 *
 * @see 对话记录.md - 2.11 TTS 听书功能实施计划 - Phase 2
 * @see api/alembic/versions/0134_add_tts_progress_fields.py
 * @ai-generated Claude Opus 4.5 (2026-01-20)
 */

import type { AbstractPowerSyncDatabase } from '@powersync/web'
import { generateUUID, getDeviceId } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

// ============ 类型定义 ============

export interface TTSProgressData {
  bookId: string
  chapterIndex: number
  positionMs: number
}

// ============ 进度同步服务 ============

/**
 * 同步 TTS 进度到数据库
 * 
 * @param db - PowerSync 数据库实例
 * @param progress - TTS 进度数据
 * 
 * 字段映射：
 * - chapterIndex → tts_chapter_index
 * - positionMs → tts_position_ms
 * - 自动设置 → tts_last_played_at
 */
export async function syncTTSProgress(
  db: AbstractPowerSyncDatabase,
  progress: TTSProgressData
): Promise<void> {
  const userId = useAuthStore.getState().user?.id
  if (!userId) {
    console.warn('[TTS Sync] No user logged in, skipping sync')
    return
  }

  const { bookId, chapterIndex, positionMs } = progress
  const now = new Date().toISOString()
  const deviceId = getDeviceId()

  try {
    // 检查是否已存在进度记录
    const existingRows = await db.getAll<{ id: string }>(
      'SELECT id FROM reading_progress WHERE book_id = ? AND user_id = ?',
      [bookId, userId]
    )
    const existing = existingRows[0]

    if (existing) {
      // 更新现有记录的 TTS 字段
      await db.execute(
        `UPDATE reading_progress 
         SET tts_chapter_index = ?, 
             tts_position_ms = ?, 
             tts_last_played_at = ?,
             updated_at = ?
         WHERE book_id = ? AND user_id = ?`,
        [chapterIndex, positionMs, now, now, bookId, userId]
      )
      console.log('[TTS Sync] Updated TTS progress:', { bookId, chapterIndex, positionMs })
    } else {
      // 创建新记录（包含 TTS 字段）
      const id = generateUUID()
      await db.execute(
        `INSERT INTO reading_progress 
         (id, user_id, device_id, book_id, progress, 
          tts_chapter_index, tts_position_ms, tts_last_played_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        [id, userId, deviceId, bookId, chapterIndex, positionMs, now, now]
      )
      console.log('[TTS Sync] Created TTS progress record:', { bookId, chapterIndex, positionMs })
    }
  } catch (error) {
    console.error('[TTS Sync] Failed to sync progress:', error)
    throw error
  }
}

/**
 * 从数据库加载 TTS 进度
 * 
 * @param db - PowerSync 数据库实例
 * @param bookId - 书籍 ID
 * @returns TTS 进度数据，如果不存在则返回 null
 */
export async function loadTTSProgress(
  db: AbstractPowerSyncDatabase,
  bookId: string
): Promise<TTSProgressData | null> {
  const userId = useAuthStore.getState().user?.id
  if (!userId) {
    console.warn('[TTS Sync] No user logged in, cannot load progress')
    return null
  }

  try {
    const rows = await db.getAll<{
      tts_chapter_index: number | null
      tts_position_ms: number | null
    }>(
      `SELECT tts_chapter_index, tts_position_ms 
       FROM reading_progress 
       WHERE book_id = ? AND user_id = ? AND tts_last_played_at IS NOT NULL`,
      [bookId, userId]
    )

    const row = rows[0]
    if (!row || row.tts_chapter_index === null || row.tts_position_ms === null) {
      return null
    }

    return {
      bookId,
      chapterIndex: row.tts_chapter_index,
      positionMs: row.tts_position_ms,
    }
  } catch (error) {
    console.error('[TTS Sync] Failed to load progress:', error)
    return null
  }
}

/**
 * 清除 TTS 进度（听完后清除）
 * 
 * @param db - PowerSync 数据库实例
 * @param bookId - 书籍 ID
 */
export async function clearTTSProgress(
  db: AbstractPowerSyncDatabase,
  bookId: string
): Promise<void> {
  const userId = useAuthStore.getState().user?.id
  if (!userId) return

  try {
    await db.execute(
      `UPDATE reading_progress 
       SET tts_chapter_index = NULL, 
           tts_position_ms = NULL,
           tts_last_played_at = NULL,
           updated_at = ?
       WHERE book_id = ? AND user_id = ?`,
      [new Date().toISOString(), bookId, userId]
    )
    console.log('[TTS Sync] Cleared TTS progress:', bookId)
  } catch (error) {
    console.error('[TTS Sync] Failed to clear progress:', error)
  }
}

// ============ TTS 阅读会话管理 ============

/** TTS 会话状态 */
interface TTSSessionState {
  sessionId: string | null
  startTime: Date | null
  bookId: string | null
  lastHeartbeat: Date | null
}

const ttsSession: TTSSessionState = {
  sessionId: null,
  startTime: null,
  bookId: null,
  lastHeartbeat: null,
}

/** 心跳间隔 (毫秒) - 30秒 */
const TTS_HEARTBEAT_INTERVAL_MS = 30 * 1000

/**
 * 开始 TTS 阅读会话
 * 将 TTS 听书时间计入阅读统计
 */
export async function startTTSSession(
  db: AbstractPowerSyncDatabase,
  bookId: string
): Promise<string | null> {
  const userId = useAuthStore.getState().user?.id
  if (!userId) {
    console.warn('[TTS Session] No user logged in')
    return null
  }

  // 如果已有活跃会话，先结束它
  if (ttsSession.sessionId) {
    await endTTSSession(db)
  }

  const id = generateUUID()
  const now = new Date()
  const isoNow = now.toISOString()
  const deviceId = getDeviceId()

  try {
    await db.execute(
      `INSERT INTO reading_sessions (id, book_id, user_id, device_id, is_active, total_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 0, ?, ?)`,
      [id, bookId, userId, deviceId, isoNow, isoNow]
    )

    ttsSession.sessionId = id
    ttsSession.startTime = now
    ttsSession.bookId = bookId
    ttsSession.lastHeartbeat = now

    console.log('[TTS Session] Started:', { id, bookId })
    return id
  } catch (error) {
    console.error('[TTS Session] Failed to start:', error)
    return null
  }
}

/**
 * 更新 TTS 会话心跳
 * 定期调用以更新 total_ms
 */
export async function heartbeatTTSSession(
  db: AbstractPowerSyncDatabase
): Promise<void> {
  if (!ttsSession.sessionId || !ttsSession.startTime) return

  const now = new Date()
  const durationMs = now.getTime() - ttsSession.startTime.getTime()
  const deviceId = getDeviceId()

  try {
    const userId = useAuthStore.getState().user?.id || ''
    await db.execute(
      `UPDATE reading_sessions 
       SET total_ms = ?, updated_at = ?, user_id = ?, device_id = ?
       WHERE id = ? AND is_active = 1`,
      [durationMs, now.toISOString(), userId, deviceId, ttsSession.sessionId]
    )

    ttsSession.lastHeartbeat = now
    console.log('[TTS Session] Heartbeat:', { 
      sessionId: ttsSession.sessionId,
      durationMs,
      durationMinutes: Math.round(durationMs / 60000)
    })
  } catch (error) {
    console.error('[TTS Session] Heartbeat failed:', error)
  }
}

/**
 * 结束 TTS 阅读会话
 */
export async function endTTSSession(
  db: AbstractPowerSyncDatabase
): Promise<void> {
  if (!ttsSession.sessionId || !ttsSession.startTime) return

  const now = new Date()
  const durationMs = now.getTime() - ttsSession.startTime.getTime()
  const deviceId = getDeviceId()

  try {
    const userId = useAuthStore.getState().user?.id || ''
    await db.execute(
      `UPDATE reading_sessions 
       SET is_active = 0, total_ms = ?, updated_at = ?, user_id = ?, device_id = ?
       WHERE id = ?`,
      [durationMs, now.toISOString(), userId, deviceId, ttsSession.sessionId]
    )

    console.log('[TTS Session] Ended:', { 
      sessionId: ttsSession.sessionId,
      durationMs,
      durationMinutes: Math.round(durationMs / 60000)
    })

    // 清理状态
    ttsSession.sessionId = null
    ttsSession.startTime = null
    ttsSession.bookId = null
    ttsSession.lastHeartbeat = null
  } catch (error) {
    console.error('[TTS Session] Failed to end:', error)
  }
}

/**
 * 获取心跳间隔常量
 */
export function getTTSHeartbeatInterval(): number {
  return TTS_HEARTBEAT_INTERVAL_MS
}

/**
 * 检查是否有活跃的 TTS 会话
 */
export function hasTTSSession(): boolean {
  return ttsSession.sessionId !== null
}

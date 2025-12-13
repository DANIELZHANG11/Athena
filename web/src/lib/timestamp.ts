/**
 * timestamp.ts
 * 
 * 统一的时间戳处理工具库
 * 
 * ## 核心原则
 * 
 * 1. **存储**: 所有时间戳使用 UTC 毫秒数 (Date.now())
 * 2. **传输**: 使用 ISO 8601 带时区格式 ("2024-12-09T12:00:00.000Z")
 * 3. **比较**: 统一转换为 UTC 毫秒数后比较
 * 4. **显示**: 转换为用户本地时区显示
 * 
 * ## 为什么重要？
 * 
 * - 雅典娜是全球化应用，用户可能在任何时区
 * - 离线时本地生成的时间戳，联机时需要与服务器正确比较
 * - 服务器位置固定，但用户终端位置不固定
 * - LWW (Last-Writer-Wins) 冲突解决依赖准确的时间戳比较
 * 
 * @see App-First改造计划.md
 */

// ==================== 时间戳生成 ====================

/**
 * 获取当前 UTC 毫秒时间戳
 * 用于所有本地存储的时间字段
 * 
 * 注意: Date.now() 返回的已经是 UTC 毫秒时间戳，
 * 与用户本地时区无关，可以安全地跨时区比较
 */
export function nowUtc(): number {
  return Date.now()
}

/**
 * 获取当前 UTC 时间的 ISO 字符串
 * 用于发送给服务器
 */
export function nowIso(): string {
  return new Date().toISOString()
}

// ==================== 服务器时间戳解析 ====================

/**
 * 解析服务器返回的时间戳字符串为 UTC 毫秒数
 * 
 * 支持的格式:
 * - ISO 8601 带时区: "2024-12-09T12:00:00.000Z"
 * - ISO 8601 带偏移: "2024-12-09T12:00:00+08:00"
 * - PostgreSQL timestamptz: "2024-12-09 12:00:00.000000+00:00"
 * - 纯数字: 1733760000000 (直接返回)
 * 
 * @param timestamp - 服务器返回的时间戳（字符串或数字）
 * @param fallback - 解析失败时的回退值，默认为当前时间
 * @returns UTC 毫秒时间戳
 */
export function parseServerTimestamp(
  timestamp: string | number | null | undefined,
  fallback: number = Date.now()
): number {
  // 空值处理
  if (timestamp === null || timestamp === undefined) {
    return fallback
  }

  // 已经是数字
  if (typeof timestamp === 'number') {
    // 检查是否是秒级时间戳（10位）而非毫秒（13位）
    if (timestamp < 10000000000) {
      return timestamp * 1000
    }
    return timestamp
  }

  // 字符串解析
  if (typeof timestamp === 'string') {
    // 空字符串
    if (!timestamp.trim()) {
      return fallback
    }

    // 尝试解析
    const parsed = new Date(timestamp).getTime()

    // 检查是否有效
    if (isNaN(parsed)) {
      console.warn('[timestamp] Invalid timestamp format:', timestamp)
      return fallback
    }

    return parsed
  }

  return fallback
}

/**
 * 安全地比较两个时间戳
 * 处理各种格式的输入，统一转换后比较
 * 
 * @returns 负数: a < b, 0: a === b, 正数: a > b
 */
export function compareTimestamps(
  a: string | number | null | undefined,
  b: string | number | null | undefined
): number {
  const aMs = parseServerTimestamp(a, 0)
  const bMs = parseServerTimestamp(b, 0)
  return aMs - bMs
}

/**
 * 检查时间戳 a 是否比 b 更新
 */
export function isNewer(
  a: string | number | null | undefined,
  b: string | number | null | undefined
): boolean {
  return compareTimestamps(a, b) > 0
}

// ==================== 本地时间戳转换 ====================

/**
 * 将 UTC 毫秒时间戳转换为 ISO 字符串
 * 用于发送给服务器
 */
export function toIsoString(utcMs: number): string {
  return new Date(utcMs).toISOString()
}

/**
 * 将 UTC 毫秒时间戳转换为本地日期对象
 * 用于 UI 显示
 */
export function toLocalDate(utcMs: number): Date {
  return new Date(utcMs)
}

// ==================== 日期字符串处理 ====================

/**
 * 获取用户本地时区的日期字符串 (YYYY-MM-DD)
 * 用于日期比较和显示
 * 
 * 注意: 这个函数返回的是用户本地时区的日期，
 * 如北京时间 2024-12-10 00:30 会返回 "2024-12-10"
 * 而 UTC 时间此时是 2024-12-09 16:30
 */
export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 获取 UTC 日期字符串 (YYYY-MM-DD)
 * 用于与服务器返回的日期比较
 */
export function getUtcDateString(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

/**
 * 获取本周的日期范围（周一开始，用户本地时区）
 */
export function getLocalWeekRange(): { start: Date; dates: string[] } {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? 6 : day - 1 // 调整为周一开始
  const monday = new Date(now)
  monday.setDate(now.getDate() - diff)
  monday.setHours(0, 0, 0, 0)

  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    dates.push(getLocalDateString(d))
  }

  return { start: monday, dates }
}

// ==================== 用户时区处理 ====================

/**
 * 获取用户的时区标识
 * 例如: "Asia/Shanghai", "America/New_York"
 */
export function getUserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * 获取用户时区偏移（分钟）
 * 正数表示西半球，负数表示东半球
 * 例如: 北京时间 (UTC+8) 返回 -480
 */
export function getTimezoneOffset(): number {
  return new Date().getTimezoneOffset()
}

// ==================== 调试工具 ====================

/**
 * 打印时间戳调试信息
 */
export function debugTimestamp(label: string, timestamp: string | number | null | undefined): void {
  if (process.env.NODE_ENV === 'development') {
    const ms = parseServerTimestamp(timestamp, 0)
    console.log(`[timestamp] ${label}:`, {
      raw: timestamp,
      utcMs: ms,
      utcIso: ms ? new Date(ms).toISOString() : null,
      localStr: ms ? new Date(ms).toLocaleString() : null,
      userTz: getUserTimezone(),
    })
  }
}

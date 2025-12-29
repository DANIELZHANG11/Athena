import { useMemo, useCallback } from 'react'
import { useQuery } from '@powersync/react'
import { usePowerSyncDatabase, usePowerSyncState } from '@/lib/powersync'
import { useAuthStore } from '@/stores/auth'

export interface DashboardData {
    today: {
        seconds: number
        minutes: number
    }
    goals: {
        daily_minutes: number
        yearly_books: number
    }
    weekly: {
        date: string
        minutes: number
        status: 'FUTURE' | 'MISSED' | 'REACHED' | 'PARTIAL'
    }[]
    streak: {
        current_streak: number
        longest_streak: number
    }
    yearly_finished: {
        count: number
        recent_covers: string[]
    }
}

/**
 * reading_sessions 表行结构
 * @see web/src/lib/powersync/schema.ts
 * @see docker/powersync/sync_rules.yaml
 * 字段: id, user_id, book_id, device_id, is_active, total_ms, created_at, updated_at
 */
interface ReadingSessionRow {
    total_ms: number      // 阅读时长（毫秒）
    created_at: string    // 会话创建时间
}

interface ReadingStatsRow {
    date: string
    total_seconds: number
}

interface UserSettingsRow {
    settings_json: string
}

interface FinishedBookRow {
    id: string
}

// 获取用户本地日期字符串 (YYYY-MM-DD)
function getLocalDateString(date: Date = new Date()): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

export function useDashboardData() {
    const db = usePowerSyncDatabase()
    const { isInitialized } = usePowerSyncState()
    const accessToken = useAuthStore(s => s.accessToken)

    // 检查 PowerSync 是否准备就绪
    const isReady = isInitialized && db !== null

    // 1. 获取今日阅读时间 (实时计算)
    // 统计今天所有阅读会话的时长
    const todayStr = getLocalDateString()

    // 空查询占位符 - 当数据库未就绪时使用，保持 Hook 调用顺序一致
    // 字段名参考: total_ms (毫秒), created_at (ISO8601), is_active (0/1)
    const EMPTY_SESSIONS_QUERY = 'SELECT total_ms, created_at, is_active FROM reading_sessions WHERE 1=0'
    const EMPTY_SETTINGS_QUERY = 'SELECT settings_json FROM user_settings WHERE 1=0'
    // reading_sessions.total_ms 是毫秒，转换为秒
    const EMPTY_WEEKLY_QUERY = 'SELECT date(created_at) as date, SUM(total_ms) / 1000 as total_seconds FROM reading_sessions WHERE 1=0 GROUP BY date(created_at)'
    const EMPTY_ALL_STATS_QUERY = 'SELECT date(created_at) as date, SUM(total_ms) / 1000 as total_seconds FROM reading_sessions WHERE 1=0 GROUP BY date(created_at)'
    // reading_progress.progress 是进度(0-1)，finished_at 是完成时间
    const EMPTY_FINISHED_QUERY = 'SELECT b.id FROM reading_progress rp JOIN books b ON rp.book_id = b.id WHERE 1=0'

    // 查询今日会话 - 包含已结束和活跃的会话
    const todaySessionsQuery = isReady
        ? `SELECT total_ms, created_at, is_active FROM reading_sessions 
     WHERE date(created_at) = date('now', 'localtime')`
        : EMPTY_SESSIONS_QUERY

    interface ExtendedSessionRow extends ReadingSessionRow {
        is_active: number
    }

    const { data: todaySessions } = useQuery<ExtendedSessionRow>(todaySessionsQuery)

    const todayMinutes = useMemo(() => {
        if (!todaySessions) return 0

        let totalMs = 0
        const now = Date.now()

        // 获取今天0点的时间戳（用户本地时区）
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)
        const todayStartMs = todayStart.getTime()

        todaySessions.forEach(row => {
            if (row.is_active === 1) {
                // 活跃会话：计算从 created_at 到现在的时长
                // 支持多设备并发阅读场景（同一账户在不同设备上同时看书）
                const startTime = new Date(row.created_at).getTime()
                // 如果会话开始时间早于今天0点，只计算从今天0点开始的部分
                const effectiveStart = Math.max(startTime, todayStartMs)
                totalMs += now - effectiveStart
            } else {
                // 已结束会话：使用 total_ms
                totalMs += row.total_ms || 0
            }
        })

        return Math.round(totalMs / 60000)
    }, [todaySessions])



    // 2. 获取用户设置 (Goals)
    const settingsQuery = isReady
        ? `SELECT settings_json FROM user_settings LIMIT 1`
        : EMPTY_SETTINGS_QUERY

    const { data: settingsData } = useQuery<UserSettingsRow>(settingsQuery)

    const userSettings = useMemo(() => {
        if (!settingsData?.[0]?.settings_json) return { daily_minutes: 30, yearly_books: 10 }
        try {
            const parsed = JSON.parse(settingsData[0].settings_json)
            return {
                daily_minutes: parsed.daily_goal_minutes || 30,
                yearly_books: parsed.yearly_goal_books || 10
            }
        } catch (e) {
            console.warn('Failed to parse user settings', e)
            return { daily_minutes: 30, yearly_books: 10 }
        }
    }, [settingsData])

    // 3. 获取最近7天活动数据
    // 使用 reading_sessions 聚合每日阅读时长 (reading_stats 表不存在)
    const weeklyStatsQuery = isReady
        ? `SELECT date(created_at) as date, SUM(total_ms) / 1000 as total_seconds 
     FROM reading_sessions 
     WHERE date(created_at) >= date('now', '-6 days', 'localtime') 
     GROUP BY date(created_at)
     ORDER BY date ASC`
        : EMPTY_WEEKLY_QUERY

    const { data: weeklyStats } = useQuery<ReadingStatsRow>(weeklyStatsQuery)

    const weeklyActivity = useMemo(() => {
        // 计算本周的周一到周日（周一为一周的第一天）
        const days: { date: string, minutes: number }[] = []
        const now = new Date()

        // 获取当前是星期几 (0=周日, 1=周一, ..., 6=周六)
        const currentDayOfWeek = now.getDay()
        // 计算本周一的日期偏移量 (如果今天是周日，则偏移-6天回到周一)
        const mondayOffset = currentDayOfWeek === 0 ? -6 : 1 - currentDayOfWeek

        // 生成周一到周日的7天
        for (let i = 0; i < 7; i++) {
            const d = new Date(now)
            d.setDate(now.getDate() + mondayOffset + i)
            days.push({
                date: getLocalDateString(d),
                minutes: 0
            })
        }

        // 填充历史数据
        if (weeklyStats) {
            weeklyStats.forEach(stat => {
                const day = days.find(d => d.date === stat.date)
                if (day) {
                    day.minutes = Math.round(stat.total_seconds / 60)
                }
            })
        }

        // 今天的数据已经在 weeklyStats 聚合中包含
        // 但如果 todayMinutes 更大（基于 duration_seconds），使用较大值
        const todayDay = days.find(d => d.date === todayStr)
        if (todayDay) {
            todayDay.minutes = Math.max(todayDay.minutes, todayMinutes)
        }

        // 计算状态
        return days.map(day => {
            let status: 'FUTURE' | 'MISSED' | 'REACHED' | 'PARTIAL'
            if (day.date > todayStr) {
                status = 'FUTURE'
            } else if (day.minutes === 0) {
                status = 'MISSED'
            } else if (day.minutes >= userSettings.daily_minutes) {
                status = 'REACHED'
            } else {
                status = 'PARTIAL'
            }
            return { ...day, status }
        })
    }, [weeklyStats, todayMinutes, todayStr, userSettings.daily_minutes])


    // 4. 计算 Streak
    // 获取更长历史数据用于计算 Streak (例如过去365天)
    // 使用 reading_sessions 聚合每日阅读时长
    const allStatsQuery = isReady
        ? `SELECT date(created_at) as date, SUM(total_ms) / 1000 as total_seconds 
         FROM reading_sessions 
         WHERE date(created_at) >= date('now', '-365 days', 'localtime') 
         GROUP BY date(created_at)
         ORDER BY date DESC`
        : EMPTY_ALL_STATS_QUERY

    const { data: allStats } = useQuery<ReadingStatsRow>(allStatsQuery)

    const streak = useMemo(() => {
        if (!allStats) return { current_streak: 0, longest_streak: 0 }

        // 合并数据：将今日实时数据合并到统计中
        const dailyMinutesMap = new Map<string, number>()
        allStats.forEach(s => {
            const m = Math.round(s.total_seconds / 60)
            dailyMinutesMap.set(s.date, m)
        })

        // 如果今日实时数据更大，更新 Map
        const currentTodayMinutes = Math.max(dailyMinutesMap.get(todayStr) || 0, todayMinutes)
        dailyMinutesMap.set(todayStr, currentTodayMinutes)

        // 辅助函数：检查某天是否有阅读记录（只要 minutes > 0 就算阅读了）
        // 注意：连续阅读天数是基于"有阅读记录"，而非"达到每日目标"
        const hasReading = (dateStr: string) => (dailyMinutesMap.get(dateStr) || 0) > 0

        // --- 计算 Current Streak (当前连续阅读天数) ---
        let currentStreak = 0
        const d = new Date()
        let dStr = getLocalDateString(d)

        // 规则：从今天开始往前数，只要当天有阅读记录就计入连续天数
        // 如果今天有阅读记录，今天计入。然后往前回溯。
        // 如果今天没有阅读记录，则从昨天开始往前数。

        if (hasReading(dStr)) {
            // 今天有阅读记录，从今天开始计算
            currentStreak++
            d.setDate(d.getDate() - 1)
            dStr = getLocalDateString(d)
        } else {
            // 今天没有阅读记录，连续天数为0（因为今天还没读书，streak断了）
            // 不再往前回溯
            currentStreak = 0
        }

        // 如果今天有阅读记录，继续往前回溯
        if (currentStreak > 0) {
            while (hasReading(dStr)) {
                currentStreak++
                d.setDate(d.getDate() - 1)
                dStr = getLocalDateString(d)
                // 防止死循环 (Map最多365天)
                if (currentStreak > 365) break
            }
        }

        // --- 计算 Longest Streak (最长连续阅读天数) ---
        const sortedDates = Array.from(dailyMinutesMap.keys()).sort()
        let maxStreak = 0
        let tempStreak = 0

        if (sortedDates.length > 0) {
            const dayMs = 24 * 60 * 60 * 1000

            // 只关心有阅读记录的日子
            const readingDates = sortedDates.filter(date => hasReading(date))

            if (readingDates.length > 0) {
                tempStreak = 1
                maxStreak = 1

                for (let i = 1; i < readingDates.length; i++) {
                    const prev = new Date(readingDates[i - 1])
                    const curr = new Date(readingDates[i])
                    const diff = (curr.getTime() - prev.getTime()) / dayMs

                    if (Math.abs(diff - 1) < 0.1) { // 也就是 diff == 1
                        tempStreak++
                    } else {
                        tempStreak = 1
                    }
                    maxStreak = Math.max(maxStreak, tempStreak)
                }
            }
        }

        // 如果当前 streak 比历史最长还长 (e.g. 今天刚阅读)
        maxStreak = Math.max(maxStreak, currentStreak)

        return {
            current_streak: currentStreak,
            longest_streak: maxStreak
        }
    }, [allStats, todayMinutes, todayStr])


    // 5. 年度阅读目标完成情况
    // 使用正确的字段名: progress (进度 0-1), finished_at (完成时间)
    const finishedBooksQuery = isReady
        ? `SELECT b.id FROM reading_progress rp
     JOIN books b ON rp.book_id = b.id
     WHERE rp.progress >= 1.0
     AND strftime('%Y', COALESCE(rp.finished_at, rp.updated_at)) = strftime('%Y', 'now')
     AND b.deleted_at IS NULL`
        : EMPTY_FINISHED_QUERY

    const { data: finishedBooks } = useQuery<FinishedBookRow>(finishedBooksQuery)

    const yearlyFinished = useMemo(() => {
        const count = finishedBooks?.length || 0
        const recentCovers = finishedBooks
            ?.slice(0, 5)
            .map(b => b.id && accessToken
                ? `/api/v1/books/${b.id}/cover?token=${encodeURIComponent(accessToken)}`
                : ''
            )
            .filter(Boolean) || []

        return { count, recent_covers: recentCovers as string[] }
    }, [finishedBooks, accessToken])

    // 更新目标设置
    const updateGoals = useCallback(async (dailyMinutes?: number, yearlyBooks?: number) => {
        if (!db) {
            console.warn('[useDashboardData] No db available for updateGoals')
            return
        }

        const authUserId = useAuthStore.getState().user?.id
        if (!authUserId) {
            console.warn('[useDashboardData] No user ID available for updateGoals')
            return
        }

        const newSettings = {
            ...userSettings,
            ...(dailyMinutes !== undefined && { daily_goal_minutes: dailyMinutes }),
            ...(yearlyBooks !== undefined && { yearly_goal_books: yearlyBooks }),
        }

        const json = JSON.stringify(newSettings)
        const now = new Date().toISOString()
        const deviceId = typeof window !== 'undefined'
            ? localStorage.getItem('athena_device_id') || 'unknown'
            : 'unknown'

        try {
            // 获取当前用户的设置 - 使用 getAll 避免空结果异常
            const existingRows = await db.getAll<{ id: string, user_id: string }>(
                'SELECT id, user_id FROM user_settings WHERE user_id = ?', [authUserId]
            )
            const existing = existingRows[0]

            if (existing) {
                // 更新现有记录 - SET 子句必须包含 user_id 和 device_id
                console.log('[useDashboardData] Updating existing user_settings:', existing.id)
                await db.execute(
                    'UPDATE user_settings SET settings_json = ?, updated_at = ?, user_id = ?, device_id = ? WHERE id = ?',
                    [json, now, authUserId, deviceId, existing.id]
                )
            } else {
                // 创建新记录
                const newId = crypto.randomUUID()
                console.log('[useDashboardData] Creating new user_settings:', newId)
                await db.execute(
                    'INSERT INTO user_settings (id, user_id, device_id, settings_json, updated_at) VALUES (?, ?, ?, ?, ?)',
                    [newId, authUserId, deviceId, json, now]
                )
            }
            console.log('[useDashboardData] Goals saved successfully:', newSettings)
        } catch (error) {
            console.error('[useDashboardData] Failed to save goals:', error)
        }
    }, [db, userSettings])

    return {
        dashboard: {
            today: { seconds: todayMinutes * 60, minutes: todayMinutes },
            goals: userSettings,
            weekly: weeklyActivity,
            streak,
            yearly_finished: yearlyFinished
        },
        updateGoals,
        isLoading: !isReady || (!todaySessions && !settingsData),
        isReady,
    }
}

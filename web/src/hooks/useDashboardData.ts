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
    // 字段名参考: total_ms (毫秒), created_at (ISO8601)
    const EMPTY_SESSIONS_QUERY = 'SELECT total_ms, created_at FROM reading_sessions WHERE 1=0'
    const EMPTY_SETTINGS_QUERY = 'SELECT settings_json FROM user_settings WHERE 1=0'
    // reading_sessions.total_ms 是毫秒，转换为秒
    const EMPTY_WEEKLY_QUERY = 'SELECT date(created_at) as date, SUM(total_ms) / 1000 as total_seconds FROM reading_sessions WHERE 1=0 GROUP BY date(created_at)'
    const EMPTY_ALL_STATS_QUERY = 'SELECT date(created_at) as date, SUM(total_ms) / 1000 as total_seconds FROM reading_sessions WHERE 1=0 GROUP BY date(created_at)'
    // reading_progress.progress 是进度(0-1)，finished_at 是完成时间
    const EMPTY_FINISHED_QUERY = 'SELECT b.id FROM reading_progress rp JOIN books b ON rp.book_id = b.id WHERE 1=0'

    // 查询今日会话 - 使用正确的字段名 total_ms 和 created_at
    const todaySessionsQuery = isReady 
        ? `SELECT total_ms, created_at FROM reading_sessions 
     WHERE date(created_at) = date('now', 'localtime')
     AND total_ms > 0`
        : EMPTY_SESSIONS_QUERY

    const { data: todaySessions } = useQuery<ReadingSessionRow>(todaySessionsQuery)

    const todayMinutes = useMemo(() => {
        if (!todaySessions) return 0
        // total_ms 是毫秒，转换为分钟
        const totalMs = todaySessions.reduce((sum, row) => sum + (row.total_ms || 0), 0)
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
        // 初始化过去7天（含今天）
        const days: { date: string, minutes: number }[] = []
        const now = new Date()
        for (let i = 6; i >= 0; i--) {
            const d = new Date()
            d.setDate(now.getDate() - i)
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

        // 检查今日是否达标
        const todayGoal = userSettings.daily_minutes

        // 如果今日实时数据更大，更新 Map
        const currentTodayMinutes = Math.max(dailyMinutesMap.get(todayStr) || 0, todayMinutes)
        dailyMinutesMap.set(todayStr, currentTodayMinutes)

        // 辅助函数：检查某天是否达标
        const isReached = (dateStr: string) => (dailyMinutesMap.get(dateStr) || 0) >= todayGoal

        // --- 计算 Current Streak ---
        let currentStreak = 0
        const now = new Date()

        // 从今天或者昨天开始检查
        // 规则：如果今天达标，Streak 包含今天。如果今天未达标，但昨天达标，Streak 延续。如果昨天也没达标，Streak 为 0。
        // 特例：如果今天还没达标，但是是 "进行中"，Streak 显示什么？通常显示截止到昨天的 Streak，除非今天达标了+1。

        const checkDate = new Date(now)
        let checkStr = getLocalDateString(checkDate)

        if (isReached(checkStr)) {
            currentStreak++
            // 继续检查昨天
            checkDate.setDate(checkDate.getDate() - 1)
            checkStr = getLocalDateString(checkDate)
        } else {
            // 今天未达标，检查昨天
            checkDate.setDate(checkDate.getDate() - 1)
            checkStr = getLocalDateString(checkDate)

            // 如果昨天也没达标，当前 Streak 断了 (为0)
            if (!isReached(checkStr)) {
                // currentStreak stays 0
            }
        }

        // 向前回溯
        for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
            // 如果我们已经确认 streak 断了 (count=0 且昨天未达标)，由于逻辑在上面处理了，这里只需要在 count > 0 或 昨天达标的情况下继续
            if (!isReached(checkStr)) break

            // 只有当 (currentStreak > 0) 或者 (currentStreak == 0 && 昨天达标 -> 昨天开始算 1)
            // 上面的逻辑稍微有点重叠，我们简化循环:
            // 实际上我们要找 "连续达标的最长序列，该序列必须包含今天或昨天"
            break; // 重写逻辑以便清晰
        }

        // 重写 Current Streak 逻辑
        currentStreak = 0
        const d = new Date()
        let dStr = getLocalDateString(d)

        // 1. 如果今天达标，计入
        if (isReached(dStr)) {
            currentStreak++
            d.setDate(d.getDate() - 1)
            dStr = getLocalDateString(d)
        } else {
            // 今天没达标，跳过由昨天开始算
            d.setDate(d.getDate() - 1)
            dStr = getLocalDateString(d)
        }

        // 2. 回溯
        while (isReached(dStr)) {
            currentStreak++
            d.setDate(d.getDate() - 1)
            dStr = getLocalDateString(d)
            // 防止死循环 (Map最多365天)
            if (currentStreak > 365) break
        }

        // --- 计算 Longest Streak ---
        // 遍历 map 中所有日期，排序
        const sortedDates = Array.from(dailyMinutesMap.keys()).sort()
        let maxStreak = 0
        let tempStreak = 0

        // 注意 sorted dates 是升序 (old -> new)
        // 我们需要由连续的日期串联
        // 简单处理：遍历所有 stats 记录
        // Map 只包含有阅读记录的天。如果某天没记录，minutes=0。
        // 我们只需要遍历 Map 里的日期，检测日期是否连续且达标。

        if (sortedDates.length > 0) {
            const dayMs = 24 * 60 * 60 * 1000

            // 优化：只遍历有记录的时间段，或者简单点遍历 map keys 检查连续性
            // 更好的方法：只关心达标的日子
            const reachedDates = sortedDates.filter(date => isReached(date))

            if (reachedDates.length > 0) {
                tempStreak = 1
                maxStreak = 1

                for (let i = 1; i < reachedDates.length; i++) {
                    const prev = new Date(reachedDates[i - 1])
                    const curr = new Date(reachedDates[i])
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

        // 如果当前 streak 比历史最长还长 (e.g. 今天刚达标)
        maxStreak = Math.max(maxStreak, currentStreak)

        return {
            current_streak: currentStreak,
            longest_streak: maxStreak
        }
    }, [allStats, todayMinutes, todayStr, userSettings.daily_minutes])

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
        if (!db) return

        const newSettings = {
            ...userSettings,
            ...(dailyMinutes !== undefined && { daily_goal_minutes: dailyMinutes }),
            ...(yearlyBooks !== undefined && { yearly_goal_books: yearlyBooks }),
        }

        const json = JSON.stringify(newSettings)
        const now = new Date().toISOString()

        // 获取当前用户ID - 使用 getAll 避免空结果异常
        const existingRows = await db.getAll<{ user_id: string }>('SELECT user_id FROM user_settings LIMIT 1')
        const existing = existingRows[0]

        if (existing) {
            await db.execute('UPDATE user_settings SET settings_json = ?, updated_at = ? WHERE user_id = ?',
                [json, now, existing.user_id])
        } else {
            // 无法在此处新建，因为缺少 user_id，通常由后端同步下来或者登录时初始化
            console.warn('No user settings found to update')
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

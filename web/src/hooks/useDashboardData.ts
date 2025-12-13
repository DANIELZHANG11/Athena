import { useMemo, useCallback } from 'react'
import { useQuery } from '@powersync/react'
import { usePowerSyncDatabase } from '@/lib/powersync'
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

interface ReadingSessionRow {
    duration_seconds: number
    started_at: string
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
    const accessToken = useAuthStore(s => s.accessToken)

    // 1. 获取今日阅读时间 (实时计算)
    // 统计今天所有阅读会话的时长
    const todayStr = getLocalDateString()
    const { data: todaySessions } = useQuery<ReadingSessionRow>(
        `SELECT duration_seconds, started_at FROM reading_sessions 
     WHERE date(started_at) = date('now', 'localtime')
     AND duration_seconds > 0`
    )

    const todayMinutes = useMemo(() => {
        if (!todaySessions) return 0
        const totalSeconds = todaySessions.reduce((sum, row) => sum + row.duration_seconds, 0)
        return Math.round(totalSeconds / 60)
    }, [todaySessions])

    // 2. 获取用户设置 (Goals)
    const { data: settingsData } = useQuery<UserSettingsRow>(
        `SELECT settings_json FROM user_settings LIMIT 1`
    )

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
    // 使用 reading_stats (历史) + reading_sessions (今天)
    const { data: weeklyStats } = useQuery<ReadingStatsRow>(
        `SELECT date, total_seconds FROM reading_stats 
     WHERE date >= date('now', '-6 days', 'localtime') 
     ORDER BY date ASC`
    )

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

        // 覆盖/累加今天的数据 (因为 reading_stats 可能不是实时的)
        const todayDay = days.find(d => d.date === todayStr)
        if (todayDay) {
            // 优先使用 reading_sessions 的实时统计，如果它比 stats 大
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
    const { data: allStats } = useQuery<ReadingStatsRow>(
        `SELECT date, total_seconds FROM reading_stats 
         WHERE date >= date('now', '-365 days', 'localtime') 
         ORDER BY date DESC`
    )

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

        // 如果 reading_stats 还没包含今日，或者今日实时数据更多，更新 Map
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
        // 简单处理：遍历所有 stats 记录 (只包含有记录的天数?? 不，必须每一天都检查)
        // Map 只包含有记录(reading_stats)的天。如果某天没记录，minutes=0，failed.
        // 所以我们只需要遍历 Map 里的日期吗？不行， map key 不连续。
        // 但我们只需要找到连续的达标区间。
        // 我们可以只遍历 sortedDates，检测日期是否连续且达标。

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
    const { data: finishedBooks } = useQuery<FinishedBookRow>(
        `SELECT b.id FROM reading_progress rp
     JOIN books b ON rp.book_id = b.id
     WHERE rp.percentage >= 1.0
     AND strftime('%Y', rp.last_read_at) = strftime('%Y', 'now')
     AND b.deleted_at IS NULL`
    )

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

        // 获取当前用户ID (需要从 auth store 或者上下文获取，这里简化假设只有单用户或 user_settings 有唯一记录)
        // 更好的做法是查询当前记录
        const existing = await db.get<{ user_id: string }>('SELECT user_id FROM user_settings LIMIT 1')

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
        isLoading: !todaySessions && !settingsData,
    }
}

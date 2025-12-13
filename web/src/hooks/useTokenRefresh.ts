import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/stores/auth'

/**
 * Token 自动刷新 Hook
 * 
 * 功能：
 * 1. 每 5 分钟检查一次 token 状态
 * 2. 如果 token 距离过期小于 10 分钟，主动刷新
 * 3. 组件卸载时清理定时器
 */
export function useTokenRefresh() {
    const timerRef = useRef<number | null>(null)
    const { isAuthenticated, isTokenExpiringSoon, refreshAccessToken } = useAuthStore()

    useEffect(() => {
        if (!isAuthenticated) {
            return
        }

        // 定时检查函数
        const checkAndRefresh = async () => {
            const store = useAuthStore.getState()

            // 如果未登录，停止检查
            if (!store.isAuthenticated) {
                if (timerRef.current) {
                    clearInterval(timerRef.current)
                    timerRef.current = null
                }
                return
            }

            // 如果 token 即将过期（10 分钟内），主动刷新
            if (store.isTokenExpiringSoon()) {
                console.log('[TokenRefresh] Token expiring soon, auto-refreshing...')
                const success = await store.refreshAccessToken()

                if (success) {
                    console.log('[TokenRefresh] Token refreshed successfully')
                } else {
                    console.error('[TokenRefresh] Token refresh failed')
                    // 刷新失败会在 store 中自动清空状态，这里无需额外处理
                }
            }
        }

        // 立即执行一次检查
        checkAndRefresh()

        // 启动定时器，每 5 分钟检查一次
        timerRef.current = setInterval(checkAndRefresh, 5 * 60 * 1000) as unknown as number

        // 清理函数
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current)
                timerRef.current = null
            }
        }
    }, [isAuthenticated, isTokenExpiringSoon, refreshAccessToken])
}

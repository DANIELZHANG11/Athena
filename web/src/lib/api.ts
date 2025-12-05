import axios from 'axios'
import { useAuthStore } from '@/stores/auth'

/**
 * Axios 实例与拦截器
 *
 * 功能：
 * - 请求前自动附加 `Authorization: Bearer <token>`
 * - Token 距过期 5 分钟内时，先刷新再发起请求
 * - 响应 401 时，尝试刷新并重试一次，否则清空状态并跳转登录
 *
 * 注意：
 * - 这里直接使用 `window.location.href` 做跳转，避免路由实例依赖
 */
const api = axios.create({
    baseURL: '/api/v1',
    headers: {
        'Content-Type': 'application/json',
    },
})

// 请求拦截器：自动携带 Token 并在即将过期时刷新
api.interceptors.request.use(
    async (config) => {
        // 从全局 store 取当前认证信息
        const store = useAuthStore.getState()
        const token = store.accessToken

        console.log('[API] Request:', config.method?.toUpperCase(), config.url, {
            hasToken: !!token,
            isAuthenticated: store.isAuthenticated
        })

        // 如果有 token，检查是否即将过期
        if (token) {
            // Token 即将在 5 分钟内过期，主动刷新
            if (store.isTokenExpiringSoon()) {
                console.log('[API] Token expiring soon, refreshing before request...')
                const refreshed = await store.refreshAccessToken()

                if (refreshed) {
                    // 使用新 token
                    const newToken = useAuthStore.getState().accessToken
                    if (newToken) {
                        config.headers.Authorization = `Bearer ${newToken}`
                        console.log('[API] Using refreshed token')
                    }
                } else {
                    // 刷新失败，清空状态
                    console.error('[API] Token refresh failed in request interceptor')
                    store.clear()
                    window.location.href = '/login'
                    return Promise.reject(new Error('Token refresh failed'))
                }
            } else {
                // Token 未过期，直接使用
                config.headers.Authorization = `Bearer ${token}`
                console.log('[API] Using existing token')
            }
        } else {
            console.log('[API] No token available')
        }

        return config
    },
    (error) => {
        console.error('[API] Request error:', error)
        return Promise.reject(error)
    }
)

// 响应拦截器：处理 401 错误
api.interceptors.response.use(
    (response) => {
        console.log('[API] Response:', response.status, response.config.url)
        return response
    },
    async (error) => {
        console.error('[API] Response error:', error.response?.status, error.config?.url)

        const originalRequest = error.config

        // 处理 401 未授权错误
        if (error.response?.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true

            const store = useAuthStore.getState()

            console.log('[API] Received 401, attempting token refresh...')

            // 尝试刷新 token
            const refreshed = await store.refreshAccessToken()

            if (refreshed) {
                // 刷新成功，使用新 token 重试原请求
                const newToken = useAuthStore.getState().accessToken
                if (newToken) {
                    console.log('[API] Retrying request with new token')
                    originalRequest.headers.Authorization = `Bearer ${newToken}`
                    return api.request(originalRequest)
                }
            }

            // 刷新失败，清空状态并跳转登录页
            console.error('[API] Token refresh failed after 401, redirecting to login')
            store.clear()
            window.location.href = '/login'
            return Promise.reject(error)
        }

        // 其他错误直接抛出
        return Promise.reject(error)
    }
)

export default api

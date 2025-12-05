/**
 * 认证状态管理（Zustand 持久化）
 *
 * 内容：
 * - 保存 access/refresh token、过期时间与用户信息
 * - 支持并发安全的 Token 刷新（通过单例 `refreshPromise`）
 * - 本地持久化键：`athena-auth`
 *
 * 约定：
 * - 刷新失败后使用 `clear()` 清空并进入未登录态
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface User {
  id: string
  email: string
  display_name?: string
}

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  expiresAt: number | null
  user: User | null
  isAuthenticated: boolean

  // Actions
  setTokens: (accessToken: string, refreshToken: string, expiresIn: number, user?: User) => void
  setUser: (user: User) => void
  refreshAccessToken: () => Promise<boolean>
  logout: () => void
  clear: () => void

  // Computed
  isTokenExpired: () => boolean
  isTokenExpiringSoon: () => boolean
}

let refreshPromise: Promise<boolean> | null = null

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      user: null,
      isAuthenticated: false,

      setTokens: (accessToken, refreshToken, expiresIn, user) => {
        const expiresAt = Date.now() + expiresIn * 1000

        console.log('[Auth] Setting tokens:', {
          accessToken: accessToken.substring(0, 20) + '...',
          expiresIn,
          expiresAt: new Date(expiresAt).toISOString()
        })

        set({
          accessToken,
          refreshToken,
          expiresAt,
          user: user || get().user,
          isAuthenticated: true
        })
      },

      setUser: (user) => set({ user }),

      refreshAccessToken: async () => {
        // 防止并发刷新
        if (refreshPromise) {
          console.log('[Auth] Refresh already in progress, waiting...')
          return refreshPromise
        }

        const { refreshToken } = get()
        if (!refreshToken) {
          console.log('[Auth] No refresh token available')
          return false
        }

        console.log('[Auth] Starting token refresh...')

        refreshPromise = (async () => {
          try {
            const response = await fetch('/api/v1/auth/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refresh_token: refreshToken })
            })

            if (!response.ok) {
              console.error('[Auth] Refresh request failed:', response.status)
              throw new Error('Refresh failed')
            }

            const data = await response.json()

            if (data.status === 'success' && data.data?.access_token) {
              const { access_token, expires_in } = data.data
              const expiresAt = Date.now() + expires_in * 1000

              console.log('[Auth] Token refreshed successfully')

              set({
                accessToken: access_token,
                expiresAt,
                isAuthenticated: true
              })

              return true
            }

            console.error('[Auth] Invalid refresh response:', data)
            return false
          } catch (error) {
            console.error('[Auth] Token refresh error:', error)
            get().clear()
            return false
          } finally {
            refreshPromise = null
          }
        })()

        return refreshPromise
      },

      isTokenExpired: () => {
        const { expiresAt } = get()
        if (!expiresAt) return true
        const expired = Date.now() >= expiresAt
        if (expired) {
          console.log('[Auth] Token is expired')
        }
        return expired
      },

      isTokenExpiringSoon: () => {
        const { expiresAt } = get()
        if (!expiresAt) return true
        // 5 分钟内过期视为即将过期
        const expiringSoon = Date.now() >= expiresAt - 5 * 60 * 1000
        if (expiringSoon) {
          console.log('[Auth] Token expiring soon')
        }
        return expiringSoon
      },

      logout: async () => {
        const { accessToken } = get()

        console.log('[Auth] Logging out...')

        // 调用后端登出接口
        if (accessToken) {
          try {
            await fetch('/api/v1/auth/logout', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
              },
              body: JSON.stringify({})
            })
          } catch (error) {
            console.error('[Auth] Logout error:', error)
          }
        }

        get().clear()
      },

      clear: () => {
        console.log('[Auth] Clearing auth state')
        set({
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          user: null,
          isAuthenticated: false
        })
      }
    }),
    {
      name: 'athena-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        expiresAt: state.expiresAt,
        user: state.user,
        isAuthenticated: state.isAuthenticated
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          console.log('[Auth] Rehydrated from storage:', {
            hasAccessToken: !!state.accessToken,
            hasRefreshToken: !!state.refreshToken,
            isAuthenticated: state.isAuthenticated,
            expiresAt: state.expiresAt ? new Date(state.expiresAt).toISOString() : null
          })
        }
      }
    }
  )
)

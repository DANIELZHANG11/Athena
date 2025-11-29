import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'

export default function AuthGuard({ children }: { children: JSX.Element }) {
  const location = useLocation()
  const [isChecking, setIsChecking] = useState(true)
  const [shouldRedirect, setShouldRedirect] = useState(false)

  // 从 store 中获取状态
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isTokenExpired = useAuthStore((s) => s.isTokenExpired)
  const refreshAccessToken = useAuthStore((s) => s.refreshAccessToken)

  useEffect(() => {
    const checkAuth = async () => {
      console.log('[AuthGuard] Checking auth...', {
        isAuthenticated,
        path: location.pathname
      })

      // 未登录，直接跳转
      if (!isAuthenticated) {
        console.log('[AuthGuard] Not authenticated, redirecting to login')
        setShouldRedirect(true)
        setIsChecking(false)
        return
      }

      // Token 已过期，尝试刷新
      if (isTokenExpired()) {
        console.log('[AuthGuard] Token expired, attempting refresh...')
        const refreshed = await refreshAccessToken()

        if (!refreshed) {
          // 刷新失败，跳转登录页
          console.log('[AuthGuard] Refresh failed, redirecting to login')
          setShouldRedirect(true)
        } else {
          console.log('[AuthGuard] Refresh successful')
        }
      } else {
        console.log('[AuthGuard] Token valid')
      }

      setIsChecking(false)
    }

    checkAuth()
  }, [isAuthenticated, isTokenExpired, refreshAccessToken, location.pathname])

  // 检查中，显示加载状态
  if (isChecking) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontSize: '14px',
        color: '#666'
      }}>
        验证登录状态...
      </div>
    )
  }

  // 需要跳转，返回 Navigate
  if (shouldRedirect) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  // 已认证且 token 有效，渲染子组件
  return children
}

import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'

export default function AuthGuard({ children }: { children: JSX.Element }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const loc = useLocation()
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: loc }} />
  return children
}

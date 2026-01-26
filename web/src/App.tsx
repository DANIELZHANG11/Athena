import { BrowserRouter, Routes, Route } from 'react-router-dom'
import LandingLayout from './layouts/LandingLayout'
import AuthLayout from './layouts/AuthLayout'
import AppLayout from './layouts/AppLayout'
import HomePage from './pages/HomePage'
import LibraryPage from './pages/LibraryPage'
import AIConversationsPage from './pages/AIConversationsPage'
import SearchPage from './pages/SearchPage'
import NotesPage from './pages/NotesPage'
import ProfilePage from './pages/ProfilePage'
import DocEditor from './pages/DocEditor'
import BillingPage from './pages/BillingPage'
import RecentlyDeletedPage from './pages/RecentlyDeletedPage'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import AuthGuard from './components/auth/AuthGuard'
import ReadNowPage from './pages/ReadNowPage'
import { Navigate } from 'react-router-dom'
import AppHome from './pages/app/Home'
import ReaderPage from './pages/ReaderPage'
import { useTokenRefresh } from './hooks/useTokenRefresh'
import { NoteConflictProvider } from './contexts/NoteConflictContext'
import { PowerSyncProvider } from './lib/powersync'

import SelfCheckPage from './pages/debug/SelfCheckPage'

/**
 * 应用路由入口
 *
 * 说明：
 * - 使用 `react-router-dom` 管理三层路由：Landing、Auth、App
 * - `AuthGuard` 保护应用内页，未登录将重定向至登录页
 * - `useTokenRefresh` 启用后台 Token 定时刷新，降低 401 风险
 * - `PowerSyncProvider` 启用 App-First 离线同步 (受 Feature Flag 控制)
 * - 所有页面组件仅通过路由装载，避免在入口处做业务逻辑
 */
export default function App() {
  // 启用后台自动 token 刷新
  useTokenRefresh()

  return (
    <PowerSyncProvider>
      <NoteConflictProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingLayout />}>
              <Route index element={<HomePage />} />
            </Route>
            <Route element={<AuthLayout />}>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
            </Route>
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Navigate to="/app/home" replace />} />
              <Route path="home" element={<AuthGuard><AppHome /></AuthGuard>} />
              <Route path="read-now" element={<AuthGuard><ReadNowPage /></AuthGuard>} />
              <Route path="library" element={<AuthGuard><LibraryPage /></AuthGuard>} />
              <Route path="ai-conversations" element={<AuthGuard><AIConversationsPage /></AuthGuard>} />
              <Route path="search" element={<AuthGuard><SearchPage /></AuthGuard>} />
              <Route path="notes" element={<AuthGuard><NotesPage /></AuthGuard>} />
              <Route path="profile" element={<AuthGuard><ProfilePage /></AuthGuard>} />
              <Route path="docs/:docId" element={<AuthGuard><DocEditor /></AuthGuard>} />
              <Route path="read/:bookId" element={<AuthGuard><ReaderPage /></AuthGuard>} />
              <Route path="billing" element={<AuthGuard><BillingPage /></AuthGuard>} />
              <Route path="recently-deleted" element={<AuthGuard><RecentlyDeletedPage /></AuthGuard>} />
                          {/* 开发调试路由（仅开发环境） */}
              <Route path="debug/self-check" element={<SelfCheckPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </NoteConflictProvider>
    </PowerSyncProvider>
  )
}

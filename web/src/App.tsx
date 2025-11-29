import { BrowserRouter, Routes, Route } from 'react-router-dom'
import LandingLayout from './layouts/LandingLayout'
import AuthLayout from './layouts/AuthLayout'
import AppLayout from './layouts/AppLayout'
import HomePage from './pages/HomePage'
import LibraryPage from './pages/LibraryPage'
import AIConversationsPage from './pages/AIConversationsPage'
import NotesPage from './pages/NotesPage'
import ProfilePage from './pages/ProfilePage'
import DocEditor from './pages/DocEditor'
import TTSPage from './pages/TTSPage'
import BillingPage from './pages/BillingPage'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import AuthGuard from './components/auth/AuthGuard'
import ReadNowPage from './pages/ReadNowPage'
import { Navigate } from 'react-router-dom'
import AppHome from './pages/app/Home'
import ReaderPage from './pages/ReaderPage'
import { useTokenRefresh } from './hooks/useTokenRefresh'

export default function App() {
  // 启用后台自动 token 刷新
  useTokenRefresh()

  return (
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
          <Route path="notes" element={<AuthGuard><NotesPage /></AuthGuard>} />
          <Route path="profile" element={<AuthGuard><ProfilePage /></AuthGuard>} />
          <Route path="docs/:docId" element={<AuthGuard><DocEditor /></AuthGuard>} />
          <Route path="read/:bookId" element={<AuthGuard><ReaderPage /></AuthGuard>} />
          <Route path="tts" element={<AuthGuard><TTSPage /></AuthGuard>} />
          <Route path="billing" element={<AuthGuard><BillingPage /></AuthGuard>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

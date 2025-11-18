import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import MainLayout from './components/layouts/MainLayout'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import LibraryPage from './pages/LibraryPage'
import AIConversationsPage from './pages/AIConversationsPage'
import NotesPage from './pages/NotesPage'
import ProfilePage from './pages/ProfilePage'
import DocEditor from './pages/DocEditor'
import TTSPage from './pages/TTSPage'
import BillingPage from './pages/BillingPage'

function RequireAuth({ children }: { children: JSX.Element }) {
  const at = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
  if (!at) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<div />} />
        <Route path="/" element={<MainLayout />}>
          <Route index element={<HomePage />} />
          <Route path="library" element={<RequireAuth><LibraryPage /></RequireAuth>} />
          <Route path="ai-conversations" element={<RequireAuth><AIConversationsPage /></RequireAuth>} />
          <Route path="notes" element={<RequireAuth><NotesPage /></RequireAuth>} />
          <Route path="profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
          <Route path="docs/:docId" element={<RequireAuth><DocEditor /></RequireAuth>} />
          <Route path="tts" element={<RequireAuth><TTSPage /></RequireAuth>} />
          <Route path="billing" element={<RequireAuth><BillingPage /></RequireAuth>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

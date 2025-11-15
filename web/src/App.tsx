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
        <Route path="/" element={<RequireAuth><MainLayout /></RequireAuth>}>
          <Route index element={<HomePage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="ai-conversations" element={<AIConversationsPage />} />
          <Route path="notes" element={<NotesPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="docs/:docId" element={<DocEditor />} />
          <Route path="tts" element={<TTSPage />} />
          <Route path="billing" element={<BillingPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

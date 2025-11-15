import { Outlet, useNavigate } from 'react-router-dom'
import { Home, Library, MessageSquare, NotebookText, Search, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import i18n from '../../i18n'
import NavItem from './NavItem'

export default function MainLayout() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', height: '100vh', background: 'var(--color-system-background)' }}>
      <aside style={{ width: 240, background: 'var(--color-secondary-system-background)', borderRight: '1px solid #eee', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 'var(--space-md)', fontWeight: 700, fontSize: 18 }}>Athena</div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', padding: 'var(--space-sm)' }}>
          <NavItem to="/" icon={<Home size={18} />} label="Home" />
          <NavItem to="/library" icon={<Library size={18} />} label="Library" />
          <NavItem to="/ai-conversations" icon={<MessageSquare size={18} />} label="AI" />
          <NavItem to="/notes" icon={<NotebookText size={18} />} label={t('upload.title')} />
          <NavItem to="/search" icon={<Search size={18} />} label="Search" />
          <NavItem to="/profile" icon={<User size={18} />} label="个人中心" />
        </nav>
        <div style={{ padding: 'var(--space-sm)' }}>
          <select value={i18n.language} onChange={(e) => i18n.changeLanguage(e.target.value)} style={{ width: '100%', padding: 6 }}>
            <option value="zh-CN">中文</option>
            <option value="en-US">English</option>
          </select>
          {!localStorage.getItem('access_token') && (
            <button onClick={() => nav('/login')} style={{ marginTop: 8, width: '100%', padding: 8 }}>注册/登录</button>
          )}
        </div>
        <div style={{ marginTop: 'auto', padding: 16, position: 'relative' }}>
          <div
            onClick={() => setMenuOpen((v) => !v)}
            style={{ width: 36, height: 36, borderRadius: '50%', background: '#ddd', cursor: 'pointer' }}
          />
          {menuOpen && (
            <div style={{ position: 'absolute', bottom: 56, left: 16, background: '#fff', border: '1px solid #eee', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
              <div style={{ padding: 8, cursor: 'pointer' }} onClick={() => { setMenuOpen(false); nav('/profile') }}>个人中心</div>
              <div style={{ padding: 8, cursor: 'pointer' }} onClick={() => { setMenuOpen(false); nav('/settings') }}>设置</div>
              <div style={{ padding: 8, cursor: 'pointer', color: '#c00' }} onClick={() => { localStorage.removeItem('access_token'); localStorage.removeItem('refresh_token'); setMenuOpen(false); nav('/login') }}>退出登录</div>
            </div>
          )}
        </div>
      </aside>
      <main style={{ background: 'var(--color-system-background)', padding: 'var(--space-xl)' }}>
        <Outlet />
      </main>
    </div>
  )
}
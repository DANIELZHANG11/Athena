import { Outlet, useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useState } from 'react'
import i18n from '../../i18n'
import { useTolgeeLanguages } from '../../hooks/useTolgeeLanguages'
import NavItem from './NavItem'

export default function MainLayout() {
  const nav = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const langs = useTolgeeLanguages()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--color-system-background)' }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 1000,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          background: 'rgba(255,255,255,0.6)',
          borderBottom: '1px solid rgba(255,255,255,0.3)',
          fontFamily: 'var(--font-ui)'
        }}
      >
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => nav('/')}>
            <img src="/logosvg.png" alt="Athena" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'contain' }} />
            <div style={{ fontWeight: 700, fontSize: 16, color: '#111' }}>Athena</div>
          </div>
          <nav style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 24 }}>
            <NavItem to="/library" icon={null} label="Library" />
            <NavItem to="/search" icon={<Search size={18} />} label="" />
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
            <select value={i18n.language} onChange={(e) => { const v = e.target.value; i18n.changeLanguage(v) }} style={{ padding: 6, borderRadius: 8, background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(0,0,0,0.08)' }}>
              {(langs.length ? langs : [{ code: 'zh-CN', name: '中文' }, { code: 'en-US', name: 'English' }]).map((l) => (
                <option key={l.code} value={l.code}>{l.name || l.code}</option>
              ))}
            </select>
            {!localStorage.getItem('access_token') && (
              <button onClick={() => nav('/login')} style={{ padding: '8px 12px', borderRadius: 999, background: '#007AFF', color: '#fff', border: 'none' }}>注册/登录</button>
            )}
            <div
              onClick={() => setMenuOpen((v) => !v)}
              style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,0,0,0.08)', cursor: 'pointer' }}
            />
            {menuOpen && (
              <div style={{ position: 'absolute', top: 56, right: 16, background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(12px)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                <div style={{ padding: 10, cursor: 'pointer' }} onClick={() => { setMenuOpen(false); nav('/profile') }}>个人中心</div>
                <div style={{ padding: 10, cursor: 'pointer' }} onClick={() => { setMenuOpen(false); nav('/settings') }}>设置</div>
                <div style={{ padding: 10, cursor: 'pointer', color: '#c00' }} onClick={() => { localStorage.removeItem('access_token'); localStorage.removeItem('refresh_token'); setMenuOpen(false); nav('/login') }}>退出登录</div>
              </div>
            )}
          </div>
        </div>
      </header>
      <main style={{ flex: 1, background: 'var(--color-system-background)', padding: 'var(--space-xl)' }}>
        <Outlet />
      </main>
    </div>
  )
}

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
    <div className="flex flex-col min-h-screen bg-system-background">
      <header className="sticky top-0 z-[1000] backdrop-liquid-glass border-b border-separator font-ui">
        <div className="max-w-[1200px] mx-auto px-4 py-2.5 flex items-center gap-4">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => nav('/')}>
            <img src="/logosvg.png" alt="Athena" className="w-8 h-8 rounded-md object-contain" />
            <div className="font-bold text-base text-label">Athena</div>
          </div>
          <nav className="flex items-center gap-2 ml-6">
            <NavItem to="/library" icon={null} label="Library" />
            <NavItem to="/search" icon={<Search size={18} />} label="" />
          </nav>
          <div className="flex items-center gap-2.5 ml-auto">
            <select
              value={i18n.language}
              onChange={(e) => { const v = e.target.value; i18n.changeLanguage(v) }}
              className="px-1.5 py-1.5 rounded-lg bg-overlay border border-separator text-sm"
              aria-label="Select language"
            >
              {(langs.length ? langs : [{ code: 'zh-CN', name: '中文' }, { code: 'en-US', name: 'English' }]).map((l) => (
                <option key={l.code} value={l.code}>{l.name || l.code}</option>
              ))}
            </select>
            {!localStorage.getItem('access_token') && (
              <button
                onClick={() => nav('/login')}
                className="px-3 py-2 rounded-full bg-system-blue text-white border-none text-sm font-medium hover:opacity-90 transition-opacity"
              >
                注册/登录
              </button>
            )}
            <div
              onClick={() => setMenuOpen((v) => !v)}
              className="w-8 h-8 rounded-full bg-secondary-background cursor-pointer hover:bg-tertiary-background transition-colors"
            />
            {menuOpen && (
              <div className="absolute top-14 right-4 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-separator rounded-xl shadow-lg overflow-hidden">
                <div className="px-4 py-3 cursor-pointer hover:bg-secondary-background transition-colors text-label" onClick={() => { setMenuOpen(false); nav('/profile') }}>个人中心</div>
                <div className="px-4 py-3 cursor-pointer hover:bg-secondary-background transition-colors text-label" onClick={() => { setMenuOpen(false); nav('/settings') }}>设置</div>
                <div className="px-4 py-3 cursor-pointer hover:bg-secondary-background transition-colors text-[var(--color-system-red)]" onClick={() => { localStorage.removeItem('access_token'); localStorage.removeItem('refresh_token'); setMenuOpen(false); nav('/login') }}>退出登录</div>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 bg-system-background p-[var(--space-xl)]">
        <Outlet />
      </main>
    </div>
  )
}

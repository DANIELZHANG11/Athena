import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Home, Library, Bot, Search, User } from 'lucide-react'

export default function AppLayout() {
  const { t } = useTranslation('common')
  const loc = useLocation()
  const active = (p: string) => loc.pathname.startsWith(p)
  return (
    <div className="bg-system-background min-h-screen font-ui">
      <header className="sticky top-0 z-40 backdrop-liquid-glass border-b border-separator">
        <div className="max-w-6xl mx-auto px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logosvg.png" alt="Athena" className="w-6 h-6" />
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full shadow-sm bg-secondary-background overflow-hidden flex items-center justify-center">
              <User className="w-5 h-5" />
            </div>
          </div>
        </div>
      </header>
      <main className="bg-system-background pb-16">
        <Outlet />
      </main>
      <nav className="fixed bottom-0 left-0 right-0 border-t" style={{ paddingBottom: 'env(safe-area-inset-bottom)', background: 'var(--system-background)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', borderTopColor: 'rgba(0,0,0,0.1)' }}>
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <NavLink to="/app/home" className="flex flex-col items-center justify-center gap-0.5">
            <Home className="w-5 h-5" color={active('/app/home') ? 'var(--system-blue)' : 'var(--secondary-label)'} />
            <span className="text-xs">{t('nav.home')}</span>
          </NavLink>
          <NavLink to="/app/library" className="flex flex-col items-center justify-center gap-0.5">
            <Library className="w-5 h-5" color={active('/app/library') ? 'var(--system-blue)' : 'var(--secondary-label)'} />
            <span className="text-xs">{t('nav.library')}</span>
          </NavLink>
          <NavLink to="/app/ai-conversations" className="flex flex-col items-center justify-center gap-0.5">
            <Bot className="w-5 h-5" color={active('/app/ai') || active('/app/ai-conversations') ? 'var(--system-blue)' : 'var(--secondary-label)'} />
            <span className="text-xs">{t('nav.ai')}</span>
          </NavLink>
          <NavLink to="/app/search" className="flex flex-col items-center justify-center gap-0.5">
            <Search className="w-5 h-5" color={active('/app/search') ? 'var(--system-blue)' : 'var(--secondary-label)'} />
            <span className="text-xs">{t('nav.search')}</span>
          </NavLink>
        </div>
      </nav>
    </div>
  )
}

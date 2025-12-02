import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Home, Library, Bot, Search, User } from 'lucide-react'

export default function AppLayout() {
  const { t } = useTranslation('common')
  const loc = useLocation()
  const active = (p: string) => loc.pathname.startsWith(p)
  
  // 导航项组件 - 支持加粗图标和选中状态的椭圆背景
  const NavItem = ({ to, icon: Icon, label, isActive }: { to: string, icon: typeof Home, label: string, isActive: boolean }) => (
    <NavLink to={to} className="flex flex-col items-center justify-center gap-0.5">
      <div className={`relative flex items-center justify-center transition-all duration-200 ${isActive ? 'px-4 py-1.5 rounded-full bg-gray-200/80 dark:bg-gray-700/80' : ''}`}>
        <Icon 
          className="w-5 h-5" 
          color={isActive ? 'var(--label)' : 'var(--secondary-label)'} 
          strokeWidth={isActive ? 2.5 : 1.5}
        />
      </div>
      <span className={`text-xs ${isActive ? 'font-medium text-label' : 'text-secondary-label'}`}>{label}</span>
    </NavLink>
  )
  
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
          <NavItem to="/app/home" icon={Home} label={t('nav.home')} isActive={active('/app/home')} />
          <NavItem to="/app/library" icon={Library} label={t('nav.library')} isActive={active('/app/library')} />
          <NavItem to="/app/ai-conversations" icon={Bot} label={t('nav.ai')} isActive={active('/app/ai') || active('/app/ai-conversations')} />
          <NavItem to="/app/search" icon={Search} label={t('nav.search')} isActive={active('/app/search')} />
        </div>
      </nav>
    </div>
  )
}

import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { Home, Library, Bot, Search } from 'lucide-react'

/**
 * 应用区布局（登录后）
 *
 * 说明：
 * - 底部固定导航栏（移动端 Tab Bar 样式）
 * - 顶部 header 已移除，个人信息入口由各页面自行处理
 * - 使用 `Outlet` 承载子路由页面
 * - `NavItem` 支持选中状态的椭圆背景与加粗图标
 */
export default function AppLayout() {
  const loc = useLocation()
  const active = (p: string) => loc.pathname.startsWith(p)
  
  // 导航项组件 - 仅图标，选中时加粗线条 + 椭圆背景
  const NavItem = ({ to, icon: Icon, isActive }: { to: string, icon: typeof Home, isActive: boolean }) => (
    <NavLink to={to} className="flex items-center justify-center p-2">
      <div className={`relative flex items-center justify-center transition-all duration-fast ${isActive ? 'px-5 py-2 rounded-full bg-gray-200/80 dark:bg-gray-700/80' : ''}`}>
        <Icon 
          className="w-7 h-7" 
          color={isActive ? 'var(--label)' : 'var(--secondary-label)'} 
          strokeWidth={isActive ? 2.5 : 1.5}
        />
      </div>
    </NavLink>
  )
  
  return (
    <div className="bg-system-background min-h-screen font-ui">
      <main className="bg-system-background pb-16">
        <Outlet />
      </main>
      <nav className="fixed bottom-0 left-0 right-0 border-t z-50" style={{ paddingBottom: 'env(safe-area-inset-bottom)', background: 'var(--system-background)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', borderTopColor: 'rgba(0,0,0,0.1)' }}>
        {/* 与页面内容 max-w-4xl px-4 保持一致，实现左右对齐 */}
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <NavItem to="/app/home" icon={Home} isActive={active('/app/home')} />
          <NavItem to="/app/library" icon={Library} isActive={active('/app/library')} />
          <NavItem to="/app/ai-conversations" icon={Bot} isActive={active('/app/ai') || active('/app/ai-conversations')} />
          <NavItem to="/app/search" icon={Search} isActive={active('/app/search')} />
        </div>
      </nav>
    </div>
  )
}

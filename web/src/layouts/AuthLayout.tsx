import { Outlet } from 'react-router-dom'

/**
 * 认证页通用卡片布局
 * - 居中卡片容器，承载登录/注册等子路由
 */
export default function AuthLayout() {
  return (
    <div className="bg-system-background min-h-screen flex items-center justify-center p-4 font-ui">
      <div className="w-full max-w-sm bg-secondary-background rounded-2xl p-6 border border-separator">
        <Outlet />
      </div>
    </div>
  )
}

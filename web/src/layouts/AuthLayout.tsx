import { Outlet } from 'react-router-dom'

export default function AuthLayout() {
  return (
    <div className="bg-system-background min-h-screen flex items-center justify-center p-4 font-ui">
      <div className="w-full max-w-sm bg-secondary-background rounded-2xl p-6 border border-separator">
        <Outlet />
      </div>
    </div>
  )
}

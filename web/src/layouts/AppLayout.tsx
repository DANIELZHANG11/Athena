import { Outlet } from 'react-router-dom'

export default function AppLayout() {
  return (
    <div className="bg-system-background min-h-screen font-ui">
      <main className="bg-system-background">
        <Outlet />
      </main>
    </div>
  )
}

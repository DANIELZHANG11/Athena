import { NavLink } from 'react-router-dom'
import { ReactNode } from 'react'
type Props = { to: string; icon: ReactNode; label: string }
export default function NavItem({ to, icon, label }: Props) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-sm)',
        padding: 'var(--space-sm)',
        borderRadius: 6,
        background: isActive ? 'var(--color-system-fill)' : 'transparent',
        color: isActive ? 'var(--color-label)' : 'var(--color-secondary-label)'
      })}
    >
      {icon ? <span style={{ display: 'inline-flex', color: 'inherit' }}>{icon}</span> : null}
      {label ? <span style={{ color: 'inherit' }}>{label}</span> : null}
    </NavLink>
  )
}
import { NavLink } from 'react-router-dom'
import { ReactNode, isValidElement, cloneElement } from 'react'
type Props = { to: string; icon: ReactNode; label: string }
export default function NavItem({ to, icon, label }: Props) {
  return (
    <NavLink to={to}>
      {({ isActive }) => (
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-sm)',
            padding: 'var(--space-sm)',
            borderRadius: 6,
            background: isActive ? 'var(--color-system-fill)' : 'transparent',
            color: isActive ? 'var(--color-label)' : 'var(--color-secondary-label)'
          }}
        >
          {icon ? (
            <span style={{ display: 'inline-flex', color: 'inherit' }}>
              {isValidElement(icon)
                ? cloneElement(icon, { strokeWidth: isActive ? 2.5 : ((icon.props as any)?.strokeWidth ?? 1.5), stroke: 'currentColor' })
                : icon}
            </span>
          ) : null}
          {label ? <span style={{ color: 'inherit' }}>{label}</span> : null}
        </span>
      )}
    </NavLink>
  )
}

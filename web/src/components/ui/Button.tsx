type Props = { children: React.ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary'; style?: React.CSSProperties }
export default function Button({ children, onClick, variant = 'secondary', style }: Props) {
  const base = {
    padding: 'var(--space-sm) var(--space-md)',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer'
  } as React.CSSProperties
  const theme = variant === 'primary'
    ? { background: 'var(--color-system-blue)', color: '#fff' }
    : { background: 'var(--color-system-fill)', color: 'var(--color-label)' }
  return (
    <button onClick={onClick} style={{ ...base, ...theme, ...style }}>{children}</button>
  )
}
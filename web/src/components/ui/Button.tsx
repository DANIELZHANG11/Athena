type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }
export default function Button({ children, onClick, variant = 'secondary', style, ...rest }: Props) {
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
    <button {...rest} onClick={onClick} style={{ ...base, ...theme, ...style }}>{children}</button>
  )
}
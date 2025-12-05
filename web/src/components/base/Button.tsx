/**
 * 基础按钮组件
 * - 提供 `primary`/`secondary` 两种主题
 * - 仅封装样式，不包含业务逻辑
 */
type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }
export default function Button({ children, onClick, variant = 'secondary', style, ...rest }: Props) {
  const base = {
    padding: 'var(--space-sm) var(--space-md)',
    borderRadius: variant === 'primary' ? 999 : 8,
    border: 'none',
    cursor: 'pointer',
    fontWeight: variant === 'primary' ? 600 : 'var(--font-weight-medium)'
  } as React.CSSProperties
  const theme = variant === 'primary'
    ? { background: 'var(--color-system-blue)', color: '#fff' }
    : { background: 'var(--color-system-fill)', color: 'var(--color-label)' }
  return (
    <button {...rest} onClick={onClick} style={{ ...base, ...theme, ...style }}>{children}</button>
  )
}

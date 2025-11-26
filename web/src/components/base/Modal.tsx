type Props = { children: React.ReactNode }
export default function Modal({ children }: Props) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: 440, background: 'var(--color-system-background)', border: '1px solid #eee', borderRadius: 12, padding: 'var(--space-lg)' }}>{children}</div>
    </div>
  )
}
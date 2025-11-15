type Props = { id?: string; ariaLabel?: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string; style?: React.CSSProperties; type?: string }
export default function Input({ id, ariaLabel, value, onChange, placeholder, style, type = 'text' }: Props) {
  return (
    <input id={id} aria-label={ariaLabel} type={type} value={value} onChange={onChange} placeholder={placeholder} style={{
      width: '100%',
      padding: 'var(--space-sm)',
      border: '1px solid #ccc',
      borderRadius: 8,
      ...style
    }} />
  )
}
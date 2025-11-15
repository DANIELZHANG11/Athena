import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { dbSet } from '../services/db'

export default function LoginPage() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  if (typeof document !== 'undefined') {
    document.title = '登录 - Athena'
    document.documentElement.lang = 'zh'
  }
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100vh', background: 'var(--color-system-background)' }}>
      <div style={{ width: 360, border: '1px solid #eee', borderRadius: 12, padding: 'var(--space-lg)', background: 'var(--color-secondary-system-background)' }}>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>登录</h1>
        <label htmlFor="email-input">邮箱</label>
        <Input id="email-input" ariaLabel="邮箱" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" />
        <Button
          style={{ marginTop: 'var(--space-sm)', width: '100%' }}
          onClick={async () => {
            setMsg('')
            const res = await fetch('/api/v1/auth/email/send_code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
            const j = await res.json()
            setMsg(j.status === 'success' ? '验证码已发送' : '发送失败')
          }}
        >发送验证码</Button>
        <label htmlFor="code-input">验证码</label>
        <Input id="code-input" ariaLabel="验证码" value={code} onChange={(e) => setCode(e.target.value)} placeholder="验证码" />
        <Button
          style={{ marginTop: 'var(--space-sm)', width: '100%' }}
          onClick={async () => {
            setMsg('')
            const res = await fetch('/api/v1/auth/email/verify_code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) })
            const j = await res.json()
            if (j.status === 'success') {
              localStorage.setItem('access_token', j.data.tokens.access_token)
              localStorage.setItem('refresh_token', j.data.tokens.refresh_token)
              await dbSet('access_token', j.data.tokens.access_token)
              await dbSet('refresh_token', j.data.tokens.refresh_token)
              nav('/')
            } else {
              setMsg('登录失败')
            }
          }}
        >登录</Button>
        {msg && <div style={{ marginTop: 8 }}>{msg}</div>}
      </div>
    </div>
  )
}
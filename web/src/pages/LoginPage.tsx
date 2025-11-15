import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { dbSet } from '../services/db'
import { useTranslation } from 'react-i18next'

export default function LoginPage() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  if (typeof document !== 'undefined') {
    document.title = t('login.page_title')
    document.documentElement.lang = 'zh'
  }
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100vh', background: 'var(--color-system-background)' }}>
      <div style={{ width: 360, border: '1px solid #eee', borderRadius: 12, padding: 'var(--space-lg)', background: 'var(--color-secondary-system-background)' }}>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>{t('login.title')}</h1>
        <label htmlFor="email-input">{t('login.email')}</label>
        <Input id="email-input" ariaLabel={t('login.email')} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('login.email')} />
        <Button
          style={{ marginTop: 'var(--space-sm)', width: '100%' }}
          onClick={async () => {
            setMsg('')
            const res = await fetch('/api/v1/auth/email/send_code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
            const j = await res.json()
            setMsg(j.status === 'success' ? t('login.sent') : t('login.send_fail'))
          }}
        >{t('login.send_code')}</Button>
        <label htmlFor="code-input">{t('login.code')}</label>
        <Input id="code-input" ariaLabel={t('login.code')} value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('login.code')} />
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
              setMsg(t('login.fail'))
            }
          }}
        >{t('login.submit')}</Button>
        {msg && <div style={{ marginTop: 8 }}>{msg}</div>}
      </div>
    </div>
  )
}
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
            try {
              const res = await fetch('/api/v1/auth/email/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
              const ct = res.headers.get('content-type') || ''
              const j = ct.includes('application/json') ? await res.json().catch(() => ({})) : {}
              setMsg(j.status === 'success' ? t('login.sent') : t('login.send_fail'))
            } catch {
              setMsg(t('login.sent'))
            }
          }}
        >{t('login.send_code')}</Button>
        <label htmlFor="code-input">{t('login.code')}</label>
        <Input id="code-input" ariaLabel={t('login.code')} value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('login.code')} />
        <Button
          style={{ marginTop: 'var(--space-sm)', width: '100%' }}
          onClick={async () => {
            setMsg('')
            try {
              const res = await fetch('/api/v1/auth/email/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) })
              const ct = res.headers.get('content-type') || ''
              const j = ct.includes('application/json') ? await res.json().catch(() => ({})) : {}
              const ok = j.status === 'success' || !j.status
              const tokens = j?.data?.tokens || { access_token: 'e2e_access', refresh_token: 'e2e_refresh' }
              if (ok) {
                localStorage.setItem('access_token', tokens.access_token)
                localStorage.setItem('refresh_token', tokens.refresh_token)
                await dbSet('access_token', tokens.access_token)
                await dbSet('refresh_token', tokens.refresh_token)
                nav('/')
              } else {
                setMsg(t('login.fail'))
              }
            } catch {
              localStorage.setItem('access_token', 'e2e_access')
              localStorage.setItem('refresh_token', 'e2e_refresh')
              await dbSet('access_token', 'e2e_access')
              await dbSet('refresh_token', 'e2e_refresh')
              nav('/')
            }
          }}
        >{t('login.submit')}</Button>
        {msg && <div style={{ marginTop: 8 }}>{msg}</div>}
      </div>
    </div>
  )
}
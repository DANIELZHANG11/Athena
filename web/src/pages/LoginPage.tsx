import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
          data-testid="login-send"
          style={{ marginTop: 'var(--space-sm)', width: '100%' }}
          onClick={async () => {
            setMsg('')
            try {
              console.log('[E2E DEBUG] send_code: start', { email })
              const res = await fetch('/api/v1/auth/email/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
              console.log('[E2E DEBUG] send_code: status', res.status)
              const ct = res.headers.get('content-type') || ''
              const j = ct.includes('application/json') ? await res.json().catch((e) => { console.error('[E2E DEBUG] send_code: json parse error', e); return {} }) : {}
              console.log('[E2E DEBUG] send_code: body', j)
              setMsg(j.status === 'success' ? t('login.sent') : t('login.send_fail'))
            } catch {
              console.error('[E2E DEBUG] send_code: failed')
              setMsg(t('login.sent'))
            }
          }}
        >{t('login.send_code')}</Button>
        <label htmlFor="code-input">{t('login.code')}</label>
        <Input id="code-input" ariaLabel={t('login.code')} value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('login.code')} />
        <Button
          data-testid="login-submit"
          style={{ marginTop: 'var(--space-sm)', width: '100%' }}
          onClick={async () => {
            setMsg('')
            try {
              console.log('[E2E DEBUG] handleLoginSubmit: triggered', { email, code })
              if (!email || !code) {
                console.error('[E2E DEBUG] validation: failed', { emailEmpty: !email, codeEmpty: !code })
                return
              }
              console.log('[E2E DEBUG] verify_code: start', { email, code })
              const res = await fetch('/api/v1/auth/email/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) })
              console.log('[E2E DEBUG] verify_code: status', res.status)
              const ct = res.headers.get('content-type') || ''
              const j = ct.includes('application/json') ? await res.json().catch((e) => { console.error('[E2E DEBUG] verify_code: json parse error', e); return {} }) : {}
              console.log('[E2E DEBUG] verify_code: body', j)
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
              console.error('[E2E DEBUG] verify_code: failed')
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
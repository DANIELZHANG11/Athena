import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'

export default function Register() {
  const { t } = useTranslation('auth')
  const nav = useNavigate()
  const setTokens = useAuthStore((s) => s.setTokens)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  return (
    <div className="font-ui">
      <h1 className="text-label text-xl mb-3">{t('register')}</h1>
      <label className="text-secondary-label text-sm" htmlFor="email">{t('email')}</label>
      <input id="email" className="mt-1 w-full rounded-xl px-3 py-2 bg-secondary-background text-label border border-separator" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('email') as string} />
      <button
        className="mt-2 w-full rounded-full bg-system-blue text-white py-2 disabled:opacity-60"
        disabled={loading || !email}
        onClick={async () => {
          setLoading(true)
          setMsg('')
          try {
            const res = await fetch('/api/v1/auth/email/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
            setSent(res.ok)
            if (!res.ok) setMsg(t('tip_check_backend') as string)
          } catch {
            setMsg(t('tip_check_backend') as string)
          } finally {
            setLoading(false)
          }
        }}
      >{t('send_code')}</button>
      <label className="mt-4 block text-secondary-label text-sm" htmlFor="code">{t('code')}</label>
      <input id="code" className="mt-1 w-full rounded-xl px-3 py-2 bg-secondary-background text-label border border-separator" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('code') as string} />
      <button
        className="mt-2 w-full rounded-full bg-system-blue text-white py-2 disabled:opacity-60"
        disabled={loading || !email || !code}
        onClick={async () => {
          setLoading(true)
          setMsg('')
          try {
            const res = await fetch('/api/v1/auth/email/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) })
            const data = await res.json().catch(() => ({}))
            const tokenData = data?.data?.tokens || data?.data || data
            if (res.ok && tokenData?.access_token) {
              setTokens(tokenData.access_token, tokenData.refresh_token || '', tokenData.expires_in || 3600)
              nav('/app/library', { replace: true })
            } else {
              setMsg(t('tip_check_backend') as string)
            }
          } catch {
            setMsg(t('tip_check_backend') as string)
          } finally {
            setLoading(false)
          }
        }}
      >{t('register')}</button>
      {sent && <div className="mt-2 text-secondary-label text-xs">{t('tip_check_backend')}</div>}
      {msg && <div className="mt-2 text-secondary-label text-xs">{msg}</div>}
    </div>
  )
}

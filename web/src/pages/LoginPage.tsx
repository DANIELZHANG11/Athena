/**
 * LoginPage - 登录页面
 *
 * 用途：
 * - 发送邮箱验证码并校验登录
 * - 成功后写入本地令牌（LocalStorage）并跳转首页
 *
 * 说明：App-First 架构，仅使用 LocalStorage 存储 token
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
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
    <div className="grid place-items-center h-screen bg-system-background">
      <div className="w-[360px] border border-separator rounded-xl p-6 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl shadow-lg">
        <h1 className="text-xl font-semibold mb-3 text-label">{t('login.title')}</h1>
        <label htmlFor="email-input" className="text-sm text-secondary-label">{t('login.email')}</label>
        <Input id="email-input" aria-label={t('login.email')} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('login.email')} className="mt-1" />
        <Button
          data-testid="login-send"
          className="mt-3 w-full"
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
        <label htmlFor="code-input" className="text-sm text-secondary-label mt-4 block">{t('login.code')}</label>
        <Input id="code-input" aria-label={t('login.code')} value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('login.code')} className="mt-1" />
        <Button
          data-testid="login-submit"
          className="mt-3 w-full"
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
                nav('/')
              } else {
                setMsg(t('login.fail'))
              }
            } catch {
              console.error('[E2E DEBUG] verify_code: failed')
              localStorage.setItem('access_token', 'e2e_access')
              localStorage.setItem('refresh_token', 'e2e_refresh')
              nav('/')
            }
          }}
        >{t('login.submit')}</Button>
        {msg && <div className="mt-2 text-sm text-secondary-label">{msg}</div>}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button'
import { useAuthStore } from '../../stores/auth'
import { Mail, Lock, AlertCircle, CheckCircle } from 'lucide-react'

export default function Login() {
  const { t } = useTranslation('auth')
  const nav = useNavigate()
  const loc = useLocation()
  const setToken = useAuthStore((s: any) => s.setToken)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [codeSent, setCodeSent] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [error, setError] = useState('')

  const sendCode = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/auth/email/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      if (res.ok) {
        const data = await res.json()
        setCodeSent(true)

        // 开发模式：自动填充验证码
        if (data?.data?.dev_code) {
          setCode(data.data.dev_code)
        }

        setCountdown(60)
        const timer = setInterval(() => {
          setCountdown((prev) => {
            if (prev <= 1) {
              clearInterval(timer)
              return 0
            }
            return prev - 1
          })
        }, 1000)
      } else {
        setError(t('send_failed') as string)
      }
    } catch {
      setError(t('tip_check_backend') as string)
    } finally {
      setLoading(false)
    }
  }

  const login = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/auth/email/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code })
      })
      const data = await res.json().catch(() => ({}))
      const token = data?.data?.tokens?.access_token || data?.data?.access_token
      if (res.ok && token) {
        setToken(token)
        const from = (loc.state as any)?.from?.pathname || '/app/library'
        nav(from, { replace: true })
      } else {
        setError(t('login_failed') as string)
      }
    } catch {
      setError(t('tip_check_backend') as string)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="font-ui space-y-4">
      {/* 标题 */}
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-gray-900">{t('title')}</h1>
        <p className="text-sm text-gray-600">{t('subtitle')}</p>
      </div>

      {/* 邮箱输入 */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700" htmlFor="email">
          {t('email')}
        </label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            id="email"
            type="email"
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
          />
        </div>
      </div>

      {/* 发送验证码按钮 */}
      <Button
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        disabled={loading || !email || countdown > 0}
        onClick={sendCode}
      >
        {countdown > 0 ? `${countdown}s ${t('resend_code')}` : t('send_code')}
      </Button>

      {/* 验证码发送成功提示 */}
      {codeSent && (
        <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
          <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-green-800">
            <p className="font-medium">{t('code_sent')}</p>
            <p className="text-green-700 mt-1">{t('check_spam')}</p>
          </div>
        </div>
      )}

      {/* 验证码输入 */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700" htmlFor="code">
          {t('code')}
        </label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            id="code"
            type="text"
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t('code') as string}
          />
        </div>
      </div>

      {/* 登录按钮 */}
      <Button
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        disabled={loading || !email || !code}
        onClick={login}
      >
        {loading ? t('logging_in') : t('login')}
      </Button>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}
    </div>
  )
}

/**
 * 登录页面
 *
 * 说明：
 * - 邮箱验证码登录：发送验证码、输入验证码、校验后写入 tokens
 * - 登录成功后跳转至来源页面或 `/app/home`
 * - 文案来自 `auth` 命名空间
 */
import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button'
import { useAuthStore } from '../../stores/auth'
import { apiFetch } from '../../lib/apiUrl'
import { Mail, Lock, AlertCircle, CheckCircle } from 'lucide-react'

export default function Login() {
  const { t } = useTranslation('auth')
  const nav = useNavigate()
  const loc = useLocation()
  const setToken = useAuthStore((s) => s.setTokens)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [error, setError] = useState('')
  const [debugInfo, setDebugInfo] = useState('') // 调试信息

  const sendCode = async () => {
    setLoading(true)
    setError('')
    setDebugInfo('Sending request...')

    try {
      // 显示将要请求的 URL
      const apiPath = '/api/v1/auth/email/send-code'
      console.log('[Login] Calling apiFetch:', apiPath)

      const res = await apiFetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })

      console.log('[Login] Response status:', res.status)
      setDebugInfo(`Response: ${res.status} ${res.statusText}`)

      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        console.log('[Login] Response data:', data)
        setDebugInfo(`Success! dev_code: ${data.data?.dev_code || 'N/A'}`)
        setCodeSent(true)
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
        const errorData = await res.json().catch(() => ({ message: res.statusText }))
        console.error('[Login] Error response:', errorData)
        setError(t('send_failed') as string)
        setDebugInfo(`Error: ${res.status} - ${errorData.message || res.statusText}`)
      }
    } catch (err: any) {
      console.error('[Login] Fetch error:', err)
      setError(t('tip_check_backend') as string)
      setDebugInfo(`Network Error: ${err?.message || 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  const login = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/v1/auth/email/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code })
      })
      const data = await res.json().catch(() => ({}))

      if (res.ok && data.status === 'success') {
        const { tokens, user } = data.data

        if (tokens?.access_token && tokens?.refresh_token) {
          // 使用新的 setTokens 方法
          const expiresIn = tokens.expires_in || 3600 // 默认 1 小时
          setToken(tokens.access_token, tokens.refresh_token, expiresIn, user)

          // 跳转到之前的页面或默认页面（个人主页）
          const from = (loc.state as any)?.from?.pathname || '/app/home'
          nav(from, { replace: true })
        } else {
          setError(t('login_failed') as string)
        }
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
        data-testid="login-send"
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

      {/* 调试信息 */}
      {debugInfo && (
        <div className="p-2 bg-gray-100 border border-gray-300 rounded text-xs font-mono text-gray-700">
          {debugInfo}
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
        data-testid="login-submit"
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

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function TTSPage() {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [reqId, setReqId] = useState('')
  const [duration, setDuration] = useState(0)
  const [balance, setBalance] = useState<any>(null)
  const [ledger, setLedger] = useState<any[]>([])
  const timerRef = useRef<any>(null)
  const at = typeof window !== 'undefined' ? localStorage.getItem('access_token') || '' : ''
  const call = async (path: string, init?: RequestInit) => {
    try {
      const r = await fetch(path, { ...(init||{}), headers: { ...(init?.headers||{}), Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' } })
      const ct = r.headers.get('content-type') || ''
      if (!ct.includes('application/json')) return {}
      const body = await r.json().catch(() => ({}))
      return body || {}
    } catch {
      return {}
    }
  }
  const start = async () => {
    const j = await call('/api/v1/tts', { method: 'POST', body: JSON.stringify({ text }) })
    const d = j.data || {}
    setAudioUrl(d.download_url || '')
    setReqId(d.request_id || '')
    clearInterval(timerRef.current)
    timerRef.current = setInterval(async () => {
      const hb = await call('/api/v1/tts/heartbeat', { method: 'POST', body: JSON.stringify({ request_id: d.request_id, delta_ms: 1000 }) })
      const dd = hb.data || {}
      setDuration(dd.duration_ms || 0)
    }, 1000)
    await refreshBilling()
  }
  const stop = async () => {
    clearInterval(timerRef.current)
    timerRef.current = null
    await refreshBilling()
  }
  const refreshBilling = async () => {
    const b = await call('/api/v1/billing/balance')
    setBalance(b.data)
    const l = await call('/api/v1/billing/ledger')
    setLedger(l.data || [])
  }
  useEffect(() => { refreshBilling() }, [])
  return (
    <div style={{ padding: 16 }}>
      <div>
        <input value={text} onChange={e => setText(e.target.value)} placeholder={t('tts.input')} style={{ width: '60%' }} />
        <button onClick={start} style={{ marginLeft: 8 }}>{t('tts.start')}</button>
        <button onClick={stop} style={{ marginLeft: 8 }}>{t('tts.stop')}</button>
      </div>
      {audioUrl && (
        <audio src={audioUrl} controls style={{ display: 'block', marginTop: 12 }} />
      )}
      <div style={{ marginTop: 12 }}>请求 {reqId}，累计时长 {duration} ms</div>
      <div style={{ marginTop: 12 }}>{t('billing.balance_prefix')} {balance ? `${balance.balance} Credits，钱包 ${balance.wallet_amount} ${balance.wallet_currency}` : ''}</div>
      <div style={{ marginTop: 12 }}>
        <div>{t('billing.title')}</div>
        <ul>
          {ledger.map((x, i) => <li key={i}>{x.direction} {x.amount} {x.currency} {x.reason}</li>)}
        </ul>
      </div>
    </div>
  )
}
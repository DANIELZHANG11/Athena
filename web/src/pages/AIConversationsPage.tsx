import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function AIConversationsPage() {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [out, setOut] = useState('')
  const esRef = useRef<EventSource | null>(null)
  useEffect(() => {
    return () => {
      esRef.current?.close()
    }
  }, [])
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24 }}>{t('ai.title')}</h1>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('ai.prompt')} style={{ width: 320, padding: 8 }} />
      <button style={{ marginLeft: 12 }} onClick={() => {
        esRef.current?.close()
        const token = localStorage.getItem('access_token') || ''
        const url = `/api/v1/ai/stream?prompt=${encodeURIComponent(text)}&access_token=${encodeURIComponent(token)}`
        const es = new EventSource(url)
        esRef.current = es
        setOut('')
        es.onmessage = (ev) => {
          const d = ev.data
          if (d === 'BEGIN') return
          if (d === 'END') { es.close(); return }
          setOut((prev) => prev + d)
        }
      }}>{t('ai.start')}</button>
      <div style={{ marginTop: 16, whiteSpace: 'pre-wrap' }}>{out}</div>
    </div>
  )
}
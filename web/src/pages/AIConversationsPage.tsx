import { useEffect, useRef, useState } from 'react'

export default function AIConversationsPage() {
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
      <h1 style={{ fontSize: 24 }}>AI 对话</h1>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="输入提示词" style={{ width: 320, padding: 8 }} />
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
      }}>开始</button>
      <div style={{ marginTop: 16, whiteSpace: 'pre-wrap' }}>{out}</div>
    </div>
  )
}
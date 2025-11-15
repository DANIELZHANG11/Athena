import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function DocEditor() {
  const { t } = useTranslation()
  const { docId } = useParams()
  const [content, setContent] = useState('')
  const [version, setVersion] = useState(0)
  const [conflicts, setConflicts] = useState<any[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  useEffect(() => {
    if (!docId) return
    const ws = new WebSocket(`ws://${location.host}/ws/docs/${docId}`)
    wsRef.current = ws
    ;(window as any).__sendDoc = (base: number, text: string) => {
      const sendNow = () => {
        if (!wsRef.current) return
        const payload = JSON.stringify({ base_version: base, content: text })
        wsRef.current.send(payload)
      }
      if (ws.readyState === WebSocket.OPEN) sendNow()
      else ws.addEventListener('open', sendNow, { once: true })
    }
    ws.onmessage = ev => {
      try {
        const obj = JSON.parse(ev.data)
        if (typeof obj.version === 'number') setVersion(obj.version)
        if (typeof obj.content === 'string') setContent(obj.content)
      } catch {
        setContent(ev.data)
      }
    }
    return () => { ws.close() }
  }, [docId])
  const send = () => {
    if (!wsRef.current) return
    const payload = JSON.stringify({ base_version: version, content })
    wsRef.current.send(payload)
  }
  const loadConflicts = async () => {
    if (!docId) return
    const at = localStorage.getItem('access_token') || ''
    const r = await fetch(`/api/v1/docs/${docId}/conflicts`, { headers: { Authorization: `Bearer ${at}` } })
    const j = await r.json()
    setConflicts(j.data || [])
  }
  const recoverDraft = async () => {
    if (!docId) return
    const at = localStorage.getItem('access_token') || ''
    const r = await fetch(`/api/v1/docs/${docId}/draft/recover`, { method: 'POST', headers: { Authorization: `Bearer ${at}` } })
    const j = await r.json()
    if (j.data && j.data.snapshot) setContent(j.data.snapshot)
  }
  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 8 }}>{t('doc.version')} {version}</div>
      <textarea value={content} onChange={e => setContent(e.target.value)} style={{ width: '100%', height: 300 }} />
      <div style={{ marginTop: 8 }}>
        <button onClick={send}>{t('doc.send')}</button>
        <button onClick={loadConflicts} style={{ marginLeft: 8 }}>{t('doc.conflicts')}</button>
        <button onClick={recoverDraft} style={{ marginLeft: 8 }}>{t('doc.recover')}</button>
      </div>
      {conflicts.length > 0 && (
        <div style={{ marginTop: 8 }}>{t('doc.conflicts')} {conflicts.length}</div>
      )}
    </div>
  )
}
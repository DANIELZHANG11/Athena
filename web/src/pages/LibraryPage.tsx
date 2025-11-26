import { useState } from 'react'
import BookCard from '../components/BookCard'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { useTranslation } from 'react-i18next'

export default function LibraryPage() {
  const { t } = useTranslation()
  const [show, setShow] = useState(false)
  const [fileName, setFileName] = useState('')
  const [fingerprint, setFingerprint] = useState('a-unique-simulated-hash-string')
  const [fileObj, setFileObj] = useState<File | null>(null)
  const [items, setItems] = useState<Array<{ id: string; title: string; downloadUrl?: string }>>([])
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="typography-large-title">{t('library.title')}</h1>
        <Button variant="default" onClick={() => setShow(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
          {t('upload.cta')}
        </Button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-md)', marginTop: 'var(--space-md)' }}>
        {items.map((it) => (
          <BookCard key={it.id} title={it.title} downloadUrl={it.downloadUrl} />
        ))}
      </div>
      {show && (
        <Modal>
          <div>
            <h2 style={{ fontSize: 18 }}>{t('upload.title')}</h2>
            <div style={{ marginTop: 'var(--space-sm)' }}>
              <div>{t('upload.filename')}</div>
              <Input value={fileName} onChange={(e) => setFileName(e.target.value)} />
            </div>
            <div style={{ marginTop: 'var(--space-sm)' }}>
              <div>{t('upload.fingerprint')}</div>
              <Input value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} />
            </div>
            <div style={{ marginTop: 'var(--space-sm)' }}>
              <div>{t('upload.pick_file')}</div>
              <input type="file" onChange={(e) => setFileObj(e.target.files?.[0] || null)} />
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
              <Button onClick={() => setShow(false)}>{t('common.cancel')}</Button>
              <Button variant="default"
                onClick={async () => {
                  const at = localStorage.getItem('access_token')
                  if (fileObj) {
                    const fd = new FormData()
                    fd.append('title', fileName.replace(/\.epub$/i, ''))
                    fd.append('file', fileObj)
                    const res = await fetch('/api/v1/books/upload_proxy', { method: 'POST', headers: { Authorization: `Bearer ${at}` }, body: fd })
                    const j = await res.json()
                    setItems((prev) => [{ id: j.data.id, title: fileName.replace(/\.epub$/i, ''), downloadUrl: j.data.download_url }, ...prev])
                  } else {
                    const initRes = await fetch('/api/v1/books/upload_init', { method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: fileName, file_fingerprint: fingerprint }) })
                    const init = await initRes.json()
                    const key = init.data.key
                    const url = init.data.upload_url
                    try { await fetch(url, { method: 'PUT', body: new Blob([]) }) } catch { /* ignore */ }
                    const compRes = await fetch('/api/v1/books/upload_complete', { method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ key, title: fileName.replace(/\.epub$/i, ''), original_format: 'epub', size: 0 }) })
                    const comp = await compRes.json()
                    setItems((prev) => [{ id: comp.data.id, title: fileName.replace(/\.epub$/i, ''), downloadUrl: comp.data.download_url }, ...prev])
                  }
                  setShow(false)
                }}
              >{t('upload.start')}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
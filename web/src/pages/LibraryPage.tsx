import { useState } from 'react'
import BookCard from '../components/BookCard'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'

export default function LibraryPage() {
  const [show, setShow] = useState(false)
  const [fileName, setFileName] = useState('纪德·道德三部曲.epub')
  const [fingerprint, setFingerprint] = useState('a-unique-simulated-hash-string')
  const [fileObj, setFileObj] = useState<File | null>(null)
  const [items, setItems] = useState<Array<{ id: string; title: string; downloadUrl?: string }>>([])
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="typography-large-title">我的书库</h1>
        <Button variant="primary" onClick={() => setShow(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
          上传书籍
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
            <h2 style={{ fontSize: 18 }}>上传书籍</h2>
            <div style={{ marginTop: 'var(--space-sm)' }}>
              <div>文件名</div>
              <Input value={fileName} onChange={(e) => setFileName(e.target.value)} />
            </div>
            <div style={{ marginTop: 'var(--space-sm)' }}>
              <div>指纹</div>
              <Input value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} />
            </div>
            <div style={{ marginTop: 'var(--space-sm)' }}>
              <div>选择本地文件</div>
              <input type="file" onChange={(e) => setFileObj(e.target.files?.[0] || null)} />
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
              <Button onClick={() => setShow(false)}>取消</Button>
              <Button variant="primary"
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
                    try { await fetch(url, { method: 'PUT', body: new Blob([]) }) } catch {}
                    const compRes = await fetch('/api/v1/books/upload_complete', { method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ key, title: fileName.replace(/\.epub$/i, ''), original_format: 'epub', size: 0 }) })
                    const comp = await compRes.json()
                    setItems((prev) => [{ id: comp.data.id, title: fileName.replace(/\.epub$/i, ''), downloadUrl: comp.data.download_url }, ...prev])
                  }
                  setShow(false)
                }}
              >开始上传</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
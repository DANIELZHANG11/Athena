import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BookCard from '../components/BookCard'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import Modal from '../components/ui/Modal'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth'
import api from '@/lib/api'

export default function LibraryPage() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const [show, setShow] = useState(false)
  const [fileName, setFileName] = useState('')
  const [fingerprint, setFingerprint] = useState('a-unique-simulated-hash-string')
  const [fileObj, setFileObj] = useState<File | null>(null)
  const [items, setItems] = useState<Array<{ id: string; title: string; downloadUrl?: string }>>([])
  const [status, setStatus] = useState('')

  useEffect(() => {
    const fetchList = async () => {
      try {
        console.log('[LibraryPage] Fetching books list...')
        const response = await api.get('/books')
        console.log('[LibraryPage] Books response:', response.data)
        const list = (response.data?.data?.items || []).map((x: any) => ({
          id: x.id,
          title: x.title || 'Untitled',
          downloadUrl: undefined
        }))
        setItems(list)
        console.log('[LibraryPage] Loaded', list.length, 'books')
      } catch (error) {
        console.error('[LibraryPage] Failed to fetch books:', error)
      }
    }
    fetchList()
    const onUploaded = () => fetchList()
    window.addEventListener('book_uploaded', onUploaded as any)
    return () => { window.removeEventListener('book_uploaded', onUploaded as any) }
  }, [])

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
          <BookCard
            key={it.id}
            title={it.title}
            downloadUrl={it.downloadUrl}
            onClick={() => navigate(`/app/read/${it.id}`)}
          />
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
              {status && <div style={{ marginTop: 8 }} className="text-secondary-label text-xs">{status}</div>}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
              <Button onClick={() => setShow(false)}>{t('common.cancel')}</Button>
              <Button variant="default"
                onClick={async () => {
                  if (fileObj) {
                    try {
                      const data = await (await import('@/hooks/useBookUpload')).useBookUpload().start(fileObj, fileName.replace(/\.epub$/i, ''))
                      if (data?.id) {
                        setItems((prev) => [{ id: data.id, title: fileName.replace(/\.epub$/i, ''), downloadUrl: data.download_url }, ...prev])
                        window.dispatchEvent(new CustomEvent('book_uploaded', { detail: data }))
                        setShow(false)
                      } else {
                        setStatus(t('login.send_fail') as string)
                      }
                    } catch (error) {
                      console.error('[LibraryPage] Upload failed:', error)
                      setStatus(t('login.send_fail') as string)
                    }
                  } else {
                    try {
                      const initRes = await api.post('/ books/upload_init', { filename: fileName, file_fingerprint: fingerprint })
                      const key = initRes.data.data.key
                      const url = initRes.data.data.upload_url

                      const put = await fetch(url, { method: 'PUT', body: new Blob([]) })
                      if (!put.ok) { setStatus(t('login.send_fail') as string); return }

                      const compRes = await api.post('/books/upload_complete', {
                        key,
                        title: fileName.replace(/\.epub$/i, ''),
                        original_format: 'epub',
                        size: 0
                      })

                      if (compRes.data?.data?.id) {
                        setItems((prev) => [{ id: compRes.data.data.id, title: fileName.replace(/\.epub$/i, ''), downloadUrl: compRes.data.data.download_url }, ...prev])
                        window.dispatchEvent(new CustomEvent('book_uploaded', { detail: compRes.data.data }))
                        setShow(false)
                      } else {
                        setStatus(t('login.send_fail') as string)
                      }
                    } catch (error) {
                      console.error('[LibraryPage] Upload failed:', error)
                      setStatus(t('login.send_fail') as string)
                    }
                  }
                }}
              >{t('upload.start')}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

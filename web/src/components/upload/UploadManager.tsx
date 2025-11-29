import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBookUpload } from '../../hooks/useBookUpload'
import { useTranslation } from 'react-i18next'

export default function UploadManager() {
  const { t } = useTranslation('common')
  const inputRef = useRef<HTMLInputElement>(null)
  const { start } = useBookUpload()
  const nav = useNavigate()
  const [progressText, setProgressText] = useState('')
  const onPick = () => inputRef.current?.click()
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return

    setProgressText(t('upload.uploading'))

    try {
      const data = await start(f)
      setProgressText(t('upload.success'))
      try {
        window.dispatchEvent(new CustomEvent('book_uploaded', { detail: data }))
      } catch { }
      // Navigate after a short delay to show success message
      setTimeout(() => nav('/app/library'), 1000)
    } catch (e: any) {
      const errorKey = e.message && e.message.startsWith('upload.error.')
        ? e.message
        : 'upload.error.unknown'
      setProgressText(t(errorKey))
      console.error('upload_failed', e)
    }
  }
  return (
    <div className="flex items-center gap-2">
      <button onClick={onPick} className="rounded-full px-3 py-1 text-xs" style={{ background: 'var(--system-blue)', color: '#fff' }}>{t('upload.cta')}</button>
      <input ref={inputRef} type="file" className="hidden" onChange={onFile} />
      {progressText && <span className="text-secondary-label text-xs">{progressText}</span>}
    </div>
  )
}

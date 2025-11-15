import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
export default function ExportPage() {
  const { t } = useTranslation()
  const [jobs, setJobs] = useState<any[]>([])
  const [link, setLink] = useState<string>('')
  useEffect(() => {
    const token = localStorage.getItem('access_token') || ''
    fetch('/api/v1/ocr/jobs', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setJobs(d.data || []))
  }, [])
  const doExport = async (jobId: string, fmt: string) => {
    const token = localStorage.getItem('access_token') || ''
    const r = await fetch(`/api/v1/export/ocr/${jobId}?format=${fmt}`, { headers: { Authorization: `Bearer ${token}` } })
    const j = await r.json()
    setLink(j?.data?.download_url || '')
  }
  return (
    <div style={{ padding: 24 }}>
      <h1>{t('export.title')}</h1>
      <div>
        {jobs.map((j: any) => (
          <div key={j.id} style={{ marginBottom: 8 }}>
            <span>{j.id}</span>
            <button onClick={() => doExport(j.id, 'txt')} style={{ marginLeft: 8 }}>{t('export.txt')}</button>
            <button onClick={() => doExport(j.id, 'md')} style={{ marginLeft: 8 }}>{t('export.md')}</button>
            <button onClick={() => doExport(j.id, 'pdf')} style={{ marginLeft: 8 }}>{t('export.pdf')}</button>
          </div>
        ))}
      </div>
      {link && <a href={link} target="_blank" rel="noreferrer">{t('export.download_link')}</a>}
    </div>
  )
}
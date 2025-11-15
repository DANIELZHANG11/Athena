import { useEffect, useState } from 'react'
export default function ExportPage() {
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
      <h1>导出服务</h1>
      <div>
        {jobs.map((j: any) => (
          <div key={j.id} style={{ marginBottom: 8 }}>
            <span>{j.id}</span>
            <button onClick={() => doExport(j.id, 'txt')} style={{ marginLeft: 8 }}>导出TXT</button>
            <button onClick={() => doExport(j.id, 'md')} style={{ marginLeft: 8 }}>导出MD</button>
            <button onClick={() => doExport(j.id, 'pdf')} style={{ marginLeft: 8 }}>导出PDF</button>
          </div>
        ))}
      </div>
      {link && <a href={link} target="_blank" rel="noreferrer">下载链接</a>}
    </div>
  )
}
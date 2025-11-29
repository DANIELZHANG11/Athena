import { useAuthStore } from '@/stores/auth'

export function useBookUpload() {
  const computeSha256 = async (file: File) => {
    const buf = await file.arrayBuffer()
    const hashBuf = await crypto.subtle.digest('SHA-256', buf)
    const hashArr = Array.from(new Uint8Array(hashBuf))
    return hashArr.map(b => b.toString(16).padStart(2, '0')).join('')
  }
  const start = async (file: File, title?: string) => {
    const at = useAuthStore.getState().accessToken || (typeof window !== 'undefined' ? localStorage.getItem('access_token') || '' : '')
    const fp = await computeSha256(file)

    try {
      const initRes = await fetch('/api/v1/books/upload_init', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${at}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filename: file.name,
          file_fingerprint: fp,
          content_type: file.type || 'application/octet-stream'
        })
      })

      if (!initRes.ok) {
        if (initRes.status === 403) {
          const errorData = await initRes.json().catch(() => ({}))
          if (errorData.detail === 'upload_forbidden_quota_exceeded') {
            throw new Error('upload.error.quota_exceeded')
          }
        }
        throw new Error('upload.error.init_failed')
      }

      const init = await initRes.json()
      const key = init.data.key
      let url = init.data.upload_url as string

      try {
        const u = new URL(url)
        if (u.hostname.includes('seaweed')) {
          url = `/s3${u.pathname}${u.search}`
        }
      } catch { }

      const putRes = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file
      })

      if (!putRes.ok) {
        throw new Error('upload.error.put_failed')
      }

      const fmt = file.name.split('.').pop()?.toLowerCase() || ''
      const compRes = await fetch('/api/v1/books/upload_complete', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${at}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          key,
          title: title || file.name.replace(/\.[^/.]+$/, ''),
          original_format: fmt,
          size: file.size
        })
      })

      if (!compRes.ok) {
        throw new Error('upload.error.complete_failed')
      }

      const comp = await compRes.json()
      return comp.data

    } catch (error: any) {
      // Rethrow with i18n key if already formatted, otherwise use unknown
      if (error.message && error.message.startsWith('upload.error.')) {
        throw error
      }
      throw new Error('upload.error.unknown')
    }
  }
  return { start }
}

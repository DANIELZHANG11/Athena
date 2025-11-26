import { useState } from 'react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { useTranslation } from 'react-i18next'

export default function ProfilePage() {
  const { t } = useTranslation()
  const [profile, setProfile] = useState<any>(null)
  const [etag, setEtag] = useState<string>('W/"1"')
  const [displayName, setDisplayName] = useState('')
  return (
    <div>
      <h1 className="typography-large-title">{t('profile.title')}</h1>
      <div style={{ marginTop: 'var(--space-sm)' }}>
        <Button
          onClick={async () => {
            const at = localStorage.getItem('access_token')
            const res = await fetch('/api/v1/profile/me', { headers: { Authorization: `Bearer ${at}` } })
            const j = await res.json()
            setProfile(j.data)
            setEtag(j.data.etag || 'W/"1"')
            setDisplayName(j.data.display_name || '')
          }}
        >{t('profile.get')}</Button>
      </div>
      {profile && (
        <div style={{ marginTop: 'var(--space-sm)', display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
          <span>{t('profile.name')}</span>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={{ width: 240 }} />
          <Button
            onClick={async () => {
              const at = localStorage.getItem('access_token')
              await fetch('/api/v1/profile/me', { method: 'PATCH', headers: { Authorization: `Bearer ${at}`, 'If-Match': etag, 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: displayName }) })
              const res = await fetch('/api/v1/profile/me', { headers: { Authorization: `Bearer ${at}` } })
              const j = await res.json()
              setProfile(j.data)
              setDisplayName(j.data.display_name || '')
            }}
          >{t('profile.save')}</Button>
        </div>
      )}
    </div>
  )
}
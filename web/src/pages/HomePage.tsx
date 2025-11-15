import { useTranslation } from 'react-i18next'

export default function HomePage() {
  const { t } = useTranslation()
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24 }}>{t('homepage.title')}</h1>
    </div>
  )
}
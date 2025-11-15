import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import HttpBackend from 'i18next-http-backend'
import en from './locales/en/common.json'
import zh from './locales/zh-CN/common.json'
const base = (import.meta.env.VITE_LOCALES_BASE_URL as string) || '/locales'
const storedLng = typeof window !== 'undefined' ? (localStorage.getItem('i18nextLng') as string) : undefined
i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    resources: { 'en-US': { common: en }, 'zh-CN': { common: zh } },
    lng: storedLng || 'zh-CN',
    fallbackLng: 'en-US',
    supportedLngs: ['en-US', 'zh-CN'],
    ns: ['common'],
    defaultNS: 'common',
    backend: { loadPath: `${base}/{{lng}}/{{ns}}.json` },
    interpolation: { escapeValue: false }
  })
export default i18n

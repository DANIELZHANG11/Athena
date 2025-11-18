import React from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import './styles/figma.css'
import App from './App'
import { registerSW } from 'virtual:pwa-register'
if (typeof window !== 'undefined' && !('Cypress' in window) && !import.meta.env.VITE_DISABLE_PWA) {
  registerSW({ immediate: true })
}
const el = document.getElementById('root')
if (el) {
  createRoot(el).render(<App />)
}

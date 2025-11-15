import React from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import App from './App'
import { registerSW } from 'virtual:pwa-register'
registerSW({ immediate: true })
const el = document.getElementById('root')
if (el) {
  createRoot(el).render(<App />)
}

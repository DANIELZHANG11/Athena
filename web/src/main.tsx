/**
 * 应用启动入口
 *
 * 说明：
 * - 初始化国际化与全局样式
 * - 可选注册 PWA 服务工作线程（Service Worker，测试环境/Cypress 禁用）
 * - 使用 React 18 `createRoot` 挂载应用
 */

// ⚠️ Web Locks Polyfill 必须最先加载，在任何 PowerSync 代码之前
import { installWebLocksPolyfill } from './lib/webLocksPolyfill'
installWebLocksPolyfill()

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

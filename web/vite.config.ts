/**
 * Vite 构建配置
 * - React 插件与 PWA 集成
 * - `@` 别名指向 `src`
 * - 本地开发代理 `/api` 与 `/s3`
 */
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Athena',
        short_name: 'Athena',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff'
      },
      workbox: { globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'] }
    }),
  ],
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) }
    ]
  },
  server: {
    host: true,
    hmr: { protocol: 'ws' },
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL || 'http://localhost:8000',
        changeOrigin: true,
        ws: true
      },
      // Tolgee 代理暂时禁用 - 待开发完成后恢复
      // '/tolgee-api': {
      //   target: 'http://localhost:8085',
      //   changeOrigin: true,
      //   rewrite: (path) => path.replace(/^\/tolgee-api/, '')
      // },
      '/s3': {
        target: 'http://localhost:8333',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/s3/, '')
      }
    }
  }
})

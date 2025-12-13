/**
 * Vite 构建配置
 * - React 插件与 PWA 集成
 * - `@` 别名指向 `src`
 * - 本地开发代理 `/api` 与 `/s3`
 * - 【离线优先】自定义 Service Worker 配置
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
      // 【离线优先】使用自定义 Service Worker
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: 'auto',
      manifest: {
        name: '雅典娜阅读器',
        short_name: 'Athena',
        description: '智能阅读 · 离线优先的电子书阅读器',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#4f46e5',
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        categories: ['books', 'education', 'productivity'],
        shortcuts: [
          {
            name: '我的书库',
            short_name: '书库',
            url: '/library',
            icons: [{ src: '/icons/library-96x96.png', sizes: '96x96' }],
          },
          {
            name: '继续阅读',
            short_name: '阅读',
            url: '/reader/last',
            icons: [{ src: '/icons/reader-96x96.png', sizes: '96x96' }],
          },
        ],
      },
      // Workbox 配置（用于 injectManifest 模式）
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
      },
      devOptions: {
        enabled: true, // 开发模式下启用 PWA
        type: 'module',
      },
    }),
  ],
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) }
    ]
  },
  worker: {
    format: 'es',
    plugins: () => [react()],
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          'powersync': ['@powersync/web', '@powersync/react'],
          'sqlite': ['@journeyapps/wa-sqlite'],
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@journeyapps/wa-sqlite', '@powersync/web'],
    esbuildOptions: {
      target: 'esnext',
    },
  },
  server: {
    port: 48173,
    host: true,
    hmr: { protocol: 'ws' },
    proxy: {
      '/api': {
        target: 'http://localhost:48000',
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
        target: 'http://localhost:48333',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/s3/, '')
      }
    }
  }
})

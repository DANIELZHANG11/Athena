/**
 * sw.ts - 自定义 Service Worker
 * 
 * 缓存策略:
 * - 静态资源: CacheFirst（长期缓存）
 * - API 请求: NetworkFirst（优先网络，失败回退缓存）
 * - 图片资源: CacheFirst + 过期清理
 * - 书籍内容: CacheOnly（离线阅读核心）
 * 
 * @see App-First改造计划.md - Phase 4.1
 */

/// <reference lib="webworker" />

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import {
  CacheFirst,
  NetworkFirst,
  StaleWhileRevalidate,
  NetworkOnly,
} from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
// BackgroundSyncPlugin 已移除 - PowerSync 负责所有数据同步

declare const self: ServiceWorkerGlobalScope

// 版本号（用于缓存命名空间）
// 每次重大更改时递增版本号以强制缓存刷新
const SW_VERSION = '1.2.0'

// 缓存名称
const CACHE_NAMES = {
  static: `athena-static-v${SW_VERSION}`,
  api: `athena-api-v${SW_VERSION}`,
  images: `athena-images-v${SW_VERSION}`,
  books: `athena-books-v${SW_VERSION}`,
}

// Precache manifest (由 vite-plugin-pwa 自动注入)
precacheAndRoute(self.__WB_MANIFEST)

// 清理旧版本缓存
cleanupOutdatedCaches()

// =====================
// 静态资源缓存策略
// =====================

// JS/CSS 文件 - CacheFirst
registerRoute(
  ({ request }) =>
    request.destination === 'script' ||
    request.destination === 'style',
  new CacheFirst({
    cacheName: CACHE_NAMES.static,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 天
      }),
    ],
  })
)

// 字体文件 - CacheFirst
registerRoute(
  ({ request }) => request.destination === 'font',
  new CacheFirst({
    cacheName: CACHE_NAMES.static,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 365 * 24 * 60 * 60, // 1 年
      }),
    ],
  })
)

// =====================
// 图片缓存策略
// =====================

/**
 * 图片缓存策略
 * 
 * ⚠️ CORS 注意事项：
 * - 跨域图片（如 S3）如果没有正确的 CORS 头，会返回 Opaque Response (status=0)
 * - Opaque Response 会占用大量配额（浏览器按 ~7MB/张计算）
 * - 确保 S3 配置了 Access-Control-Allow-Origin: * 
 * - 或在 <img> 标签使用 crossorigin="anonymous"
 * 
 * 当前策略：
 * - 只缓存 status=200 的透明响应，跳过 opaque response (status=0)
 * - 这样可以避免配额爆满，但离线时跨域图片可能不可用
 */

// 同源图片（封面、本地图片）- CacheFirst
registerRoute(
  ({ request, url }) => {
    const isImage = request.destination === 'image' ||
      url.pathname.includes('/covers/') ||
      url.pathname.includes('/images/')
    // 只缓存同源图片，避免跨域 opaque response 问题
    const isSameOrigin = url.origin === self.location.origin
    return isImage && isSameOrigin
  },
  new CacheFirst({
    cacheName: CACHE_NAMES.images,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [200], // 只缓存成功的透明响应，不缓存 opaque (0)
      }),
      new ExpirationPlugin({
        maxEntries: 500,
        maxAgeSeconds: 7 * 24 * 60 * 60, // 7 天
        purgeOnQuotaError: true, // 存储空间不足时自动清理
      }),
    ],
  })
)

// 跨域图片（S3 等）- StaleWhileRevalidate + 严格过滤
registerRoute(
  ({ request, url }) => {
    const isImage = request.destination === 'image'
    const isCrossOrigin = url.origin !== self.location.origin
    // 只处理已知的可信域名（如你的 S3 bucket）
    const isTrustedCDN = url.hostname.includes('amazonaws.com') ||
      url.hostname.includes('cloudfront.net') ||
      url.hostname.includes('supabase')
    return isImage && isCrossOrigin && isTrustedCDN
  },
  new StaleWhileRevalidate({
    cacheName: CACHE_NAMES.images,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [200], // 严格只缓存透明响应
      }),
      new ExpirationPlugin({
        maxEntries: 200, // 跨域图片限制更少
        maxAgeSeconds: 3 * 24 * 60 * 60, // 3 天
        purgeOnQuotaError: true,
      }),
    ],
  })
)

// =====================
// API 缓存策略
// =====================

// 用户资料 - NetworkFirst（离线时显示缓存）
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/v1/profile'),
  new NetworkFirst({
    cacheName: CACHE_NAMES.api,
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 7 * 24 * 60 * 60, // 7 天
      }),
    ],
  })
)

// AI 对话列表 - NetworkFirst（离线时显示缓存）
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/v1/ai/conversations'),
  new NetworkFirst({
    cacheName: CACHE_NAMES.api,
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 7 * 24 * 60 * 60, // 7 天
      }),
    ],
  })
)

// 首页数据 - NetworkFirst
registerRoute(
  ({ url }) =>
    url.pathname.startsWith('/api/v1/home') ||
    url.pathname.startsWith('/api/v1/dashboard'),
  new NetworkFirst({
    cacheName: CACHE_NAMES.api,
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 24 * 60 * 60, // 1 天
      }),
    ],
  })
)

// 书籍列表 - NetworkFirst（/api/v1/books 不带后续路径）
registerRoute(
  ({ url, request }) => {
    // 只匹配 GET 请求的书籍列表
    if (request.method !== 'GET') return false
    // 精确匹配 /api/v1/books 或 /api/v1/books?...
    return url.pathname === '/api/v1/books' ||
      url.pathname.startsWith('/api/v1/library')
  },
  new NetworkFirst({
    cacheName: CACHE_NAMES.api,
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 24 * 60 * 60, // 1 天
      }),
    ],
  })
)

// 单本书籍元数据 - NetworkFirst（/api/v1/books/{id}）
// 用于阅读器初始化时获取书籍信息
registerRoute(
  ({ url, request }) => {
    if (request.method !== 'GET') return false
    // 匹配 /api/v1/books/{uuid} 格式（不包含 /cover, /content, /download 等子路径）
    const match = url.pathname.match(/^\/api\/v1\/books\/[a-f0-9-]+$/)
    return !!match
  },
  new NetworkFirst({
    cacheName: CACHE_NAMES.api,
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 7 * 24 * 60 * 60, // 7 天
      }),
    ],
  })
)

// 书籍封面 - CacheFirst（/api/v1/books/{id}/cover）
registerRoute(
  ({ url, request }) => {
    if (request.method !== 'GET') return false
    return url.pathname.match(/^\/api\/v1\/books\/[a-f0-9-]+\/cover/) !== null
  },
  new CacheFirst({
    cacheName: CACHE_NAMES.images,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 天
        purgeOnQuotaError: true,
      }),
    ],
  })
)

// 阅读进度 - StaleWhileRevalidate
registerRoute(
  ({ url }) => url.pathname.includes('/reading-progress'),
  new StaleWhileRevalidate({
    cacheName: CACHE_NAMES.api,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  })
)


// 认证相关 - NetworkOnly（不缓存）
registerRoute(
  ({ url }) =>
    url.pathname.startsWith('/api/auth') ||
    url.pathname.startsWith('/api/login') ||
    url.pathname.startsWith('/api/logout'),
  new NetworkOnly()
)

// =====================
// 书籍内容缓存策略
// =====================

// 书籍内容（EPUB/PDF 等）- CacheFirst（离线阅读核心）
registerRoute(
  ({ url }) =>
    url.pathname.match(/^\/api\/v1\/books\/[a-f0-9-]+\/(content|download)/) !== null,
  new CacheFirst({
    cacheName: CACHE_NAMES.books,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 50, // 最多缓存 50 本书
        maxAgeSeconds: 90 * 24 * 60 * 60, // 90 天
        purgeOnQuotaError: true,
      }),
    ],
  })
)

// =====================
// Service Worker 生命周期
// =====================

// 安装事件
self.addEventListener('install', () => {
  console.log('[SW] Installing version:', SW_VERSION)
  // 立即激活，不等待旧 SW 关闭
  self.skipWaiting()
})

// 激活事件
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating version:', SW_VERSION)

  // 清理旧版本缓存
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => {
            // 删除不在当前版本缓存列表中的缓存
            return !Object.values(CACHE_NAMES).includes(cacheName) &&
              cacheName.startsWith('athena-')
          })
          .map((cacheName) => {
            console.log('[SW] Deleting old cache:', cacheName)
            return caches.delete(cacheName)
          })
      )
    })
  )

  // 立即控制所有客户端
  self.clients.claim()
})

// 消息处理
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Skip waiting requested')
    self.skipWaiting()
  }

  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: SW_VERSION })
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    const { cacheName } = event.data
    if (cacheName && CACHE_NAMES[cacheName as keyof typeof CACHE_NAMES]) {
      caches.delete(CACHE_NAMES[cacheName as keyof typeof CACHE_NAMES])
        .then(() => {
          console.log('[SW] Cache cleared:', cacheName)
          event.ports[0]?.postMessage({ success: true })
        })
    }
  }
})

// 推送通知（预留）
self.addEventListener('push', (event) => {
  if (!event.data) return

  const data = event.data.json()
  console.log('[SW] Push received:', data)

  event.waitUntil(
    self.registration.showNotification(data.title || '雅典娜', {
      body: data.body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      tag: data.tag || 'athena-notification',
      data: data.data,
    })
  )
})

// 通知点击
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.notification.tag)
  event.notification.close()

  const urlToOpen = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // 如果已有窗口打开，聚焦它
        for (const client of clientList) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus()
          }
        }
        // 否则打开新窗口
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen)
        }
      })
  )
})

console.log('[SW] Service Worker loaded, version:', SW_VERSION)

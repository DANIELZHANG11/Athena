/**
 * Vitest 全局 Setup 文件
 * 
 * 为测试环境提供必要的 polyfills：
 * - fake-indexeddb：为 jsdom 环境提供 IndexedDB API
 */
import 'fake-indexeddb/auto'

// 可选：重置 Dexie 状态（避免测试间互相影响）
// 注意：Dexie 实例需要在每个测试中独立管理

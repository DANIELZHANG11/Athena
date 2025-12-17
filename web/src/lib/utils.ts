import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 生成 UUID v4
 * 兼容旧浏览器（fallback 到 Math.random）
 */
export function generateUUID(): string {
  // 优先使用 crypto.randomUUID (现代浏览器)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  
  // Fallback: 使用 crypto.getRandomValues (更安全)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  
  // 最后 fallback: Math.random (不推荐，仅用于极端情况)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

// 格式化文件大小
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// 格式化时间（分钟）
export function formatMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}min`
  }
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`
}

// 设备 ID 管理 (用于多端同步)
const DEVICE_ID_KEY = 'athena_device_id'

/**
 * 获取或生成设备 ID
 * 用于多端同步场景下的设备识别
 */
export function getDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY)
  if (!deviceId) {
    // 生成新的设备 ID: 浏览器指纹 + 随机数
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 10)
    const userAgent = navigator.userAgent.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '')
    deviceId = `web_${userAgent}_${timestamp}_${random}`.substring(0, 64)
    localStorage.setItem(DEVICE_ID_KEY, deviceId)
  }
  return deviceId
}

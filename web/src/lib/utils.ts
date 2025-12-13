import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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

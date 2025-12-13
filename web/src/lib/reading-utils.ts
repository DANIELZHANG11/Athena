/**
 * 阅读相关工具函数
 */

/**
 * 解析 EPUB 位置 (CFI)
 */
export function parseEpubLocation(location: any): string | null {
  if (!location) return null
  
  if (typeof location === 'string') {
    // 简单的 CFI 格式检查
    if (location.startsWith('epubcfi(')) {
      return location
    }
    // 尝试 JSON 解析
    try {
      const parsed = JSON.parse(location)
      if (typeof parsed === 'string' && parsed.startsWith('epubcfi(')) {
        return parsed
      }
    } catch {
      // 忽略解析错误
    }
  }
  
  return null
}

/**
 * 解析 PDF 位置 (页码)
 */
export function parsePdfLocation(location: any): { page: number } | null {
  if (!location) return null
  
  try {
    // 如果是数字
    if (typeof location === 'number') {
      return { page: location }
    }
    
    // 如果是对象
    if (typeof location === 'object') {
      // 兼容 { page: 1 } 格式
      if (typeof location.page === 'number') {
        return { page: location.page }
      }
      // 兼容 Dexie 存储的格式
      const obj = location as any
      if (obj.page && typeof obj.page === 'number') {
        return { page: obj.page }
      }
      return null
    }
    
    // 如果是字符串
    if (typeof location === 'string') {
      try {
        const parsed = JSON.parse(location)
        if (typeof parsed.page === 'number') {
          return { page: parsed.page }
        }
      } catch {
        // 尝试直接解析数字
        const page = parseInt(location, 10)
        if (!isNaN(page)) {
          return { page }
        }
      }
    }
  } catch (e) {
    console.error('[parsePdfLocation] Error:', e)
  }
  
  return null
}

/**
 * 格式化阅读进度为百分比字符串
 */
export function formatProgress(progress: number): string {
  return `${Math.round(progress * 100)}%`
}

/**
 * 格式化阅读时间
 */
export function formatReadingTime(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  
  if (hours > 0) {
    return `${hours}小时${remainingMinutes}分钟`
  }
  return `${minutes}分钟`
}

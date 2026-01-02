
/**
 * 从图片 URL 提取主色调
 * 使用 canvas 采样中心区域的平均颜色
 */

// Fallback 色 - 使用 CSS 变量定义的色值
const FALLBACK_GRAY = getComputedStyle(document.documentElement).getPropertyValue('--color-fallback-gray').trim() || '#6B7280'

export function extractDominantColor(imageUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    // 对于同源 API 请求（如 /api/...），不设置 crossOrigin
    // 只对外部 URL（如 S3 预签名 URL）设置 crossOrigin
    if (!imageUrl.startsWith('/api/') && !imageUrl.startsWith(window.location.origin)) {
      img.crossOrigin = 'anonymous'
    }

    const timeoutId = setTimeout(() => {
      // console.log('[ColorExtract] Timeout for:', imageUrl)
      resolve(FALLBACK_GRAY)
    }, 3000)

    img.onload = () => {
      clearTimeout(timeoutId)
      try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(FALLBACK_GRAY)
          return
        }

        // 使用小尺寸采样以提高性能
        canvas.width = 50
        canvas.height = 75
        ctx.drawImage(img, 0, 0, 50, 75)

        // 采样图片中心区域
        const imageData = ctx.getImageData(10, 20, 30, 35)
        const data = imageData.data

        let r = 0, g = 0, b = 0, count = 0
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          count++
        }

        r = Math.round(r / count)
        g = Math.round(g / count)
        b = Math.round(b / count)

        resolve(`rgb(${r}, ${g}, ${b})`)
      } catch (e) {
        console.warn('[ColorExtract] Canvas error:', e)
        resolve(FALLBACK_GRAY)
      }
    }
    img.onerror = (e) => {
      clearTimeout(timeoutId)
      console.warn('[ColorExtract] Image load error:', e)
      resolve(FALLBACK_GRAY)
    }
    img.src = imageUrl
  })
}

/**
 * 计算颜色亮度 (0-1)
 * 用于决定文字颜色
 */
export function getLuminance(color: string): number {
  try {
    // 解析 rgb(r, g, b) 格式
    const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
    if (match) {
      const r = parseInt(match[1]) / 255
      const g = parseInt(match[2]) / 255
      const b = parseInt(match[3]) / 255
      return 0.299 * r + 0.587 * g + 0.114 * b
    }
    // 解析 hex 格式
    const hex = color.replace('#', '')
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16) / 255
      const g = parseInt(hex.slice(2, 4), 16) / 255
      const b = parseInt(hex.slice(4, 6), 16) / 255
      return 0.299 * r + 0.587 * g + 0.114 * b
    }
  } catch {
    // Invalid hex color, return default
  }
  return 0.5
}

/**
 * useOcrData - Hook for managing OCR data (download, cache, and access)
 * 
 * 设计理念：
 * - 一次性下载完整 OCR 数据（约 2MB gzip 压缩）
 * - 存储到 IndexedDB，与书籍文件一起缓存
 * - 本地读取，零服务器请求
 * - 支持离线阅读
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthStore } from '@/stores/auth'
import { 
  getOcrData, 
  saveOcrData, 
  getOcrPageRegions,
  type OcrDataRecord,
  type OcrRegion,
  type OcrPageSize
} from '@/lib/bookStorage'

export type { OcrRegion, OcrPageSize }

export interface OcrDataStatus {
  /** OCR 数据是否可用（服务端已完成 OCR） */
  available: boolean
  /** 是否已缓存到本地 */
  cached: boolean
  /** 是否正在下载 */
  downloading: boolean
  /** 下载进度 (0-100) */
  progress: number
  /** 错误信息 */
  error: string | null
}

export interface OcrDataInfo {
  isImageBased: boolean
  confidence: number
  totalPages: number
  totalChars: number
  totalRegions: number
  imageWidth: number
  imageHeight: number
}

interface UseOcrDataOptions {
  bookId: string
  /** 是否自动下载（如果本地没有缓存） */
  autoDownload?: boolean
}

interface UseOcrDataResult {
  status: OcrDataStatus
  info: OcrDataInfo | null
  /** 下载 OCR 数据到本地 */
  download: () => Promise<boolean>
  /** 获取指定页的 OCR 区域 */
  getPageRegions: (page: number) => Promise<OcrRegion[]>
  /** 同步获取指定页的 OCR 区域（从内存缓存） */
  getPageRegionsSync: (page: number) => OcrRegion[]
  /** 同步获取指定页的 OCR 图片尺寸（从内存缓存） */
  getPageSizeSync: (page: number) => OcrPageSize | null
  /** 刷新状态 */
  refresh: () => Promise<void>
}

// 内存缓存，避免重复从 IndexedDB 读取
const memoryCache = new Map<string, OcrDataRecord>()

export function useOcrData({
  bookId,
  autoDownload = false,
}: UseOcrDataOptions): UseOcrDataResult {
  const [status, setStatus] = useState<OcrDataStatus>({
    available: false,
    cached: false,
    downloading: false,
    progress: 0,
    error: null,
  })
  const [info, setInfo] = useState<OcrDataInfo | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const isMountedRef = useRef(true)
  const downloadingRef = useRef(false)  // 用于稳定的下载状态检查
  const accessToken = useAuthStore((s) => s.accessToken)

  // 检查本地缓存状态
  const checkLocalCache = useCallback(async () => {
    if (!bookId) return false
    
    try {
      // 先检查内存缓存
      if (memoryCache.has(bookId)) {
        const cached = memoryCache.get(bookId)!
        // 检查是否有 pageSizes（新版数据），如果没有则需要重新下载
        if (!cached.pageSizes) {
          console.log('[useOcrData] Local cache missing pageSizes, needs re-download')
          memoryCache.delete(bookId)
          return false
        }
        if (isMountedRef.current) {
          setInfo({
            isImageBased: cached.isImageBased,
            confidence: cached.confidence,
            totalPages: cached.totalPages,
            totalChars: cached.totalChars,
            totalRegions: cached.totalRegions,
            imageWidth: cached.imageWidth,
            imageHeight: cached.imageHeight,
          })
          setStatus(prev => ({ ...prev, cached: true, available: true }))
        }
        return true
      }
      
      // 检查 IndexedDB
      const ocrData = await getOcrData(bookId)
      if (ocrData) {
        // 检查是否有 pageSizes（新版数据），如果没有则需要重新下载
        if (!ocrData.pageSizes) {
          console.log('[useOcrData] IndexedDB cache missing pageSizes, needs re-download')
          return false
        }
        memoryCache.set(bookId, ocrData)
        if (isMountedRef.current) {
          setInfo({
            isImageBased: ocrData.isImageBased,
            confidence: ocrData.confidence,
            totalPages: ocrData.totalPages,
            totalChars: ocrData.totalChars,
            totalRegions: ocrData.totalRegions,
            imageWidth: ocrData.imageWidth,
            imageHeight: ocrData.imageHeight,
          })
          setStatus(prev => ({ ...prev, cached: true, available: true }))
        }
        return true
      }
      return false
    } catch (e) {
      console.error('[useOcrData] Failed to check local cache:', e)
      return false
    }
  }, [bookId])

  // 检查服务端是否有 OCR 数据
  const checkServerAvailability = useCallback(async () => {
    if (!bookId || !accessToken) {
      console.log('[useOcrData] checkServerAvailability skipped: no bookId or accessToken')
      return false
    }
    
    try {
      console.log(`[useOcrData] Checking server availability for ${bookId}...`)
      const resp = await fetch(`/api/v1/books/${bookId}/ocr`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
      
      if (!resp.ok) {
        console.log(`[useOcrData] Server returned ${resp.status}`)
        return false
      }
      
      const result = await resp.json()
      const available = result.data?.available && result.data?.is_image_based
      console.log(`[useOcrData] Server availability: ${available}`, result.data)
      
      if (isMountedRef.current) {
        setStatus(prev => ({ ...prev, available }))
      }
      return available
    } catch (e) {
      console.error('[useOcrData] Failed to check server availability:', e)
      return false
    }
  }, [bookId, accessToken])

  // 下载完整 OCR 数据
  const download = useCallback(async (): Promise<boolean> => {
    if (!bookId || !accessToken) return false
    
    // 使用 ref 检查下载状态，避免 useCallback 依赖 status.downloading
    if (downloadingRef.current) {
      console.log('[useOcrData] Download already in progress, skipping')
      return false
    }
    
    // 不要取消之前的请求，只有在确实需要新下载时才创建新的 controller
    abortControllerRef.current = new AbortController()
    downloadingRef.current = true
    
    setStatus(prev => ({ ...prev, downloading: true, progress: 0, error: null }))
    
    try {
      console.log(`[useOcrData] Downloading OCR data for ${bookId}...`)
      
      const resp = await fetch(`/api/v1/books/${bookId}/ocr/full`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Accept-Encoding': 'gzip',
        },
        signal: abortControllerRef.current.signal,
      })
      
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
      }
      
      // 获取压缩/原始大小用于日志
      const compressedSize = resp.headers.get('X-Compressed-Size')
      const originalSize = resp.headers.get('X-Original-Size')
      console.log(`[useOcrData] Downloaded: ${compressedSize} bytes (compressed), ${originalSize} bytes (original)`)
      
      setStatus(prev => ({ ...prev, progress: 50 }))
      
      const data = await resp.json()
      
      setStatus(prev => ({ ...prev, progress: 75 }))
      
      // 转换 page_sizes 格式 (API: snake_case -> Frontend: camelCase)
      const pageSizes: Record<string, { width: number; height: number; pdfWidth?: number; pdfHeight?: number; dpi?: number }> = {}
      if (data.page_sizes) {
        for (const [pageNum, size] of Object.entries(data.page_sizes)) {
          const s = size as { width: number; height: number; pdf_width?: number; pdf_height?: number; dpi?: number }
          pageSizes[pageNum] = {
            width: s.width,
            height: s.height,
            pdfWidth: s.pdf_width,
            pdfHeight: s.pdf_height,
            dpi: s.dpi,
          }
        }
      }
      
      // 从 page_sizes 提取第一页尺寸作为默认值（向后兼容）
      const firstPageSize = pageSizes['1'] || { width: 1240, height: 1754 }
      const defaultWidth = data.image_width || firstPageSize.width
      const defaultHeight = data.image_height || firstPageSize.height
      
      // 保存到 IndexedDB
      await saveOcrData({
        bookId,
        isImageBased: data.is_image_based,
        confidence: data.confidence,
        totalPages: data.total_pages,
        totalChars: data.total_chars,
        totalRegions: data.total_regions,
        imageWidth: defaultWidth,
        imageHeight: defaultHeight,
        pageSizes: Object.keys(pageSizes).length > 0 ? pageSizes : undefined,
        regions: data.regions,
        downloadedAt: Date.now(),
      })
      
      // 更新内存缓存
      const ocrRecord: OcrDataRecord = {
        bookId,
        isImageBased: data.is_image_based,
        confidence: data.confidence,
        totalPages: data.total_pages,
        totalChars: data.total_chars,
        totalRegions: data.total_regions,
        imageWidth: defaultWidth,
        imageHeight: defaultHeight,
        pageSizes: Object.keys(pageSizes).length > 0 ? pageSizes : undefined,
        regions: data.regions,
        downloadedAt: Date.now(),
      }
      memoryCache.set(bookId, ocrRecord)
      
      if (isMountedRef.current) {
        setInfo({
          isImageBased: data.is_image_based,
          confidence: data.confidence,
          totalPages: data.total_pages,
          totalChars: data.total_chars,
          totalRegions: data.total_regions,
          imageWidth: defaultWidth,
          imageHeight: defaultHeight,
        })
        setStatus({
          available: true,
          cached: true,
          downloading: false,
          progress: 100,
          error: null,
        })
      }
      
      downloadingRef.current = false
      console.log(`[useOcrData] OCR data saved: ${data.total_regions} regions, ${data.total_chars} chars, ${Object.keys(pageSizes).length} page sizes`)
      return true
    } catch (e) {
      downloadingRef.current = false
      
      if ((e as Error).name === 'AbortError') {
        console.log('[useOcrData] Download aborted')
        return false
      }
      
      const errorMsg = e instanceof Error ? e.message : 'Unknown error'
      console.error('[useOcrData] Download failed:', errorMsg)
      
      if (isMountedRef.current) {
        setStatus(prev => ({
          ...prev,
          downloading: false,
          progress: 0,
          error: errorMsg,
        }))
      }
      return false
    }
  }, [bookId, accessToken])  // 移除 status.downloading 依赖

  // 获取指定页的 OCR 区域（异步）
  const getPageRegions = useCallback(async (page: number): Promise<OcrRegion[]> => {
    if (!bookId) return []
    
    // 先检查内存缓存
    const cached = memoryCache.get(bookId)
    if (cached) {
      return cached.regions.filter(r => r.page === page)
    }
    
    // 从 IndexedDB 读取
    return getOcrPageRegions(bookId, page)
  }, [bookId])

  // 获取指定页的 OCR 区域（同步，从内存缓存）
  const getPageRegionsSync = useCallback((page: number): OcrRegion[] => {
    if (!bookId) return []
    
    const cached = memoryCache.get(bookId)
    if (!cached) return []
    
    return cached.regions.filter(r => r.page === page)
  }, [bookId])

  // 获取指定页的 OCR 图片尺寸（同步，从内存缓存）
  const getPageSizeSync = useCallback((page: number): OcrPageSize | null => {
    if (!bookId) return null
    
    const cached = memoryCache.get(bookId)
    if (!cached) return null
    
    // 如果有每页尺寸，优先使用
    if (cached.pageSizes) {
      const pageSize = cached.pageSizes[String(page)]
      if (pageSize) return pageSize
    }
    
    // 回退到全局默认尺寸
    return {
      width: cached.imageWidth,
      height: cached.imageHeight,
    }
  }, [bookId])

  // 刷新状态
  const refresh = useCallback(async () => {
    const hasCached = await checkLocalCache()
    if (!hasCached) {
      await checkServerAvailability()
    }
  }, [checkLocalCache, checkServerAvailability])

  // 初始化
  useEffect(() => {
    isMountedRef.current = true
    
    const init = async () => {
      const hasCached = await checkLocalCache()
      if (!hasCached) {
        const available = await checkServerAvailability()
        if (available && autoDownload) {
          download()
        }
      }
    }
    
    init()
    
    // 注意：不在这里 abort，只在组件卸载时 abort
  }, [bookId, checkLocalCache, checkServerAvailability, autoDownload, download])

  // 组件卸载时的清理
  useEffect(() => {
    return () => {
      isMountedRef.current = false
      // 只在组件真正卸载时才 abort 下载
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])  // 空依赖，只在卸载时执行

  return {
    status,
    info,
    download,
    getPageRegions,
    getPageRegionsSync,
    getPageSizeSync,
    refresh,
  }
}

/**
 * 预加载 OCR 数据到内存缓存
 * 在书籍打开时调用，确保翻页时可以同步获取数据
 */
export async function preloadOcrToMemory(bookId: string): Promise<boolean> {
  if (memoryCache.has(bookId)) return true
  
  try {
    const ocrData = await getOcrData(bookId)
    if (ocrData) {
      memoryCache.set(bookId, ocrData)
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * 清除内存缓存（在关闭阅读器时调用）
 */
export function clearOcrMemoryCache(bookId?: string): void {
  if (bookId) {
    memoryCache.delete(bookId)
  } else {
    memoryCache.clear()
  }
}

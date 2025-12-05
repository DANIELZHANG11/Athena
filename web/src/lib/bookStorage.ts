/**
 * bookStorage.ts
 * 书籍本地存储服务 - 使用 IndexedDB 管理书籍文件的离线缓存
 * 
 * 架构说明:
 * - 用户上传书籍 → 服务器处理（Calibre 转换、封面提取）
 * - 用户点击阅读 → 下载完整书籍到 IndexedDB
 * - 阅读时 → 从 IndexedDB 读取 Blob，完全本地渲染
 * - 服务器只负责 → 心跳同步、进度记录
 */

const DB_NAME = 'athena_books'
const DB_VERSION = 3  // 升级版本以添加封面缓存
const STORE_NAME = 'book_files'
const META_STORE = 'book_meta'
const OCR_STORE = 'book_ocr'
const COVER_STORE = 'book_covers'  // 新增封面存储

export interface BookFileRecord {
  bookId: string
  blob: Blob
  format: 'epub' | 'pdf'
  size: number
  downloadedAt: number  // Unix timestamp
  etag?: string         // For cache validation
}

export interface BookMetaRecord {
  bookId: string
  title: string
  author: string
  coverUrl: string
  format: 'epub' | 'pdf'
  size: number
  isDownloaded: boolean
  downloadedAt?: number
}

/** 封面缓存记录 */
export interface CoverCacheRecord {
  bookId: string
  blob: Blob
  mimeType: string
  cachedAt: number
  originalUrl: string
}

/** OCR 区域数据 */
export interface OcrRegion {
  text: string
  confidence: number
  bbox: [number, number, number, number]  // [x1, y1, x2, y2]
  polygon: [number, number][]  // [[x1,y1], [x2,y2], ...]
  page: number
}

/** 每页的尺寸信息 */
export interface OcrPageSize {
  width: number       // OCR 图片宽度
  height: number      // OCR 图片高度
  pdfWidth?: number   // PDF 原始宽度 (points)
  pdfHeight?: number  // PDF 原始高度 (points)
  dpi?: number        // 渲染时使用的 DPI
}

/** OCR 数据记录 */
export interface OcrDataRecord {
  bookId: string
  isImageBased: boolean
  confidence: number
  totalPages: number
  totalChars: number
  totalRegions: number
  imageWidth: number      // 默认/第一页的宽度（向后兼容）
  imageHeight: number     // 默认/第一页的高度（向后兼容）
  pageSizes?: Record<string, OcrPageSize>  // 每页的独立尺寸 {"1": {...}, "2": {...}}
  regions: OcrRegion[]
  downloadedAt: number
}

// 打开数据库
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    
    request.onerror = () => {
      console.error('[BookStorage] Failed to open database:', request.error)
      reject(request.error)
    }
    
    request.onsuccess = () => {
      resolve(request.result)
    }
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      
      // 书籍文件存储
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'bookId' })
        store.createIndex('downloadedAt', 'downloadedAt', { unique: false })
        store.createIndex('format', 'format', { unique: false })
        console.log('[BookStorage] Created book_files store')
      }
      
      // 书籍元数据存储
      if (!db.objectStoreNames.contains(META_STORE)) {
        const metaStore = db.createObjectStore(META_STORE, { keyPath: 'bookId' })
        metaStore.createIndex('isDownloaded', 'isDownloaded', { unique: false })
        console.log('[BookStorage] Created book_meta store')
      }
      
      // OCR 数据存储（v2 新增）
      if (!db.objectStoreNames.contains(OCR_STORE)) {
        const ocrStore = db.createObjectStore(OCR_STORE, { keyPath: 'bookId' })
        ocrStore.createIndex('downloadedAt', 'downloadedAt', { unique: false })
        console.log('[BookStorage] Created book_ocr store')
      }
      
      // 封面缓存存储（v3 新增）
      if (!db.objectStoreNames.contains(COVER_STORE)) {
        const coverStore = db.createObjectStore(COVER_STORE, { keyPath: 'bookId' })
        coverStore.createIndex('cachedAt', 'cachedAt', { unique: false })
        console.log('[BookStorage] Created book_covers store')
      }
    }
  })
}

/**
 * 保存书籍文件到 IndexedDB
 */
export async function saveBookFile(
  bookId: string,
  blob: Blob,
  format: 'epub' | 'pdf',
  etag?: string
): Promise<void> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    
    const record: BookFileRecord = {
      bookId,
      blob,
      format,
      size: blob.size,
      downloadedAt: Date.now(),
      etag
    }
    
    const request = store.put(record)
    
    request.onsuccess = () => {
      console.log(`[BookStorage] Saved book ${bookId}, size: ${blob.size} bytes`)
      resolve()
    }
    
    request.onerror = () => {
      console.error('[BookStorage] Failed to save book:', request.error)
      reject(request.error)
    }
    
    tx.oncomplete = () => db.close()
  })
}

/**
 * 从 IndexedDB 获取书籍文件
 */
export async function getBookFile(bookId: string): Promise<BookFileRecord | null> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(bookId)
    
    request.onsuccess = () => {
      const record = request.result as BookFileRecord | undefined
      if (record) {
        console.log(`[BookStorage] Found cached book ${bookId}, size: ${record.size} bytes`)
      } else {
        console.log(`[BookStorage] Book ${bookId} not found in cache`)
      }
      resolve(record || null)
    }
    
    request.onerror = () => {
      console.error('[BookStorage] Failed to get book:', request.error)
      reject(request.error)
    }
    
    tx.oncomplete = () => db.close()
  })
}

/**
 * 检查书籍是否已缓存
 */
export async function isBookCached(bookId: string): Promise<boolean> {
  try {
    const record = await getBookFile(bookId)
    return record !== null
  } catch {
    return false
  }
}

/**
 * 删除书籍缓存
 */
export async function deleteBookFile(bookId: string): Promise<void> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.delete(bookId)
    
    request.onsuccess = () => {
      console.log(`[BookStorage] Deleted book ${bookId} from cache`)
      resolve()
    }
    
    request.onerror = () => {
      console.error('[BookStorage] Failed to delete book:', request.error)
      reject(request.error)
    }
    
    tx.oncomplete = () => db.close()
  })
}

/**
 * 获取所有已缓存的书籍 ID 列表
 */
export async function getCachedBookIds(): Promise<string[]> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAllKeys()
    
    request.onsuccess = () => {
      const ids = request.result as string[]
      console.log(`[BookStorage] Found ${ids.length} cached books`)
      resolve(ids)
    }
    
    request.onerror = () => {
      console.error('[BookStorage] Failed to get cached book ids:', request.error)
      reject(request.error)
    }
    
    tx.oncomplete = () => db.close()
  })
}

/**
 * 获取缓存统计信息
 */
export interface CacheStats {
  totalBooks: number
  totalSize: number
  oldestDownload: number | null
}

export async function getCacheStats(): Promise<CacheStats> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()
    
    request.onsuccess = () => {
      const records = request.result as BookFileRecord[]
      const totalBooks = records.length
      const totalSize = records.reduce((sum, r) => sum + r.size, 0)
      const oldestDownload = records.length > 0
        ? Math.min(...records.map(r => r.downloadedAt))
        : null
      
      resolve({ totalBooks, totalSize, oldestDownload })
    }
    
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => db.close()
  })
}

/**
 * 清除所有缓存
 */
export async function clearAllCache(): Promise<void> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.clear()
    
    request.onsuccess = () => {
      console.log('[BookStorage] Cleared all cached books')
      resolve()
    }
    
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => db.close()
  })
}

/**
 * 清除过期缓存（超过指定天数未访问的书籍）
 */
export async function clearExpiredCache(maxAgeDays: number = 30): Promise<number> {
  const db = await openDB()
  const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000)
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('downloadedAt')
    const range = IDBKeyRange.upperBound(cutoffTime)
    const request = index.openCursor(range)
    
    let deletedCount = 0
    
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        cursor.delete()
        deletedCount++
        cursor.continue()
      } else {
        console.log(`[BookStorage] Cleared ${deletedCount} expired books`)
        resolve(deletedCount)
      }
    }
    
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => db.close()
  })
}

/**
 * 从 Blob 创建 Object URL（用于阅读器）
 */
export function createBlobUrl(blob: Blob): string {
  return URL.createObjectURL(blob)
}

/**
 * 释放 Object URL
 */
export function revokeBlobUrl(url: string): void {
  URL.revokeObjectURL(url)
}

// ==================== OCR 数据存储 ====================

/**
 * 保存 OCR 数据到 IndexedDB
 */
export async function saveOcrData(
  bookId: string,
  ocrData: Omit<OcrDataRecord, 'bookId' | 'downloadedAt'>
): Promise<void> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OCR_STORE, 'readwrite')
    const store = tx.objectStore(OCR_STORE)
    
    const record: OcrDataRecord = {
      bookId,
      ...ocrData,
      downloadedAt: Date.now(),
    }
    
    const request = store.put(record)
    
    request.onsuccess = () => {
      console.log(`[BookStorage] Saved OCR data for ${bookId}, ${ocrData.totalRegions} regions, ${ocrData.totalChars} chars`)
      resolve()
    }
    
    request.onerror = () => {
      console.error('[BookStorage] Failed to save OCR data:', request.error)
      reject(request.error)
    }
    
    tx.oncomplete = () => db.close()
  })
}

/**
 * 从 IndexedDB 获取 OCR 数据
 */
export async function getOcrData(bookId: string): Promise<OcrDataRecord | null> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OCR_STORE, 'readonly')
    const store = tx.objectStore(OCR_STORE)
    const request = store.get(bookId)
    
    request.onsuccess = () => {
      const record = request.result as OcrDataRecord | undefined
      if (record) {
        console.log(`[BookStorage] Found OCR data for ${bookId}, ${record.totalRegions} regions`)
      } else {
        console.log(`[BookStorage] OCR data for ${bookId} not found in cache`)
      }
      resolve(record || null)
    }
    
    request.onerror = () => {
      console.error('[BookStorage] Failed to get OCR data:', request.error)
      reject(request.error)
    }
    
    tx.oncomplete = () => db.close()
  })
}

/**
 * 检查书籍是否有 OCR 数据缓存
 */
export async function hasOcrData(bookId: string): Promise<boolean> {
  try {
    const record = await getOcrData(bookId)
    return record !== null
  } catch {
    return false
  }
}

/**
 * 获取指定页的 OCR 区域
 */
export async function getOcrPageRegions(bookId: string, page: number): Promise<OcrRegion[]> {
  const ocrData = await getOcrData(bookId)
  if (!ocrData) return []
  
  return ocrData.regions.filter(r => r.page === page)
}

/**
 * 删除 OCR 数据缓存
 */
export async function deleteOcrData(bookId: string): Promise<void> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OCR_STORE, 'readwrite')
    const store = tx.objectStore(OCR_STORE)
    const request = store.delete(bookId)
    
    request.onsuccess = () => {
      console.log(`[BookStorage] Deleted OCR data for ${bookId}`)
      resolve()
    }
    
    request.onerror = () => {
      console.error('[BookStorage] Failed to delete OCR data:', request.error)
      reject(request.error)
    }
    
    tx.oncomplete = () => db.close()
  })
}

// ============================================================
// 封面缓存功能 (v3 新增)
// ============================================================

/**
 * 缓存封面图片到 IndexedDB
 * @param bookId 书籍 ID
 * @param coverUrl 原始封面 URL
 */
export async function cacheCover(bookId: string, coverUrl: string): Promise<void> {
  if (!coverUrl) return
  
  try {
    // 下载封面图片
    const response = await fetch(coverUrl)
    if (!response.ok) {
      console.warn(`[BookStorage] Failed to fetch cover for ${bookId}: ${response.status}`)
      return
    }
    
    const blob = await response.blob()
    const mimeType = response.headers.get('content-type') || 'image/jpeg'
    
    const db = await openDB()
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(COVER_STORE, 'readwrite')
      const store = tx.objectStore(COVER_STORE)
      
      const record: CoverCacheRecord = {
        bookId,
        blob,
        mimeType,
        cachedAt: Date.now(),
        originalUrl: coverUrl,
      }
      
      const request = store.put(record)
      
      request.onsuccess = () => {
        console.log(`[BookStorage] Cached cover for ${bookId}, size: ${blob.size} bytes`)
        resolve()
      }
      
      request.onerror = () => {
        console.error('[BookStorage] Failed to cache cover:', request.error)
        reject(request.error)
      }
      
      tx.oncomplete = () => db.close()
    })
  } catch (e) {
    console.error('[BookStorage] Error caching cover:', e)
  }
}

/**
 * 获取缓存的封面
 * @param bookId 书籍 ID
 * @returns 封面记录或 null
 */
export async function getCachedCover(bookId: string): Promise<CoverCacheRecord | null> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(COVER_STORE, 'readonly')
    const store = tx.objectStore(COVER_STORE)
    const request = store.get(bookId)
    
    request.onsuccess = () => {
      const record = request.result as CoverCacheRecord | undefined
      if (record) {
        console.log(`[BookStorage] Found cached cover for ${bookId}`)
      }
      resolve(record || null)
    }
    
    request.onerror = () => {
      console.error('[BookStorage] Failed to get cached cover:', request.error)
      reject(request.error)
    }
    
    tx.oncomplete = () => db.close()
  })
}

/**
 * 获取封面的 Object URL（用于 img src）
 * 优先使用缓存，如果没有缓存则返回原始 URL 并异步缓存
 * @param bookId 书籍 ID
 * @param originalUrl 原始封面 URL
 * @returns Object URL 或原始 URL
 */
export async function getCoverUrl(bookId: string, originalUrl: string): Promise<string> {
  if (!originalUrl) return ''
  
  try {
    const cached = await getCachedCover(bookId)
    if (cached) {
      // 返回缓存的 Blob URL
      return URL.createObjectURL(cached.blob)
    }
    
    // 没有缓存，异步缓存后返回原始 URL
    cacheCover(bookId, originalUrl).catch(console.error)
    return originalUrl
  } catch {
    return originalUrl
  }
}

/**
 * 批量缓存多本书的封面
 * @param books 书籍列表 [{id, coverUrl}]
 */
export async function batchCacheCovers(books: { id: string; coverUrl?: string }[]): Promise<void> {
  const BATCH_SIZE = 5  // 每批并发数量
  
  for (let i = 0; i < books.length; i += BATCH_SIZE) {
    const batch = books.slice(i, i + BATCH_SIZE)
    await Promise.all(
      batch
        .filter(b => b.coverUrl)
        .map(b => cacheCover(b.id, b.coverUrl!))
    )
  }
}

/**
 * 删除封面缓存
 */
export async function deleteCachedCover(bookId: string): Promise<void> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(COVER_STORE, 'readwrite')
    const store = tx.objectStore(COVER_STORE)
    const request = store.delete(bookId)
    
    request.onsuccess = () => {
      console.log(`[BookStorage] Deleted cached cover for ${bookId}`)
      resolve()
    }
    
    request.onerror = () => {
      console.error('[BookStorage] Failed to delete cached cover:', request.error)
      reject(request.error)
    }
    
    tx.oncomplete = () => db.close()
  })
}

/**
 * 检查封面是否已缓存
 */
export async function isCoverCached(bookId: string): Promise<boolean> {
  try {
    const record = await getCachedCover(bookId)
    return record !== null
  } catch {
    return false
  }
}

/**
 * 清理过期的封面缓存（超过 30 天）
 */
export async function cleanOldCoverCache(maxAgeDays: number = 30): Promise<number> {
  const db = await openDB()
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  let deletedCount = 0
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(COVER_STORE, 'readwrite')
    const store = tx.objectStore(COVER_STORE)
    const index = store.index('cachedAt')
    const range = IDBKeyRange.upperBound(cutoff)
    const request = index.openCursor(range)
    
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result
      if (cursor) {
        cursor.delete()
        deletedCount++
        cursor.continue()
      }
    }
    
    tx.oncomplete = () => {
      console.log(`[BookStorage] Cleaned ${deletedCount} old cover caches`)
      db.close()
      resolve(deletedCount)
    }
    
    tx.onerror = () => {
      reject(tx.error)
    }
  })
}

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
const DB_VERSION = 1
const STORE_NAME = 'book_files'
const META_STORE = 'book_meta'

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

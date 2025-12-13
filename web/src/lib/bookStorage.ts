/**
 * bookStorage.ts - 本地文件存储服务 (App-First 版)
 *
 * 职责：
 * - 管理大文件存储 (PDF/EPUB Blob)
 * - 管理封面图片缓存
 * - 管理离线上传队列
 * - 使用原生 IndexedDB 替代 Dexie
 * - 仅处理文件 Blob，元数据由 PowerSync/SQLite 管理
 *
 * @see 09 - APP-FIRST架构改造计划.md
 */

const DB_NAME = 'athena-files'
const DB_VERSION = 3 // 升级版本: 增加 upload_queue
const STORE_BOOKS = 'books'
const STORE_COVERS = 'covers'
const STORE_OCR = 'ocr'
const STORE_UPLOAD_QUEUE = 'upload_queue'

// ============ 类型定义 ============

export interface BookFileRecord {
  bookId: string
  blob: Blob
  format: 'epub' | 'pdf'
  size: number
  downloadedAt: number
  etag?: string
}

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
  bbox: [number, number, number, number]
  polygon: [number, number][]
  page: number
}

/** 每页的尺寸信息 */
export interface OcrPageSize {
  width: number
  height: number
  pdfWidth?: number
  pdfHeight?: number
  dpi?: number
}

/** OCR 数据记录 */
export interface OcrDataRecord {
  bookId: string
  isImageBased: boolean
  confidence: number
  totalPages: number
  totalChars: number
  totalRegions: number
  imageWidth: number
  imageHeight: number
  pageSizes?: Record<string, OcrPageSize>
  regions: OcrRegion[]
  downloadedAt: number
}

export interface UploadQueueItem {
  id: string
  fileName: string
  title: string
  blob: Blob
  fingerprint: string
  createdAt: number
}

export interface CacheStats {
  bookCount: number
  totalSize: number
  coverCount: number
  coverSize: number
  ocrCount: number
  ocrSize: number
  uploadQueueCount: number
  uploadQueueSize: number
}

// ============ IndexedDB 基础封装 ============

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_BOOKS)) {
        db.createObjectStore(STORE_BOOKS, { keyPath: 'bookId' })
      }
      if (!db.objectStoreNames.contains(STORE_COVERS)) {
        db.createObjectStore(STORE_COVERS, { keyPath: 'bookId' })
      }
      if (!db.objectStoreNames.contains(STORE_OCR)) {
        db.createObjectStore(STORE_OCR, { keyPath: 'bookId' })
      }
      if (!db.objectStoreNames.contains(STORE_UPLOAD_QUEUE)) {
        db.createObjectStore(STORE_UPLOAD_QUEUE, { keyPath: 'id' })
      }
    }

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result)
    }

    request.onerror = (event) => {
      console.error('[FileStorage] Failed to open DB:', (event.target as IDBOpenDBRequest).error)
      reject((event.target as IDBOpenDBRequest).error)
    }
  })

  return dbPromise
}

async function getStore(storeName: string, mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
  const db = await openDB()
  const tx = db.transaction(storeName, mode)
  return tx.objectStore(storeName)
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// ============ 书籍文件操作 ============

/**
 * 保存书籍文件
 */
export async function saveBookFile(
  bookId: string,
  blob: Blob,
  format: 'epub' | 'pdf',
  etag?: string
): Promise<void> {
  const store = await getStore(STORE_BOOKS, 'readwrite')
  const record: BookFileRecord = {
    bookId,
    blob,
    format,
    size: blob.size,
    downloadedAt: Date.now(),
    etag
  }
  await promisifyRequest(store.put(record))
  console.log(`[FileStorage] Saved book ${bookId} (${format}, ${(blob.size / 1024 / 1024).toFixed(2)}MB)`)
  
  // 广播事件
  window.dispatchEvent(new CustomEvent('book_cached', { detail: { bookId } }))
}

/**
 * 获取书籍文件
 */
export async function getBookFile(bookId: string): Promise<BookFileRecord | undefined> {
  const store = await getStore(STORE_BOOKS)
  return promisifyRequest(store.get(bookId))
}

/**
 * 删除书籍文件
 * 同时删除相关的封面和 OCR 数据
 */
export async function deleteBook(bookId: string): Promise<void> {
  const db = await openDB()
  const tx = db.transaction([STORE_BOOKS, STORE_COVERS, STORE_OCR], 'readwrite')
  
  await promisifyRequest(tx.objectStore(STORE_BOOKS).delete(bookId))
  await promisifyRequest(tx.objectStore(STORE_COVERS).delete(bookId))
  await promisifyRequest(tx.objectStore(STORE_OCR).delete(bookId))
  
  console.log(`[FileStorage] Deleted all files for book ${bookId}`)
  
  // 广播事件
  window.dispatchEvent(new CustomEvent('book_deleted', { detail: { bookId } }))
}

/**
 * 仅删除书籍文件 (保留其他)
 */
export async function deleteBookFile(bookId: string): Promise<void> {
  const store = await getStore(STORE_BOOKS, 'readwrite')
  await promisifyRequest(store.delete(bookId))
  console.log(`[FileStorage] Deleted book file ${bookId}`)
}

/**
 * 检查书籍是否已缓存
 */
export async function isBookCached(bookId: string): Promise<boolean> {
  const store = await getStore(STORE_BOOKS)
  const count = await promisifyRequest(store.count(bookId))
  return count > 0
}

// ============ 封面缓存操作 ============

/**
 * 保存封面缓存
 */
export async function saveCoverCache(
  bookId: string,
  blob: Blob,
  originalUrl: string
): Promise<void> {
  const store = await getStore(STORE_COVERS, 'readwrite')
  const record: CoverCacheRecord = {
    bookId,
    blob,
    mimeType: blob.type,
    cachedAt: Date.now(),
    originalUrl
  }
  await promisifyRequest(store.put(record))
}

/**
 * 获取封面缓存
 */
export async function getCoverCache(bookId: string): Promise<CoverCacheRecord | undefined> {
  const store = await getStore(STORE_COVERS)
  return promisifyRequest(store.get(bookId))
}

// ============ OCR 数据操作 ============

/**
 * 保存 OCR 数据
 */
export async function saveOcrData(data: OcrDataRecord): Promise<void> {
  const store = await getStore(STORE_OCR, 'readwrite')
  await promisifyRequest(store.put(data))
  console.log(`[FileStorage] Saved OCR data for ${data.bookId} (${data.totalRegions} regions)`)
}

/**
 * 获取 OCR 数据
 */
export async function getOcrData(bookId: string): Promise<OcrDataRecord | undefined> {
  const store = await getStore(STORE_OCR)
  return promisifyRequest(store.get(bookId))
}

/**
 * 获取指定页的 OCR 区域 (辅助函数)
 */
export async function getOcrPageRegions(bookId: string, page: number): Promise<OcrRegion[]> {
  const data = await getOcrData(bookId)
  if (!data) return []
  return data.regions.filter(r => r.page === page)
}

// ============ 离线上传队列操作 ============

export async function saveOfflineUploadQueue(item: UploadQueueItem): Promise<void> {
  const store = await getStore(STORE_UPLOAD_QUEUE, 'readwrite')
  await promisifyRequest(store.put(item))
  console.log(`[FileStorage] Added to upload queue: ${item.id}`)
}

export async function getOfflineUploadQueue(): Promise<UploadQueueItem[]> {
  const store = await getStore(STORE_UPLOAD_QUEUE)
  return promisifyRequest(store.getAll()) as Promise<UploadQueueItem[]>
}

export async function removeOfflineUploadQueue(id: string): Promise<void> {
  const store = await getStore(STORE_UPLOAD_QUEUE, 'readwrite')
  await promisifyRequest(store.delete(id))
  console.log(`[FileStorage] Removed from upload queue: ${id}`)
}

// ============ 统计信息 ============

/**
 * 获取缓存统计
 */
export async function getCacheStats(): Promise<CacheStats> {
  const db = await openDB()
  
  // 统计书籍
  const bookTx = db.transaction(STORE_BOOKS, 'readonly')
  const bookStore = bookTx.objectStore(STORE_BOOKS)
  const books = await promisifyRequest(bookStore.getAll()) as BookFileRecord[]
  
  const bookCount = books.length
  const totalSize = books.reduce((sum, book) => sum + book.size, 0)
  
  // 统计封面
  const coverTx = db.transaction(STORE_COVERS, 'readonly')
  const coverStore = coverTx.objectStore(STORE_COVERS)
  const covers = await promisifyRequest(coverStore.getAll()) as CoverCacheRecord[]
  
  const coverCount = covers.length
  const coverSize = covers.reduce((sum, cover) => sum + cover.blob.size, 0)

  // 统计 OCR
  const ocrTx = db.transaction(STORE_OCR, 'readonly')
  const ocrStore = ocrTx.objectStore(STORE_OCR)
  const ocrs = await promisifyRequest(ocrStore.getAll()) as OcrDataRecord[]
  
  const ocrCount = ocrs.length
  const ocrSize = ocrs.reduce((sum, ocr) => sum + JSON.stringify(ocr).length, 0)

  // 统计上传队列
  const queueTx = db.transaction(STORE_UPLOAD_QUEUE, 'readonly')
  const queueStore = queueTx.objectStore(STORE_UPLOAD_QUEUE)
  const queueItems = await promisifyRequest(queueStore.getAll()) as UploadQueueItem[]
  
  const uploadQueueCount = queueItems.length
  const uploadQueueSize = queueItems.reduce((sum, item) => sum + item.blob.size, 0)
  
  return {
    bookCount,
    totalSize,
    coverCount,
    coverSize,
    ocrCount,
    ocrSize,
    uploadQueueCount,
    uploadQueueSize
  }
}

/**
 * 清除所有缓存
 */
export async function clearAllCache(): Promise<void> {
  const db = await openDB()
  const tx = db.transaction([STORE_BOOKS, STORE_COVERS, STORE_OCR, STORE_UPLOAD_QUEUE], 'readwrite')
  
  await promisifyRequest(tx.objectStore(STORE_BOOKS).clear())
  await promisifyRequest(tx.objectStore(STORE_COVERS).clear())
  await promisifyRequest(tx.objectStore(STORE_OCR).clear())
  await promisifyRequest(tx.objectStore(STORE_UPLOAD_QUEUE).clear())
  
  console.log('[FileStorage] All cache cleared')
}

// ============ Blob URL 辅助函数 ============

export function createBlobUrl(blob: Blob): string {
  return URL.createObjectURL(blob)
}

export function revokeBlobUrl(url: string): void {
  URL.revokeObjectURL(url)
}

// 导出单例 (可选，如果需要)
export const bookStorage = {
  saveBookFile,
  getBookFile,
  deleteBook,
  deleteBookFile,
  isBookCached,
  saveCoverCache,
  getCoverCache,
  saveOcrData,
  getOcrData,
  getOcrPageRegions,
  saveOfflineUploadQueue,
  getOfflineUploadQueue,
  removeOfflineUploadQueue,
  getCacheStats,
  clearAllCache,
  createBlobUrl,
  revokeBlobUrl
}

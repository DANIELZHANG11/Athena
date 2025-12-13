/**
 * useBookDownload
 * 书籍下载 Hook - 管理书籍从服务器下载到本地 IndexedDB 的流程
 * 
 * 功能:
 * - 检查书籍是否已缓存
 * - 下载书籍到 IndexedDB
 * - 提供下载进度
 * - 支持取消下载
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useAuthStore } from '@/stores/auth'
import {
  saveBookFile,
  getBookFile,
  deleteBookFile,
  createBlobUrl,
  revokeBlobUrl,
} from '@/lib/bookStorage'

export type DownloadStatus = 
  | 'idle'           // 未开始
  | 'checking'       // 检查缓存中
  | 'cached'         // 已缓存，可直接使用
  | 'downloading'    // 下载中
  | 'saving'         // 保存到 IndexedDB 中
  | 'ready'          // 下载完成，可以阅读
  | 'error'          // 下载失败

export interface UseBookDownloadOptions {
  bookId: string
  format: 'epub' | 'pdf'
  enabled?: boolean
  autoDownload?: boolean  // 是否自动开始下载（如果未缓存）
  onSuccess?: (blobUrl: string) => void
  onError?: (error: Error) => void
}

export interface UseBookDownloadReturn {
  status: DownloadStatus
  progress: number          // 0-100
  blobUrl: string | null    // 可用于阅读器的 Blob URL
  error: string | null
  isCached: boolean
  cachedFormat: 'epub' | 'pdf' | null  // 缓存文件的实际格式
  download: () => Promise<void>
  cancel: () => void
  clearCache: () => Promise<void>
  fileSize: number | null   // 文件大小（字节）
}

export function useBookDownload(options: UseBookDownloadOptions): UseBookDownloadReturn {
  const { bookId, format, enabled = true, autoDownload = false, onSuccess, onError } = options
  
  const [status, setStatus] = useState<DownloadStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isCached, setIsCached] = useState(false)
  const [fileSize, setFileSize] = useState<number | null>(null)
  const [cachedFormat, setCachedFormat] = useState<'epub' | 'pdf' | null>(null)
  
  const abortControllerRef = useRef<AbortController | null>(null)
  const blobUrlRef = useRef<string | null>(null)
  const isDownloadingRef = useRef(false)
  const lastBookIdRef = useRef<string>('')
  
  // 使用 ref 存储 callbacks 避免依赖变化
  const onSuccessRef = useRef(onSuccess)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onSuccessRef.current = onSuccess
    onErrorRef.current = onError
  }, [onSuccess, onError])
  
  // 清理 Blob URL
  const cleanupBlobUrl = useCallback(() => {
    if (blobUrlRef.current) {
      revokeBlobUrl(blobUrlRef.current)
      blobUrlRef.current = null
      setBlobUrl(null)
    }
  }, [])
  
  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        revokeBlobUrl(blobUrlRef.current)
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])
  
  // 下载书籍
  const download = useCallback(async () => {
    if (!enabled || !bookId || isDownloadingRef.current) return
    
    isDownloadingRef.current = true
    setStatus('checking')
    setError(null)
    
    try {
      // 先检查缓存
      const cached = await getBookFile(bookId)
      if (cached) {
        console.log(`[BookDownload] Book ${bookId} found in cache, size: ${cached.size}, format: ${cached.format}`)
        setIsCached(true)
        setFileSize(cached.size)
        setCachedFormat(cached.format)  // 设置缓存文件的实际格式
        
        // 清理旧的 blob URL 并创建新的
        if (blobUrlRef.current) {
          revokeBlobUrl(blobUrlRef.current)
        }
        const url = createBlobUrl(cached.blob)
        blobUrlRef.current = url
        setBlobUrl(url)
        setStatus('cached')
        setProgress(100)
        onSuccessRef.current?.(url)
        isDownloadingRef.current = false
        return
      }
      
      // 开始下载
      console.log(`[BookDownload] Book ${bookId} not in cache, downloading...`)
      setStatus('downloading')
      setProgress(0)
      
      const token = useAuthStore.getState().accessToken || localStorage.getItem('access_token') || ''
      const contentUrl = `/api/v1/books/${bookId}/content?token=${encodeURIComponent(token)}`
      
      abortControllerRef.current = new AbortController()
      
      const response = await fetch(contentUrl, {
        signal: abortControllerRef.current.signal
      })
      
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`)
      }
      
      const contentLength = response.headers.get('Content-Length')
      const totalSize = contentLength ? parseInt(contentLength, 10) : 0
      const etag = response.headers.get('ETag') || undefined
      
      if (totalSize > 0) {
        setFileSize(totalSize)
      }
      
      // 使用 ReadableStream 读取并追踪进度
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('Response body is not readable')
      }
      
      const chunks: Uint8Array[] = []
      let receivedLength = 0
      let readerDone = false
      
      while (!readerDone) {
        const { done, value } = await reader.read()
        
        if (done) {
          readerDone = true
          continue
        }
        
        chunks.push(value)
        receivedLength += value.length
        
        if (totalSize > 0) {
          const progressPercent = Math.round((receivedLength / totalSize) * 100)
          setProgress(progressPercent)
        }
      }
      
      console.log(`[BookDownload] Download complete, received ${receivedLength} bytes`)
      
      // 合并 chunks 为 Blob
      const blob = new Blob(chunks as BlobPart[], {
        type: format === 'pdf' ? 'application/pdf' : 'application/epub+zip'
      })
      
      setFileSize(blob.size)
      
      // 保存到 IndexedDB
      setStatus('saving')
      await saveBookFile(bookId, blob, format, etag)
      setCachedFormat(format)  // 设置下载的格式
      
      // 创建 Blob URL
      if (blobUrlRef.current) {
        revokeBlobUrl(blobUrlRef.current)
      }
      const url = createBlobUrl(blob)
      blobUrlRef.current = url
      setBlobUrl(url)
      
      setIsCached(true)
      setStatus('ready')
      setProgress(100)
      
      console.log(`[BookDownload] Book ${bookId} ready for reading`)
      onSuccessRef.current?.(url)
      
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log(`[BookDownload] Download cancelled for ${bookId}`)
        setStatus('idle')
        setProgress(0)
      } else {
        console.error(`[BookDownload] Download failed for ${bookId}:`, err)
        setError(err.message || 'Download failed')
        setStatus('error')
        onErrorRef.current?.(err)
      }
    } finally {
      isDownloadingRef.current = false
    }
  }, [bookId, format, enabled])
  
  // 取消下载
  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])
  
  // 清除缓存
  const clearCache = useCallback(async () => {
    try {
      await deleteBookFile(bookId)
      cleanupBlobUrl()
      setIsCached(false)
      setStatus('idle')
      setProgress(0)
      console.log(`[BookDownload] Cache cleared for ${bookId}`)
    } catch (err) {
      console.error('[BookDownload] Failed to clear cache:', err)
    }
  }, [bookId, cleanupBlobUrl])
  
  // 初始化 - 只在 bookId 变化时运行
  useEffect(() => {
    if (!enabled || !bookId) return
    
    // 防止重复初始化
    if (lastBookIdRef.current === bookId) return
    lastBookIdRef.current = bookId
    
    // 重置状态
    setStatus('idle')
    setProgress(0)
    setError(null)
    setBlobUrl(null)
    setIsCached(false)
    isDownloadingRef.current = false
    
    if (autoDownload) {
      download()
    }
  }, [bookId, enabled, autoDownload, download])
  
  return {
    status,
    progress,
    blobUrl,
    error,
    isCached,
    cachedFormat,
    download,
    cancel,
    clearCache,
    fileSize
  }
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

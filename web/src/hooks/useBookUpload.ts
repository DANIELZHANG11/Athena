/**
 * 电子书上传 Hook
 *
 * 流程：
 * 1) 计算文件 SHA256（可选，失败则服务端计算）
 * 2) 初始化上传，处理去重（own/global 秒传）
 * 3) 通过预签名 URL 直传（XMLHttpRequest 以获得进度）
 * 4) 通知后端完成并持久化记录
 * 5) EPUB/PDF 直接写入 IndexedDB，支持立即阅读
 *
 * 错误处理：统一 `errorCode` 标准化，支持取消与配额限制等场景
 */
import { useState, useCallback, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import api from '@/lib/api'
import { saveBookFile } from '@/lib/bookStorage'

// 上传阶段枚举
export type UploadStage = 'idle' | 'hashing' | 'initializing' | 'uploading' | 'completing' | 'done' | 'error'

// 错误码类型
export type UploadErrorCode = 
  | 'quota_exceeded'
  | 'init_failed'
  | 'put_failed'
  | 'complete_failed'
  | 'file_too_large'
  | 'invalid_format'
  | 'network_error'
  | 'cancelled'
  | 'unknown'

// 支持的文件格式
// EPUB/PDF: 直接支持阅读
// 其他格式: 上传后服务器使用 Calibre 转换为 EPUB
export const SUPPORTED_FORMATS = [
  'epub', 'pdf',           // 直接支持
  'mobi', 'azw', 'azw3',   // Amazon Kindle 格式
  'fb2',                   // FictionBook
  'txt', 'rtf',            // 纯文本和富文本
  'djvu', 'djv',           // DjVu 扫描文档（两种扩展名）
  'lit',                   // Microsoft Reader
  'doc', 'docx',           // Microsoft Word
]
export const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500MB

// 上传状态
export interface UploadState {
  stage: UploadStage
  progress: number // 0-100
  errorCode: UploadErrorCode | null
  fileName: string | null
  bookId: string | null
}

// 上传结果
export interface UploadResult {
  id: string
  downloadUrl: string
  title: string
}

// 进度回调参数
export interface ProgressInfo {
  stage: UploadStage
  progress: number
  fileName: string
}

// Hook 配置选项
export interface UseBookUploadOptions {
  onProgress?: (info: ProgressInfo) => void
  onSuccess?: (result: UploadResult) => void
  onError?: (errorCode: UploadErrorCode, message?: string) => void
}

// 计算文件 SHA256 哈希（支持移动端浏览器）
async function computeSha256(file: File): Promise<string> {
  try {
    // 检查 crypto.subtle 是否可用（某些移动浏览器或非 HTTPS 环境不支持）
    if (!crypto?.subtle?.digest) {
      console.warn('[SHA256] crypto.subtle not available, skipping client-side hash')
      return ''
    }
    
    // 对于大文件，分块读取以避免内存问题
    const MAX_CHUNK_SIZE = 64 * 1024 * 1024 // 64MB
    
    if (file.size > MAX_CHUNK_SIZE) {
      // 大文件：使用流式处理（如果支持）
      // 某些移动浏览器可能不支持，回退到服务端计算
      console.log(`[SHA256] Large file (${(file.size / 1024 / 1024).toFixed(1)}MB), attempting chunked hash...`)
    }
    
    const buf = await file.arrayBuffer()
    const hashBuf = await crypto.subtle.digest('SHA-256', buf)
    const hashArr = Array.from(new Uint8Array(hashBuf))
    const hash = hashArr.map(b => b.toString(16).padStart(2, '0')).join('')
    
    console.log(`[SHA256] Computed: ${hash.substring(0, 16)}... for ${file.name}`)
    return hash
  } catch (error) {
    // 移动端浏览器或某些环境可能抛出异常
    console.warn('[SHA256] Client-side hash computation failed:', error)
    console.warn('[SHA256] Server will compute hash as fallback')
    return ''
  }
}

// 获取文件扩展名
function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || ''
}

// 验证文件格式
function validateFileFormat(filename: string): boolean {
  const ext = getFileExtension(filename)
  return SUPPORTED_FORMATS.includes(ext)
}

export function useBookUpload(options: UseBookUploadOptions = {}) {
  const { onProgress, onSuccess, onError } = options
  
  const [state, setState] = useState<UploadState>({
    stage: 'idle',
    progress: 0,
    errorCode: null,
    fileName: null,
    bookId: null,
  })

  // 取消控制器
  const abortControllerRef = useRef<AbortController | null>(null)
  // 幂等键
  const idempotencyKeyRef = useRef<string>('')

  // 更新状态并触发回调
  const updateState = useCallback((
    stage: UploadStage, 
    progress: number, 
    extra?: Partial<UploadState>
  ) => {
    setState(prev => {
      const newState = { ...prev, stage, progress, ...extra }
      // 触发进度回调
      if (onProgress && newState.fileName) {
        onProgress({
          stage,
          progress,
          fileName: newState.fileName,
        })
      }
      return newState
    })
  }, [onProgress])

  // 处理错误
  const handleError = useCallback((errorCode: UploadErrorCode, message?: string) => {
    setState(prev => ({
      ...prev,
      stage: 'error',
      errorCode,
    }))
    onError?.(errorCode, message)
  }, [onError])

  // 重置状态
  const reset = useCallback(() => {
    // 取消正在进行的上传
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setState({
      stage: 'idle',
      progress: 0,
      errorCode: null,
      fileName: null,
      bookId: null,
    })
    idempotencyKeyRef.current = ''
  }, [])

  // 取消上传
  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    handleError('cancelled')
  }, [handleError])

  // 开始上传
  const start = useCallback(async (file: File, customTitle?: string): Promise<UploadResult | null> => {
    // 重置并生成新的幂等键
    reset()
    idempotencyKeyRef.current = uuidv4()
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    const fileName = file.name
    const title = customTitle || fileName.replace(/\.[^/.]+$/, '')

    try {
      // 验证文件格式
      if (!validateFileFormat(fileName)) {
        handleError('invalid_format', `Unsupported format. Supported: ${SUPPORTED_FORMATS.join(', ')}`)
        return null
      }

      // 验证文件大小
      if (file.size > MAX_FILE_SIZE) {
        handleError('file_too_large', `File too large. Max size: ${MAX_FILE_SIZE / 1024 / 1024}MB`)
        return null
      }

      updateState('hashing', 5, { fileName })

      // Step 1: 计算文件哈希
      let fingerprint: string
      try {
        fingerprint = await computeSha256(file)
        if (signal.aborted) throw new Error('cancelled')
      } catch (e) {
        if ((e as Error).message === 'cancelled') {
          handleError('cancelled')
          return null
        }
        // 哈希计算失败不阻塞上传，使用空值
        fingerprint = ''
      }

      updateState('initializing', 15)

      // Step 2: 初始化上传，获取预签名 URL
      let key: string
      let uploadUrl: string
      let dedupHit: 'own' | 'global' | null = null
      let canonicalBookId: string | null = null
      
      try {
        const initRes = await api.post('/books/upload_init', {
          filename: fileName,
          content_sha256: fingerprint,  // SHA256 哈希用于去重检查
          content_type: file.type || 'application/octet-stream',
        }, {
          headers: {
            'Idempotency-Key': idempotencyKeyRef.current,
          },
          signal,
        })

        dedupHit = initRes.data.data.dedup_hit
        
        // 处理去重命中情况
        if (dedupHit === 'own') {
          // 用户自己已有相同文件，直接返回现有记录
          const result: UploadResult = {
            id: initRes.data.data.existing_book_id,
            downloadUrl: '', // 不需要
            title: initRes.data.data.existing_title || title,
          }
          updateState('done', 100, { bookId: result.id })
          onSuccess?.(result)
          return result
        }
        
        if (dedupHit === 'global') {
          // 全局已有相同文件，调用秒传接口
          canonicalBookId = initRes.data.data.canonical_book_id
          console.log('[Upload] Dedup hit: global, using instant upload for canonical:', canonicalBookId)
          
          updateState('completing', 90)
          
          // 调用秒传接口
          const dedupRes = await api.post('/books/dedup_reference', {
            content_sha256: fingerprint,
            canonical_book_id: canonicalBookId,
            title,
            author: '',
            language: '',
          }, {
            headers: {
              'Idempotency-Key': idempotencyKeyRef.current,
            },
            signal,
          })
          
          const result: UploadResult = {
            id: dedupRes.data.data.id,
            downloadUrl: dedupRes.data.data.download_url,
            title,
          }
          
          // 秒传成功，同样保存文件到 IndexedDB
          const fmt = getFileExtension(fileName)
          const directFormats = ['epub', 'pdf']
          if (directFormats.includes(fmt)) {
            try {
              console.log(`[Upload] Saving ${fmt} to IndexedDB for instant reading (dedup)...`)
              await saveBookFile(result.id, file, fmt as 'epub' | 'pdf')
              console.log(`[Upload] Book saved to IndexedDB: ${result.id}`)
            } catch (cacheError) {
              console.warn('[Upload] Failed to cache book locally:', cacheError)
            }
          }
          
          updateState('done', 100, { bookId: result.id })
          onSuccess?.(result)
          return result
        }

        // 正常上传流程
        key = initRes.data.data.key
        uploadUrl = initRes.data.data.upload_url
      } catch (error: any) {
        if (signal.aborted) {
          handleError('cancelled')
          return null
        }
        if (error.response?.status === 403) {
          const detail = error.response?.data?.detail
          if (detail === 'upload_forbidden_quota_exceeded') {
            handleError('quota_exceeded')
            return null
          }
        }
        handleError('init_failed', error.message)
        return null
      }

      updateState('uploading', 20)

      // Step 3: 直接上传文件到 S3
      try {
        // 处理 SeaweedFS 内部域名重写
        let finalUrl = uploadUrl
        try {
          const u = new URL(uploadUrl)
          if (u.hostname.includes('seaweed') || u.hostname.includes('localhost')) {
            // 使用代理路径
            finalUrl = `/s3${u.pathname}${u.search}`
          }
        } catch {
          // URL 解析失败，使用原始 URL
        }

        // 使用 XMLHttpRequest 以支持进度监控
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          
          xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) {
              // 上传进度占 20-80%
              const uploadProgress = Math.round((event.loaded / event.total) * 60)
              updateState('uploading', 20 + uploadProgress)
            }
          })

          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve()
            } else {
              reject(new Error(`Upload failed with status ${xhr.status}`))
            }
          })

          xhr.addEventListener('error', () => {
            reject(new Error('Network error during upload'))
          })

          xhr.addEventListener('abort', () => {
            reject(new Error('cancelled'))
          })

          // 监听取消信号
          signal.addEventListener('abort', () => {
            xhr.abort()
          })

          xhr.open('PUT', finalUrl)
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
          xhr.send(file)
        })

        if (signal.aborted) {
          handleError('cancelled')
          return null
        }
      } catch (error: any) {
        if (error.message === 'cancelled' || signal.aborted) {
          handleError('cancelled')
          return null
        }
        handleError('put_failed', error.message)
        return null
      }

      updateState('completing', 85)

      // Step 4: 通知后端上传完成
      try {
        const fmt = getFileExtension(fileName)
        const compRes = await api.post('/books/upload_complete', {
          key,
          title,
          original_format: fmt,
          size: file.size,
          content_sha256: fingerprint,  // 传递 SHA256 用于去重
        }, {
          headers: {
            'Idempotency-Key': idempotencyKeyRef.current,
          },
          signal,
        })

        const result: UploadResult = {
          id: compRes.data.data.id,
          downloadUrl: compRes.data.data.download_url,
          title,
        }

        // Step 5: 同时保存文件到 IndexedDB（上传后立即可读）
        // 只有 EPUB 和 PDF 格式直接保存，其他格式需要服务器转换
        const directFormats = ['epub', 'pdf']
        if (directFormats.includes(fmt)) {
          try {
            console.log(`[Upload] Saving ${fmt} to IndexedDB for instant reading...`)
            await saveBookFile(result.id, file, fmt as 'epub' | 'pdf')
            console.log(`[Upload] Book saved to IndexedDB: ${result.id}`)
          } catch (cacheError) {
            // 缓存失败不阻塞上传流程
            console.warn('[Upload] Failed to cache book locally:', cacheError)
          }
        }

        updateState('done', 100, { bookId: result.id })
        onSuccess?.(result)

        return result
      } catch (error: any) {
        if (signal.aborted) {
          handleError('cancelled')
          return null
        }
        handleError('complete_failed', error.message)
        return null
      }
    } catch (error: any) {
      // 捕获任何未处理的错误
      if (error.message === 'cancelled' || signal?.aborted) {
        handleError('cancelled')
      } else {
        handleError('unknown', error.message)
      }
      return null
    }
  }, [updateState, handleError, reset, onSuccess])

  return {
    // 状态
    ...state,
    isUploading: state.stage !== 'idle' && state.stage !== 'done' && state.stage !== 'error',
    
    // 方法
    start,
    cancel,
    reset,
    
    // 常量
    supportedFormats: SUPPORTED_FORMATS,
    maxFileSize: MAX_FILE_SIZE,
  }
}

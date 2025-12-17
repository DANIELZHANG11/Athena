/**
 * Web Locks API Polyfill
 * 
 * 用于在非安全上下文（HTTP + 非 localhost）中提供 navigator.locks 的模拟实现
 * 
 * 限制：
 * - 仅支持单标签页（无跨标签页锁同步）
 * - 仅用于开发环境
 * 
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
 */

interface LockInfo {
  name: string
  mode: 'exclusive' | 'shared'
  clientId?: string
}

interface LockManagerSnapshot {
  held: LockInfo[]
  pending: LockInfo[]
}

interface LockOptions {
  mode?: 'exclusive' | 'shared'
  ifAvailable?: boolean
  steal?: boolean
  signal?: AbortSignal
}

type LockGrantedCallback<T> = (lock: Lock | null) => T | Promise<T>

interface Lock {
  name: string
  mode: 'exclusive' | 'shared'
}

interface LockManager {
  request<T>(name: string, callback: LockGrantedCallback<T>): Promise<T>
  request<T>(name: string, options: LockOptions, callback: LockGrantedCallback<T>): Promise<T>
  query(): Promise<LockManagerSnapshot>
}

class PolyfillLockManager implements LockManager {
  private locks: Map<string, { mode: 'exclusive' | 'shared'; count: number; queue: Array<() => void> }> = new Map()

  async request<T>(
    name: string,
    optionsOrCallback: LockOptions | LockGrantedCallback<T>,
    callback?: LockGrantedCallback<T>
  ): Promise<T> {
    let options: LockOptions = {}
    let cb: LockGrantedCallback<T>

    if (typeof optionsOrCallback === 'function') {
      cb = optionsOrCallback
    } else {
      options = optionsOrCallback
      cb = callback!
    }

    const mode = options.mode || 'exclusive'

    // ifAvailable: 如果锁不可用，立即返回 null
    if (options.ifAvailable) {
      const existing = this.locks.get(name)
      if (existing && (existing.mode === 'exclusive' || mode === 'exclusive')) {
        return cb(null)
      }
    }

    // 等待获取锁
    await this.acquireLock(name, mode)

    const lock: Lock = { name, mode }

    try {
      return await cb(lock)
    } finally {
      this.releaseLock(name, mode)
    }
  }

  private async acquireLock(name: string, mode: 'exclusive' | 'shared'): Promise<void> {
    const existing = this.locks.get(name)

    if (!existing) {
      // 没有现有锁，直接获取
      this.locks.set(name, { mode, count: 1, queue: [] })
      return
    }

    // 共享锁可以与其他共享锁共存
    if (mode === 'shared' && existing.mode === 'shared') {
      existing.count++
      return
    }

    // 需要等待
    return new Promise<void>((resolve) => {
      existing.queue.push(resolve)
    })
  }

  private releaseLock(name: string, _mode: 'exclusive' | 'shared'): void {
    const existing = this.locks.get(name)
    if (!existing) return

    existing.count--

    if (existing.count <= 0) {
      // 处理等待队列中的下一个
      const next = existing.queue.shift()
      if (next) {
        existing.count = 1
        next()
      } else {
        this.locks.delete(name)
      }
    }
  }

  async query(): Promise<LockManagerSnapshot> {
    const held: LockInfo[] = []
    
    this.locks.forEach((value, name) => {
      for (let i = 0; i < value.count; i++) {
        held.push({ name, mode: value.mode })
      }
    })

    return { held, pending: [] }
  }
}

/**
 * 安装 Web Locks Polyfill
 * 仅在 navigator.locks 不可用时安装
 */
export function installWebLocksPolyfill(): void {
  if (typeof navigator === 'undefined') {
    return
  }

  if ('locks' in navigator && navigator.locks) {
    console.log('[WebLocks] Native API available')
    return
  }

  console.warn('[WebLocks] Native API not available, installing polyfill...')
  console.warn('[WebLocks] This is a development-only polyfill with limitations:')
  console.warn('[WebLocks] - No cross-tab lock synchronization')
  console.warn('[WebLocks] - For production, use HTTPS or localhost')

  // 安装 polyfill
  Object.defineProperty(navigator, 'locks', {
    value: new PolyfillLockManager(),
    writable: false,
    configurable: true
  })

  console.log('[WebLocks] Polyfill installed successfully')
}

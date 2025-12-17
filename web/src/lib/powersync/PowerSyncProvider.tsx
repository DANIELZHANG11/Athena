/**
 * PowerSync Provider - App-First 核心同步引擎
 *
 * 职责：
 * - 初始化 PowerSync 客户端与 SQLite 数据库
 * - 管理认证凭证与 JWT Token 交互
 * - 提供 React Context 供全局使用
 * - 支持 Feature Flag 控制的渐进式切换
 *
 * 依赖：
 * - @powersync/web - PowerSync Web SDK
 * - @powersync/react - React 绑定
 * - @journeyapps/wa-sqlite - SQLite WASM 实现
 *
 * @see 09 - APP-FIRST架构改造计划.md Phase 2
 */

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, ReactNode } from 'react'
import { PowerSyncDatabase, WASQLitePowerSyncDatabaseOpenFactory, AbstractPowerSyncDatabase } from '@powersync/web'
import { PowerSyncContext } from '@powersync/react'
import { useAuthStore } from '@/stores/auth'
import { AppSchema } from './schema'

// App-First 架构：PowerSync 始终启用，不再使用 Feature Flag

// ============================================================================
// 类型定义
// ============================================================================

interface PowerSyncProviderProps {
  children: ReactNode
}

interface PowerSyncState {
  /** PowerSync 数据库实例 */
  db: AbstractPowerSyncDatabase | null
  /** 连接状态 */
  isConnected: boolean
  /** 初始化状态 */
  isInitialized: boolean
  /** 同步状态 */
  isSyncing: boolean
  /** 最后同步时间 */
  lastSyncedAt: Date | null
  /** 错误信息 */
  error: Error | null
}

interface PowerSyncContextValue extends PowerSyncState {
  /** 手动触发同步 */
  triggerSync: () => Promise<void>
  /** 断开连接 */
  disconnect: () => Promise<void>
  /** 重新连接 */
  reconnect: () => Promise<void>
  /** 清除本地数据 */
  clearLocalData: () => Promise<void>
}

// ============================================================================
// Context
// ============================================================================

const PowerSyncStateContext = createContext<PowerSyncContextValue | null>(null)

// ============================================================================
// 自定义 Connector
// ============================================================================

/**
 * PowerSync Connector - 处理认证和上传
 */
class AthenaConnector {
  private getAccessToken: () => string | null
  private refreshToken: () => Promise<boolean>
  private powersyncUrl: string

  constructor(
    getAccessToken: () => string | null,
    refreshToken: () => Promise<boolean>
  ) {
    this.getAccessToken = getAccessToken
    this.refreshToken = refreshToken
    this.powersyncUrl = import.meta.env.VITE_POWERSYNC_URL || 'http://localhost:8090'
  }

  /**
   * 获取 PowerSync 凭证
   */
  async fetchCredentials() {
    let token = this.getAccessToken()
    
    // 如果没有 token 或 token 过期，尝试刷新
    if (!token) {
      console.log('[PowerSync] No token, attempting refresh...')
      const refreshed = await this.refreshToken()
      if (refreshed) {
        token = this.getAccessToken()
      }
    }

    if (!token) {
      throw new Error('No authentication token available')
    }

    return {
      endpoint: this.powersyncUrl,
      token
    }
  }

  /**
   * 上传本地变更到后端
   * 当 SQLite 有本地写入时触发
   */
  async uploadData(database: PowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction()
    
    if (!transaction) {
      return
    }

    try {
      const token = this.getAccessToken()
      if (!token) {
        throw new Error('No authentication token for upload')
      }

      const operations = transaction.crud

      if (operations.length === 0) {
        await transaction.complete()
        return
      }

      console.log(`[PowerSync] Uploading ${operations.length} operations...`)
      console.log(`[PowerSync] Operations:`, JSON.stringify(operations.map(op => ({
        table: op.table,
        op: op.op,
        id: op.id,
        data: op.opData
      })), null, 2))

      // 批量发送到后端 API
      const response = await fetch('/api/v1/sync/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          operations: operations.map(op => ({
            table: op.table,
            op: op.op,
            id: op.id,
            data: op.opData
          }))
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(
          `Upload failed: ${response.status} - ${errorData.message || response.statusText}`
        )
      }

      // 标记事务完成
      await transaction.complete()
      console.log('[PowerSync] Upload completed successfully')

    } catch (error) {
      console.error('[PowerSync] Upload error:', error)
      // 不标记完成，PowerSync 会重试
      throw error
    }
  }
}

// ============================================================================
// Provider 组件
// ============================================================================

export function PowerSyncProvider({ children }: PowerSyncProviderProps) {
  const [state, setState] = useState<PowerSyncState>({
    db: null,
    isConnected: false,
    isInitialized: false,
    isSyncing: false,
    lastSyncedAt: null,
    error: null
  })

  // 从 auth store 获取认证方法
  const refreshAccessToken = useAuthStore(s => s.refreshAccessToken)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)

  // 创建 connector
  const connector = useMemo(() => {
    return new AthenaConnector(
      () => useAuthStore.getState().accessToken,
      refreshAccessToken
    )
  }, [refreshAccessToken])

  // 初始化 PowerSync (始终执行)
  useEffect(() => {
    let db: AbstractPowerSyncDatabase | null = null
    let mounted = true

    const initPowerSync = async () => {
      try {
        console.log('[PowerSync] Initializing...')

        // 创建数据库工厂
        const factory = new WASQLitePowerSyncDatabaseOpenFactory({
          dbFilename: 'athena.sqlite',
          schema: AppSchema,
          flags: {
            enableMultiTabs: false, // 禁用多标签页支持（避免 Web Locks 问题）
            useWebWorker: false     // 禁用 Web Worker（开发环境兼容）
          }
        })

        // 打开数据库
        db = await factory.getInstance()

        if (!mounted) {
          await db.close()
          return
        }

        console.log('[PowerSync] Database opened successfully')

        setState(prev => ({
          ...prev,
          db,
          isInitialized: true,
          error: null
        }))

        // 如果已认证，开始同步
        if (isAuthenticated) {
          await db.connect(connector)
          if (mounted) {
            setState(prev => ({ ...prev, isConnected: true }))
            console.log('[PowerSync] Connected and syncing')
          }
        }

      } catch (error) {
        console.error('[PowerSync] Initialization error:', error)
        if (mounted) {
          setState(prev => ({
            ...prev,
            error: error instanceof Error ? error : new Error(String(error)),
            isInitialized: true
          }))
        }
      }
    }

    initPowerSync()

    return () => {
      mounted = false
      if (db) {
        db.disconnect()
        db.close()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 只在组件挂载时初始化一次

  // 认证状态变化时连接/断开
  useEffect(() => {
    if (!state.db || !state.isInitialized) return

    const handleAuthChange = async () => {
      if (isAuthenticated && !state.isConnected) {
        try {
          await state.db!.connect(connector)
          setState(prev => ({ ...prev, isConnected: true, error: null }))
          console.log('[PowerSync] Connected after auth')
        } catch (error) {
          console.error('[PowerSync] Connect error:', error)
          setState(prev => ({
            ...prev,
            error: error instanceof Error ? error : new Error(String(error))
          }))
        }
      } else if (!isAuthenticated && state.isConnected) {
        await state.db!.disconnect()
        setState(prev => ({ ...prev, isConnected: false }))
        console.log('[PowerSync] Disconnected after logout')
      }
    }

    handleAuthChange()
  }, [isAuthenticated, state.db, state.isInitialized, state.isConnected, connector, setState])

  // 监听同步状态
  useEffect(() => {
    if (!state.db) return

    const unsubscribe = state.db.registerListener({
      statusChanged: (status: { connected: boolean; lastSyncedAt?: Date }) => {
        setState(prev => ({
          ...prev,
          isConnected: status.connected,
          lastSyncedAt: status.lastSyncedAt ?? prev.lastSyncedAt
        }))
      }
    })

    return () => unsubscribe?.()
  }, [state.db])

  // ============================================================================
  // Context Actions
  // ============================================================================

  const triggerSync = useCallback(async () => {
    if (!state.db || !state.isConnected) {
      console.warn('[PowerSync] Cannot sync: not connected')
      return
    }
    // PowerSync 自动同步，这里可以触发强制同步
    console.log('[PowerSync] Manual sync triggered')
  }, [state.db, state.isConnected])

  const disconnect = useCallback(async () => {
    if (state.db) {
      await state.db.disconnect()
      setState(prev => ({ ...prev, isConnected: false }))
    }
  }, [state.db])

  const reconnect = useCallback(async () => {
    if (state.db && !state.isConnected && isAuthenticated) {
      try {
        await state.db.connect(connector)
        setState(prev => ({ ...prev, isConnected: true, error: null }))
      } catch (error) {
        setState(prev => ({
          ...prev,
          error: error instanceof Error ? error : new Error(String(error))
        }))
      }
    }
  }, [state.db, state.isConnected, isAuthenticated, connector])

  const clearLocalData = useCallback(async () => {
    if (state.db) {
      await state.db.disconnectAndClear()
      setState(prev => ({
        ...prev,
        isConnected: false,
        lastSyncedAt: null
      }))
      console.log('[PowerSync] Local data cleared')
    }
  }, [state.db])

  // ============================================================================
  // Context Value
  // ============================================================================

  const contextValue: PowerSyncContextValue = useMemo(() => ({
    ...state,
    triggerSync,
    disconnect,
    reconnect,
    clearLocalData
  }), [state, triggerSync, disconnect, reconnect, clearLocalData])

  // 行业最佳实践：在数据库就绪前显示加载状态
  // 这样子组件中的 useQuery 就不需要每个都检查 isReady
  if (!state.isInitialized || !state.db) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground text-sm">正在初始化本地数据库...</p>
        </div>
      </div>
    )
  }

  // App-First: 始终使用 PowerSync Provider
  return (
    <PowerSyncContext.Provider value={state.db}>
      <PowerSyncStateContext.Provider value={contextValue}>
        {children}
      </PowerSyncStateContext.Provider>
    </PowerSyncContext.Provider>
  )
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * 获取 PowerSync 状态和操作
 */
export function usePowerSyncState(): PowerSyncContextValue {
  const context = useContext(PowerSyncStateContext)
  if (!context) {
    throw new Error('usePowerSyncState must be used within a PowerSyncProvider')
  }
  return context
}

/**
 * 获取 PowerSync 数据库实例
 */
export function usePowerSyncDatabase(): AbstractPowerSyncDatabase | null {
  const context = useContext(PowerSyncStateContext)
  return context?.db ?? null
}

/**
 * App-First 模式始终启用
 * 保留此 Hook 是为了向后兼容
 */
export function useIsAppFirstEnabled(): boolean {
  // App-First 架构已完全启用，始终返回 true
  return true
}

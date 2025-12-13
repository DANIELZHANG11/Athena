/**
 * PowerSync 模块统一导出
 *
 * App-First 架构核心同步引擎
 * 提供实时响应式数据查询和离线优先同步能力
 *
 * @see 09 - APP-FIRST架构改造计划.md Phase 2
 */

// Provider
export {
  PowerSyncProvider,
  usePowerSyncState,
  usePowerSyncDatabase,
  useIsAppFirstEnabled
} from './PowerSyncProvider'

// Schema
export { AppSchema } from './schema'

// Hooks
export * from './hooks'

// Re-export PowerSync React hooks for convenience
export { useQuery, useStatus } from '@powersync/react'

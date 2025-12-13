/**
 * featureFlags.ts - 功能开关配置 (App-First 版本)
 *
 * App-First 架构已完全启用，此文件仅保留调试相关功能
 *
 * @see 09 - APP-FIRST架构改造计划.md
 * @version 2.0.0 - App-First 完全体
 */

// ============ 环境变量读取 ============

/**
 * 从环境变量读取布尔值
 */
function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = import.meta.env[key]
  if (value === undefined || value === null || value === '') {
    return defaultValue
  }
  return ['true', '1', 'yes'].includes(String(value).toLowerCase())
}

/**
 * 从 localStorage 读取覆盖值（用于 QA 调试）
 */
function getLocalStorageOverride(key: string): boolean | null {
  if (typeof window === 'undefined') return null
  const value = localStorage.getItem(key)
  if (value === null) return null
  return ['true', '1', 'yes'].includes(value.toLowerCase())
}

// ============ Feature Flags 定义 ============

/**
 * Feature Flag 配置接口
 */
export interface FeatureFlags {
  /**
   * PowerSync 调试模式
   * - 开启后会在控制台输出详细的同步日志
   * @default false (生产环境), true (开发环境)
   */
  POWERSYNC_DEBUG: boolean

  /**
   * 实验性功能：离线 AI 摘要
   * @default false
   */
  OFFLINE_AI_ENABLED: boolean
}

/**
 * Feature Flags 单例
 */
class FeatureFlagsManager {
  private static instance: FeatureFlagsManager
  private flags: FeatureFlags

  private constructor() {
    this.flags = this.loadFlags()
  }

  static getInstance(): FeatureFlagsManager {
    if (!FeatureFlagsManager.instance) {
      FeatureFlagsManager.instance = new FeatureFlagsManager()
    }
    return FeatureFlagsManager.instance
  }

  private loadFlags(): FeatureFlags {
    return {
      // 开发环境默认开启调试
      POWERSYNC_DEBUG:
        getLocalStorageOverride('ATHENA_POWERSYNC_DEBUG') ??
        getEnvBoolean('VITE_POWERSYNC_DEBUG', import.meta.env.DEV),

      // 实验性功能默认关闭
      OFFLINE_AI_ENABLED:
        getLocalStorageOverride('ATHENA_OFFLINE_AI_ENABLED') ??
        getEnvBoolean('VITE_OFFLINE_AI_ENABLED', false),
    }
  }

  /**
   * 获取所有 Feature Flags
   */
  getFlags(): Readonly<FeatureFlags> {
    return Object.freeze({ ...this.flags })
  }

  /**
   * 获取单个 Flag 值
   */
  getFlag<K extends keyof FeatureFlags>(key: K): FeatureFlags[K] {
    return this.flags[key]
  }

  /**
   * 设置 localStorage 覆盖（仅用于 QA 调试）
   */
  setOverride<K extends keyof FeatureFlags>(key: K, value: FeatureFlags[K]): void {
    if (typeof window === 'undefined') return
    const storageKey = `ATHENA_${key}`
    localStorage.setItem(storageKey, String(value))
    this.flags[key] = value
    console.log(`[FeatureFlags] ${key} overridden to ${value}`)
  }

  /**
   * 清除 localStorage 覆盖
   */
  clearOverride<K extends keyof FeatureFlags>(key: K): void {
    if (typeof window === 'undefined') return
    const storageKey = `ATHENA_${key}`
    localStorage.removeItem(storageKey)
    this.flags = this.loadFlags()
    console.log(`[FeatureFlags] ${key} override cleared`)
  }

  /**
   * 打印当前 Feature Flags 状态（调试用）
   */
  logStatus(): void {
    console.group('[FeatureFlags] Current Status')
    console.log('Architecture: App-First (PowerSync + SQLite)')
    console.log('POWERSYNC_DEBUG:', this.flags.POWERSYNC_DEBUG)
    console.log('OFFLINE_AI_ENABLED:', this.flags.OFFLINE_AI_ENABLED)
    console.groupEnd()
  }
}

// ============ 导出 ============

/**
 * Feature Flags 管理器实例
 */
export const featureFlags = FeatureFlagsManager.getInstance()

/**
 * 便捷访问当前 Flags
 */
export const flags = featureFlags.getFlags()

// 开发环境下在控制台输出状态
if (import.meta.env.DEV) {
  setTimeout(() => {
    featureFlags.logStatus()
  }, 100)
}

// 暴露到 window 对象供 QA 调试
if (typeof window !== 'undefined') {
  // @ts-expect-error - 调试用全局变量
  window.__ATHENA_FEATURE_FLAGS__ = featureFlags
}

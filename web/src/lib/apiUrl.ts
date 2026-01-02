/**
 * API URL 配置（无依赖版本）
 * 
 * 用于需要避免循环依赖的场景（如 auth store）
 * 此模块不导入任何其他项目模块，避免循环依赖
 */

// 检测是否在 Capacitor 原生环境中运行
// 注意：必须使用函数调用形式，避免在构建时被优化掉
function checkCapacitorNative(): boolean {
    if (typeof window === 'undefined') return false
    const cap = (window as any).Capacitor
    if (!cap) return false
    if (typeof cap.isNativePlatform === 'function') {
        return cap.isNativePlatform()
    }
    return false
}

// 获取 API 基础 URL（不含 /api 前缀）
// 注意：这个函数必须在运行时计算，不能被静态分析优化
function computeApiHost(): string {
    // 检查是否是 Capacitor 原生环境
    const isNative = checkCapacitorNative()
    console.log('[API] isCapacitorNative:', isNative)

    if (isNative) {
        // Capacitor 原生环境：优先使用环境变量
        try {
            const envApiUrl = import.meta.env?.VITE_API_BASE_URL
            // 只有当环境变量是完整 URL（http 开头）时才使用
            if (envApiUrl && envApiUrl.startsWith('http')) {
                console.log('[API] Using env VITE_API_BASE_URL:', envApiUrl)
                return envApiUrl
            }
        } catch {
            // 环境变量不可用
        }

        // 默认使用 localhost:48000（需要配置 adb reverse tcp:48000 tcp:48000）
        console.log('[API] Using localhost:48000 for Capacitor native')
        return 'http://localhost:48000'
    }

    // Web 环境：使用相对路径（通过 Vite 代理）
    console.log('[API] Using relative path for web')
    return ''
}

// 导出检测函数
export const isCapacitorNative = checkCapacitorNative

// 导出平台检测
export const getCapacitorPlatform = (): string | null => {
    if (typeof window === 'undefined') return null
    return (window as any).Capacitor?.getPlatform?.() || null
}

// 缓存 API host，但仅在第一次调用后
let _cachedApiHost: string | null = null

export const getApiHost = (): string => {
    if (_cachedApiHost === null) {
        _cachedApiHost = computeApiHost()
    }
    return _cachedApiHost
}

/**
 * 获取完整的 API URL
 * @param path API 路径，例如 '/api/v1/auth/refresh'
 */
export const getFullApiUrl = (path: string): string => {
    const host = getApiHost()
    const url = host + path
    return url
}

/**
 * 封装 fetch，自动添加正确的 baseURL
 */
export const apiFetch = (path: string, options?: RequestInit): Promise<Response> => {
    const url = getFullApiUrl(path)
    console.log('[apiFetch]', options?.method || 'GET', url)
    return fetch(url, options)
}

/**
 * ProfilePage - 个人资料页面
 *
 * 用途：
 * - 获取并展示当前用户资料（昵称）
 * - 通过 `ETag` 并发控制更新昵称后刷新展示
 * - 【离线支持】首次加载时从 IndexedDB 读取缓存
 *
 * @see App-First改造计划.md
 */
import { useState, useEffect, useCallback } from 'react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { useTranslation } from 'react-i18next'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { WifiOff, RefreshCw, User } from 'lucide-react'

interface CachedProfile {
  id: string
  email: string
  display_name: string
  tier: string
  role: string
  created_at: string
  etag?: string
  cached_at?: number
}

export default function ProfilePage() {
  const { t } = useTranslation()
  const isOnline = useOnlineStatus()
  const [profile, setProfile] = useState<CachedProfile | null>(null)
  const [etag, setEtag] = useState<string>('W/"1"')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [fromCache, setFromCache] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 从 API 获取资料
  const fetchProfile = useCallback(async () => {
    if (!isOnline) {
      setError(t('common.offline', '当前处于离线状态'))
      return
    }

    setLoading(true)
    setError(null)

    try {
      const at = localStorage.getItem('access_token')
      const res = await fetch('/api/v1/profile/me', {
        headers: { Authorization: `Bearer ${at}` },
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const j = await res.json()
      const profileData = j.data

      // 更新状态
      setProfile(profileData)
      setEtag(profileData.etag || 'W/"1"')
      setDisplayName(profileData.display_name || '')
      setFromCache(false)

      // 保存到缓存
      const cacheData = { ...profileData, cached_at: Date.now() }
      localStorage.setItem('profile_cache', JSON.stringify(cacheData))
    } catch (err) {
      console.error('[ProfilePage] Fetch failed:', err)
      setError(t('profile.fetchError', '获取资料失败'))
    } finally {
      setLoading(false)
    }
  }, [isOnline, t])

  // 从缓存加载
  const loadFromCache = useCallback(async () => {
    try {
      const stored = localStorage.getItem('profile_cache')
      if (stored) {
        const cached = JSON.parse(stored) as CachedProfile
        setProfile(cached)
        setEtag(cached.etag || 'W/"1"')
        setDisplayName(cached.display_name || '')
        setFromCache(true)
        console.log('[ProfilePage] Loaded from cache')
        return true
      }
    } catch (err) {
      console.error('[ProfilePage] Cache load failed:', err)
    }
    return false
  }, [])

  // 初始加载：先读缓存，再尝试网络
  useEffect(() => {
    const init = async () => {
      // 先尝试从缓存加载
      const hasCache = await loadFromCache()

      // 如果在线，尝试获取最新数据
      if (isOnline) {
        await fetchProfile()
      } else if (!hasCache) {
        setError(t('profile.noCache', '离线状态且无缓存数据'))
      }
    }

    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 只在挂载时执行

  // 网络恢复时刷新
  useEffect(() => {
    if (isOnline && fromCache) {
      fetchProfile()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline])

  // 保存资料
  const handleSave = async () => {
    if (!isOnline) {
      setError(t('common.offline', '离线状态无法保存'))
      return
    }

    setLoading(true)
    try {
      const at = localStorage.getItem('access_token')
      const updateRes = await fetch('/api/v1/profile/me', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${at}`,
          'If-Match': etag,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ display_name: displayName }),
      })

      if (!updateRes.ok) {
        throw new Error(`Update failed: ${updateRes.status}`)
      }

      // 重新获取最新数据
      await fetchProfile()
    } catch (err) {
      console.error('[ProfilePage] Save failed:', err)
      setError(t('profile.saveError', '保存失败'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 max-w-md mx-auto">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="typography-large-title flex items-center gap-2">
          <User className="w-6 h-6" />
          {t('profile.title')}
        </h1>

        {/* 离线状态指示器 */}
        {!isOnline && (
          <div className="flex items-center gap-1 text-amber-600 text-sm">
            <WifiOff className="w-4 h-4" />
            <span>{t('common.offline', '离线')}</span>
          </div>
        )}
      </div>

      {/* 缓存提示 */}
      {fromCache && (
        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-700 dark:text-amber-300">
          {t('profile.fromCache', '显示缓存数据')}
          {profile?.cached_at && (
            <span className="ml-2 text-xs opacity-70">
              ({new Date(profile.cached_at).toLocaleString()})
            </span>
          )}
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* 获取资料按钮 */}
      {!profile && (
        <Button
          onClick={fetchProfile}
          disabled={loading || !isOnline}
          className="mb-4"
        >
          {loading ? (
            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
          ) : null}
          {t('profile.get')}
        </Button>
      )}

      {/* 资料表单 */}
      {profile && (
        <div className="space-y-4">
          {/* 邮箱（只读） */}
          <div>
            <label className="block text-sm font-medium mb-1 text-muted-foreground">
              {t('profile.email', '邮箱')}
            </label>
            <Input
              value={profile.email || ''}
              disabled
              className="bg-muted"
            />
          </div>

          {/* 昵称（可编辑） */}
          <div>
            <label className="block text-sm font-medium mb-1">
              {t('profile.name')}
            </label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={!isOnline}
              placeholder={t('profile.namePlaceholder', '输入昵称')}
            />
          </div>

          {/* 会员等级（只读） */}
          <div>
            <label className="block text-sm font-medium mb-1 text-muted-foreground">
              {t('profile.tier', '会员等级')}
            </label>
            <Input
              value={profile.tier || 'free'}
              disabled
              className="bg-muted capitalize"
            />
          </div>

          {/* 保存按钮 */}
          <Button
            onClick={handleSave}
            disabled={loading || !isOnline}
            className="w-full"
          >
            {loading ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : null}
            {t('profile.save')}
          </Button>

          {/* 刷新按钮 */}
          <Button
            variant="outline"
            onClick={fetchProfile}
            disabled={loading || !isOnline}
            className="w-full"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            {t('profile.refresh', '刷新')}
          </Button>
        </div>
      )}
    </div>
  )
}

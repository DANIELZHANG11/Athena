import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { Home, Library, Bot, Search } from 'lucide-react'
import { useState, useEffect } from 'react'
import { OfflineIndicator } from '@/components/OfflineIndicator'
import { UpdatePrompt } from '@/components/UpdatePrompt'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { getSyncQueueCount } from '@/lib/syncStorage'
import { toast } from '@/components/ui/sonner'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import { TTSMiniPlayer, TTSPlayerOverlay, TTSSettingsSheet } from '@/components/tts'
import { useTTSPlayState } from '@/stores/tts'

/**
 * 应用区布局（登录后）
 *
 * 说明：
 * - 底部固定导航栏（移动端 Tab Bar 样式）
 * - 顶部 header 已移除，个人信息入口由各页面自行处理
 * - 使用 `Outlet` 承载子路由页面
 * - `NavItem` 支持选中状态的椭圆背景与加粗图标
 * - 集成离线状态指示器
 */
export default function AppLayout() {
  const { t } = useTranslation('common')
  const loc = useLocation()
  const active = (p: string) => loc.pathname.startsWith(p)

  // 待同步项数量
  const [pendingCount, setPendingCount] = useState(0)

  // TTS 全局状态
  const ttsPlayState = useTTSPlayState()
  const isTTSActive = ttsPlayState !== 'idle'
  const [showTTSOverlay, setShowTTSOverlay] = useState(false)
  const [showTTSSettings, setShowTTSSettings] = useState(false)

  // 网络状态监听，在线/离线切换时显示 toast
  const { isOnline } = useOnlineStatus({
    onOnline: () => {
      toast.success(t('offline.reconnected_syncing', '网络已恢复，正在同步...'))
    },
    onOffline: () => {
      toast.warning(t('offline.disconnected', '网络已断开，进入离线模式'))
    },
  })

  // 定期更新待同步项数量
  useEffect(() => {
    const updatePendingCount = async () => {
      try {
        const count = await getSyncQueueCount()
        setPendingCount(count)
      } catch (e) {
        console.error('[AppLayout] Failed to get sync queue count:', e)
      }
    }

    // 立即更新一次
    updatePendingCount()

    // 每 5 秒更新一次
    const interval = setInterval(updatePendingCount, 5000)

    return () => clearInterval(interval)
  }, [])

  // 判断是否在阅读页面
  const isReaderPage = loc.pathname.startsWith('/app/read/')

  // 阅读页面时完全隐藏底部导航栏
  // 用户只能通过阅读器顶部的返回按钮离开，这确保会话能正确关闭
  const isNavVisible = !isReaderPage


  // 导航项组件
  const NavItem = ({ to, icon: Icon, isActive }: { to: string, icon: typeof Home, isActive: boolean }) => (
    <NavLink to={to} className="flex items-center justify-center p-2">
      <div className={cn(
        "relative flex items-center justify-center transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
        // 基础样式：圆形/椭圆，阴影，背景
        // 移除边框 (border border-gray-100 dark:border-gray-700)
        "bg-white dark:bg-gray-800 shadow-md hover:shadow-xl",
        // 形状：移动端圆形，桌面端椭圆
        "w-12 h-12 rounded-full md:w-24 md:h-12",
        // 选中状态：移除蓝色光环，增加轻微缩放
        isActive ? "scale-105 shadow-lg" : "scale-100"
      )}>
        <Icon
          className="w-6 h-6 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
          // 选中：黑色(Label色)，未选中：灰色
          color={isActive ? 'var(--label)' : 'var(--secondary-label)'}
          // 选中：加粗线条 (3)
          strokeWidth={isActive ? 3 : 1.5}
        />
      </div>
    </NavLink>
  )

  return (
    <div className="bg-system-background min-h-screen font-ui overflow-x-hidden w-full max-w-full">
      {/* 离线状态指示器 */}
      <OfflineIndicator pendingCount={pendingCount} />

      {/* PWA 更新提示 */}
      <UpdatePrompt />

      {/* 阅读页面不需要 pb-24，因为导航栏是沉浸式隐藏的 */}
      {/* TTS 激活时非阅读页需要额外 pb-14 给 MiniPlayer 留空间 */}
      <main className={cn(
        'bg-system-background w-full max-w-full overflow-x-hidden',
        !isOnline && 'pt-10',
        !isReaderPage && 'pb-24',
        !isReaderPage && isTTSActive && 'pb-38'
      )}>
        <Outlet />
      </main>

      {/* TTS Mini Player - 全局显示（阅读页除外，阅读页有自己的播放器） */}
      {isTTSActive && !isReaderPage && (
        <TTSMiniPlayer 
          onExpand={() => setShowTTSOverlay(true)}
          className="bottom-24"
        />
      )}

      {/* TTS 全屏播放器覆盖层 */}
      {showTTSOverlay && (
        <TTSPlayerOverlay
          onClose={() => setShowTTSOverlay(false)}
          onOpenSettings={() => setShowTTSSettings(true)}
        />
      )}

      {/* TTS 设置面板 */}
      {showTTSSettings && (
        <TTSSettingsSheet onClose={() => setShowTTSSettings(false)} />
      )}

      <motion.nav
        initial={false}
        animate={{ y: isNavVisible ? 0 : '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* 
           容器：
           - 移除背景色和模糊，改为透明
           - 内部元素 pointer-events-auto 恢复点击
        */}
        <div className="max-w-4xl mx-auto px-6 h-24 flex items-center justify-between pointer-events-auto">
          <NavItem to="/app/home" icon={Home} isActive={active('/app/home')} />
          <NavItem to="/app/library" icon={Library} isActive={active('/app/library')} />
          <NavItem to="/app/ai-conversations" icon={Bot} isActive={active('/app/ai') || active('/app/ai-conversations')} />
          <NavItem to="/app/search" icon={Search} isActive={active('/app/search')} />
        </div>
      </motion.nav>
    </div>
  )
}

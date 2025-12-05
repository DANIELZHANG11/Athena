import { Outlet, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useTolgeeLanguages } from '../hooks/useTolgeeLanguages'
import { useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog'
import Login from '../pages/auth/Login'

/**
 * 着陆页布局（公共区域）
 *
 * 说明：
 * - 顶部具备语言切换与登录弹窗入口
 * - 语言来源优先 Tolgee，其次回退到预设列表
 * - 子页面通过 `Outlet` 渲染
 */
export default function LandingLayout() {
  const { t, i18n } = useTranslation('landing')
  const [showAuthDialog, setShowAuthDialog] = useState(false)
  const langs = useTolgeeLanguages()

  // 语言名称映射
  const languageNames: Record<string, string> = {
    'en-US': 'English',
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
    'ja': '日本語',
    'ko': '한국어',
    'fr': 'Français',
    'de': 'Deutsch',
    'es': 'Español'
  }

  // 为语言列表添加显示名称
  const displayLangs = (langs.length ? langs : [
    { code: 'en-US', name: 'English' },
    { code: 'zh-CN', name: '简体中文' }
  ]).map(l => ({
    ...l,
    name: l.name || languageNames[l.code] || l.code
  }))

  return (
    <div className="bg-system-background min-h-screen font-ui">
      <header className="sticky top-0 z-50 border-b border-separator" style={{
        backdropFilter: 'blur(20px) saturate(180%)',
        backgroundColor: 'rgba(255, 255, 255, 0.72)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)'
      }}>
        <div className="mx-auto max-w-[1200px] px-4 py-3 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <img src="/logosvg.png" alt="Athena" className="w-8 h-8 rounded-md object-contain" />
            <div className="font-semibold text-gray-900 text-base">Athena</div>
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <select
              className="px-3 py-1.5 rounded-lg bg-white text-gray-900 border border-gray-300 text-sm shadow-sm hover:border-gray-400 transition-colors"
              value={i18n.language}
              onChange={async (e) => {
                const newLang = e.target.value
                console.log('🌍 Switching to language:', newLang)
                await i18n.changeLanguage(newLang)
                console.log('✅ Language switched to:', newLang)
              }}
            >
              {displayLangs.map((l) => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
            <button
              onClick={() => setShowAuthDialog(true)}
              className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium shadow-sm transition-all"
            >
              {t('hero.cta_login')}
            </button>
          </div>
        </div>
      </header>
      <main className="bg-system-background">
        <Outlet />
      </main>

      <Dialog open={showAuthDialog} onOpenChange={setShowAuthDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="text-xl font-semibold mb-4">{t('hero.cta_login')}</DialogTitle>
          <Login />
        </DialogContent>
      </Dialog>
    </div>
  )
}

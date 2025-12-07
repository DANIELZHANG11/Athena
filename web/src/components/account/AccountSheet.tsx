/**
 * 账户菜单底部弹出层
 * 
 * 功能：
 * - 从底部升起的全屏菜单（移动端友好）
 * - 显示用户头像和账号信息
 * - 语言设置切换
 * - 退出登录
 * 
 * 设计规范：
 * - 遵循 UIUX 设计系统的 Liquid Glass 效果
 * - 使用 vaul Drawer 组件实现底部弹出
 */
import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ChevronRight, LogOut, User, Camera } from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { useNavigate } from 'react-router-dom'
import { useTolgeeLanguages } from '@/hooks/useTolgeeLanguages'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

interface AccountSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function AccountSheet({ open, onOpenChange }: AccountSheetProps) {
  const { t, i18n } = useTranslation('common')
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [showLanguageSelect, setShowLanguageSelect] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  // 获取当前语言显示名称
  const currentLanguageName = displayLangs.find(l => l.code === i18n.language)?.name || i18n.language

  // 处理头像上传
  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // TODO: 上传到服务器并压缩为 WebP
    // 目前先使用本地预览
    const reader = new FileReader()
    reader.onload = (event) => {
      setAvatarUrl(event.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  // 处理退出登录
  const handleLogout = () => {
    logout()
    onOpenChange(false)
    navigate('/')
  }

  // 处理语言切换
  const handleLanguageChange = async (langCode: string) => {
    await i18n.changeLanguage(langCode)
    setShowLanguageSelect(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="bottom" 
        className="h-full rounded-t-3xl backdrop-blur-xl border-t border-separator"
        style={{ backgroundColor: 'rgba(242, 242, 247, 0.75)' }}
      >
        {/* Header */}
        <SheetHeader className="relative px-4 pt-4 pb-2">
          <div className="absolute left-1/2 top-2 -translate-x-1/2 w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
          <div className="flex items-center justify-between mt-4">
            <SheetTitle className="text-lg font-semibold text-label">
              {t('account.title', '账户')}
            </SheetTitle>
            <button
              onClick={() => onOpenChange(false)}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-tertiary-background hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <X className="w-5 h-5 text-secondary-label" />
            </button>
          </div>
        </SheetHeader>

        <div className="px-4 py-4 space-y-4">
          {/* 用户信息卡片 */}
          <div className="bg-tertiary-background rounded-2xl p-4 flex items-center gap-4">
            {/* 头像 */}
            <div 
              className="relative w-16 h-16 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 flex-shrink-0 cursor-pointer group"
              onClick={handleAvatarClick}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <User className="w-8 h-8 text-secondary-label" />
                </div>
              )}
              {/* 相机图标悬浮层 */}
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="w-5 h-5 text-white" />
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
            </div>
            
            {/* 用户名和邮箱 */}
            <div className="flex-1 min-w-0">
              <div className="text-label font-semibold text-base truncate">
                {user?.display_name || t('account.unnamed', '未命名用户')}
              </div>
              <div className="text-secondary-label text-sm truncate">
                {user?.email || ''}
              </div>
            </div>
          </div>

          {/* 账户设置 - 语言选择 */}
          <div className="bg-tertiary-background rounded-2xl overflow-hidden">
            <button
              className="w-full p-4 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              onClick={() => setShowLanguageSelect(!showLanguageSelect)}
            >
              <span className="text-label font-medium">
                {t('account.settings', '账户设置')}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-secondary-label text-sm">{currentLanguageName}</span>
                <ChevronRight className={`w-5 h-5 text-secondary-label transition-transform ${showLanguageSelect ? 'rotate-90' : ''}`} />
              </div>
            </button>
            
            {/* 语言选择展开列表 */}
            {showLanguageSelect && (
              <div className="border-t border-separator">
                {displayLangs.map((lang) => (
                  <button
                    key={lang.code}
                    className={`w-full px-6 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-between ${
                      i18n.language === lang.code ? 'text-system-blue' : 'text-label'
                    }`}
                    onClick={() => handleLanguageChange(lang.code)}
                  >
                    <span>{lang.name}</span>
                    {i18n.language === lang.code && (
                      <span className="text-system-blue">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 退出登录 */}
          <button
            className="w-full bg-tertiary-background rounded-2xl p-4 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            onClick={handleLogout}
          >
            <span className="text-label font-medium">
              {t('account.logout', '退出登录')}
            </span>
            <LogOut className="w-5 h-5 text-secondary-label" />
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

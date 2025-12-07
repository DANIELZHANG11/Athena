/**
 * 可滚动渐隐的个人信息按钮
 * 
 * 功能：
 * - 显示用户头像（或默认图标）
 * - 滚动时渐隐消失，滚回顶部时渐显
 * - 点击打开账户菜单
 * 
 * 设计规范：
 * - 使用 framer-motion 实现平滑动画
 * - 遵循 UIUX 设计系统的圆角和阴影
 */
import { useState } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { User } from 'lucide-react'
import AccountSheet from './AccountSheet'

interface ProfileButtonProps {
  /** 自定义头像 URL */
  avatarUrl?: string
}

export default function ProfileButton({ avatarUrl }: ProfileButtonProps) {
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  
  // 监听滚动位置
  const { scrollY } = useScroll()
  
  // 滚动 0-60px 时从 1 渐变到 0
  const opacity = useTransform(scrollY, [0, 60], [1, 0])
  // 同时稍微上移
  const translateY = useTransform(scrollY, [0, 60], [0, -10])
  // 缩放效果
  const scale = useTransform(scrollY, [0, 60], [1, 0.8])

  return (
    <>
      <motion.button
        style={{ opacity, y: translateY, scale }}
        className="w-10 h-10 rounded-full shadow-md bg-white dark:bg-gray-800 overflow-hidden flex items-center justify-center border border-gray-100 dark:border-gray-700 hover:shadow-lg transition-shadow"
        onClick={() => setIsSheetOpen(true)}
        aria-label="Open account menu"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
        ) : (
          <User className="w-5 h-5 text-secondary-label" />
        )}
      </motion.button>

      <AccountSheet open={isSheetOpen} onOpenChange={setIsSheetOpen} />
    </>
  )
}

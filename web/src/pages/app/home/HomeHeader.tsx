/**
 * 阅读中页头
 * - Framer Motion 根据滚动渐隐主标题，显示顶栏小标题
 * - 右上角显示用户头像（带滚动渐隐效果）
 */
import { motion, useScroll, useTransform } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import ProfileButton from '@/components/account/ProfileButton'

export default function HomeHeader() {
  const { t } = useTranslation('common')
  const { scrollY } = useScroll()
  
  // 主标题滚动渐隐
  const titleOpacity = useTransform(scrollY, [0, 80], [1, 0])
  // 小标题渐显
  const smallOpacity = useTransform(scrollY, [40, 120], [0, 1])
  // 右上角元素滚动渐隐
  const rightOpacity = useTransform(scrollY, [0, 60], [1, 0])
  const rightScale = useTransform(scrollY, [0, 60], [1, 0.8])
  const rightTranslateY = useTransform(scrollY, [0, 60], [0, -10])

  return (
    <div className="relative pt-2 pb-4 font-ui">
      {/* 标题和右上角区域 */}
      <div className="flex items-start justify-between">
        <motion.h1
          style={{ opacity: titleOpacity, letterSpacing: '-0.025em' }}
          className="text-label text-4xl font-semibold"
        >
          {t('reading_now.title')}
        </motion.h1>
        
        {/* 右上角：用户头像 */}
        <motion.div 
          style={{ opacity: rightOpacity, scale: rightScale, y: rightTranslateY } as any}
          className="flex items-center"
        >
          <ProfileButton />
        </motion.div>
      </div>
      
      {/* 滚动后显示的小标题 */}
      <motion.div style={{ opacity: smallOpacity }} className="sticky top-0 z-30">
        <div className="flex items-center justify-center h-8">
          <span className="text-secondary-label text-xs uppercase tracking-wide">{t('reading_now.title')}</span>
        </div>
      </motion.div>
    </div>
  )
}

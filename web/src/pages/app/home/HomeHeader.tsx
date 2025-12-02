import { motion, useScroll, useTransform } from 'framer-motion'
import { useTranslation } from 'react-i18next'

export default function HomeHeader() {
  const { t } = useTranslation('common')
  const { scrollY } = useScroll()
  const opacity = useTransform(scrollY, [0, 80], [1, 0])
  const smallOpacity = useTransform(scrollY, [40, 120], [0, 1])
  return (
    <div className="relative pt-6 pb-4 font-ui">
      <motion.h1
        style={{ opacity, letterSpacing: '-0.025em' }}
        className="text-label text-4xl font-semibold"
      >
        {t('reading_now.title')}
      </motion.h1>
      <motion.div style={{ opacity: smallOpacity }} className="sticky top-0 z-30">
        <div className="flex items-center justify-center h-8">
          <span className="text-secondary-label text-xs uppercase tracking-wide">{t('reading_now.title')}</span>
        </div>
      </motion.div>
    </div>
  )
}

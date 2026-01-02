import { motion } from 'framer-motion'
import { useEffect } from 'react'
import DeviceShowcase from './DeviceShowcase'
import { useTranslation } from 'react-i18next'

export default function Hero() {
  const { t } = useTranslation('landing')
  useEffect(() => { const timer = setTimeout(() => { }, 2000); return () => clearTimeout(timer) }, [])
  return (
    <div className="relative bg-system-background text-label overflow-hidden pt-20 pb-0">
      <div className="max-w-6xl mx-auto px-6 text-center">
        <motion.div
          initial={{ scale: 5, y: 200, opacity: 1 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
          className="mb-12 flex justify-center"
        >
          <img src="/logosvg.png" alt="Athena Reader Logo" className="w-20 h-20 object-contain" />
        </motion.div>
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 1.3, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <h1 className="text-6xl md:text-7xl text-label mb-8 font-bold leading-[1.05] tracking-tight drop-shadow-lg">{t('hero.title')}</h1>
        </motion.div>
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 1.6, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="mb-20"
        >
          <p className="text-xl md:text-2xl text-secondary-label max-w-4xl mx-auto leading-relaxed">
            {t('hero.subtitle')}
          </p>
        </motion.div>
        <DeviceShowcase />
      </div>
    </div>
  )
}

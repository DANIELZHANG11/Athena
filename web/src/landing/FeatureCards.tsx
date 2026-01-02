import { motion } from 'framer-motion'
import { Cloud, Sparkles, FileText, Headphones } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function FeatureCards() {
  const { t } = useTranslation('landing')

  // 使用 CSS 变量定义的系统色
  const features = [
    { icon: <Cloud className="w-10 h-10" />, key: 'sync', accentClass: 'text-[var(--color-system-blue)]' },
    { icon: <Sparkles className="w-10 h-10" />, key: 'ai', accentClass: 'text-[var(--color-system-purple)]' },
    { icon: <FileText className="w-10 h-10" />, key: 'notes', accentClass: 'text-[var(--color-system-green)]' },
    { icon: <Headphones className="w-10 h-10" />, key: 'listen', accentClass: 'text-[var(--color-system-orange)]' },
  ]

  return (
    <div className="py-32 bg-system-background">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {features.map((feature, index) => (
            <motion.div key={index} initial={{ y: 80, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true, margin: '-100px' }} transition={{ duration: 0.8, delay: index * 0.15 }} className="bg-secondary-background rounded-3xl p-10 hover:bg-tertiary-background transition-colors group">
              <motion.div
                className="mb-6 inline-flex items-center justify-center w-20 h-20 md:w-24 md:h-24 rounded-full bg-system-background shadow-lg group-hover:shadow-xl transition-shadow"
                initial={{ y: -40, scale: 0.85, opacity: 0 }}
                whileInView={{ y: [-40, 0, -18, 0, -10, 0, -6, 0], scale: [0.85, 1, 1, 1, 1, 1, 1, 1], opacity: [0, 1, 1, 1, 1, 1, 1, 1] }}
                viewport={{ once: true, margin: '-100px' }}
                transition={{
                  y: { duration: 1.6, times: [0, 0.35, 0.55, 0.7, 0.82, 0.9, 0.96, 1], ease: 'easeOut', delay: 0.15 + index * 0.1 },
                  scale: { duration: 1.6, times: [0, 0.35, 0.55, 0.7, 0.82, 0.9, 0.96, 1], ease: 'easeOut', delay: 0.15 + index * 0.1 },
                  opacity: { duration: 1.6, times: [0, 0.35, 0.55, 0.7, 0.82, 0.9, 0.96, 1], ease: 'easeOut', delay: 0.15 + index * 0.1 }
                }}
                whileHover={{ y: [-2, -8, 0] }}
              >
                <div className={feature.accentClass}>{feature.icon}</div>
              </motion.div>
              <h3 className="text-3xl text-label mb-4 font-semibold">{t(`features.${feature.key}.title`)}</h3>
              <p className="text-lg text-secondary-label leading-relaxed">{t(`features.${feature.key}.description`)}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}
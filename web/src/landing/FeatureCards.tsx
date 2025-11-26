import { motion } from 'framer-motion'
import { Cloud, Sparkles, FileText, Headphones } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function FeatureCards() {
  const { t } = useTranslation('landing')

  const features = [
    { icon: <Cloud className="w-10 h-10" />, key: 'sync', accent: '#007AFF' },
    { icon: <Sparkles className="w-10 h-10" />, key: 'ai', accent: '#5856D6' },
    { icon: <FileText className="w-10 h-10" />, key: 'notes', accent: '#34C759' },
    { icon: <Headphones className="w-10 h-10" />, key: 'listen', accent: '#FF9500' },
  ]

  return (
    <div className="py-32 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {features.map((feature, index) => (
            <motion.div key={index} initial={{ y: 80, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true, margin: '-100px' }} transition={{ duration: 0.8, delay: index * 0.15 }} className="bg-gray-50 rounded-3xl p-10 hover:bg-gray-100 transition-colors group">
              <motion.div
                className="mb-6 inline-flex items-center justify-center w-20 h-20 md:w-24 md:h-24 rounded-full bg-white shadow-lg group-hover:shadow-xl transition-shadow"
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
                <div className="text-black">{feature.icon}</div>
              </motion.div>
              <h3 className="text-3xl text-gray-900 mb-4" style={{ fontWeight: 600 }}>{t(`features.${feature.key}.title`)}</h3>
              <p className="text-lg text-gray-600 leading-relaxed">{t(`features.${feature.key}.description`)}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}
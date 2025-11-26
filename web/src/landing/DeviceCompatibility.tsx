import { motion } from 'framer-motion'
import { Smartphone, Tablet, Monitor, Watch, Tv, Speaker } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function DeviceCompatibility() {
  const { t } = useTranslation('landing')

  const devices = [
    { icon: Smartphone, label: t('deviceCompatibility.devices.iphone') },
    { icon: Tablet, label: t('deviceCompatibility.devices.ipad') },
    { icon: Monitor, label: t('deviceCompatibility.devices.mac') },
    { icon: Watch, label: t('deviceCompatibility.devices.watch') },
    { icon: Tv, label: t('deviceCompatibility.devices.tv') },
    { icon: Speaker, label: t('deviceCompatibility.devices.carplay') },
  ]

  return (
    <div className="py-32 bg-gray-50">
      <div className="max-w-6xl mx-auto px-6">
        <motion.div initial={{ y: 60, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true, margin: '-100px' }} transition={{ duration: 0.8 }} className="text-center mb-20">
          <h2 className="text-5xl md:text-6xl text-gray-900 mb-6" style={{ fontWeight: 700, lineHeight: 1.1 }}>{t('deviceCompatibility.titleLine1')}</h2>
          <h2 className="text-5xl md:text-6xl text-gray-900 mb-8" style={{ fontWeight: 700, lineHeight: 1.1 }}>{t('deviceCompatibility.titleLine2')}</h2>
        </motion.div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8 md:gap-12">
          {devices.map((device, index) => {
            const Icon = device.icon
            return (
              <motion.div key={index} initial={{ y: 60, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true, margin: '-100px' }} transition={{ duration: 0.6, delay: index * 0.1 }} className="flex flex-col items-center text-center group">
                <div className="w-20 h-20 md:w-24 md:h-24 mb-4 flex items-center justify-center rounded-full bg-white shadow-lg group-hover:shadow-xl transition-shadow">
                  <Icon className="w-10 h-10 md:w-12 md:h-12 text-gray-700" />
                </div>
                <p className="text-lg text-gray-900" style={{ fontWeight: 600 }}>{device.label}</p>
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
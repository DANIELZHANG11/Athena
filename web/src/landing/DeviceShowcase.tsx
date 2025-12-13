import { motion, useScroll, useTransform } from 'framer-motion'
import { useRef } from 'react'

const deviceImages = [
  'https://images.unsplash.com/photo-1657639039662-9edac2e6a40b?w=300&h=650&fit=crop',
  'https://images.unsplash.com/photo-1683355879142-8a750ffa9ab6?w=300&h=650&fit=crop',
  'https://images.unsplash.com/photo-1589591872987-12784bb24d90?w=300&h=650&fit=crop',
  'https://images.unsplash.com/photo-1752079432635-12b7b68966ee?w=300&h=650&fit=crop',
  'https://images.unsplash.com/photo-1763013258650-c92b085726c4?w=300&h=650&fit=crop',
]

export default function DeviceShowcase() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: containerRef, offset: ['start end', 'end start'] })
  const device2Y = useTransform(scrollYProgress, [0.2, 0.6], [-60, 0])
  const device4Y = useTransform(scrollYProgress, [0.2, 0.6], [-60, 0])
  return (
    <div ref={containerRef} className="relative bg-white pb-20 overflow-visible">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex justify-center items-end gap-2 md:gap-3 relative">
          {deviceImages.map((image, index) => {
            let initialX = 0
            if (index === 0) initialX = -400
            if (index === 1) initialX = -200
            if (index === 3) initialX = 200
            if (index === 4) initialX = 400
            const initialY = 300
            return (
              <motion.div key={index} initial={{ x: initialX, y: initialY, opacity: 0 }} animate={{ x: 0, y: 0, opacity: 1 }} transition={{ duration: 1.4, delay: 2.0 + Math.abs(index - 2) * 0.12, ease: [0.22, 1, 0.36, 1] }} className="relative flex-shrink-0" style={{ width: '220px' }}>
                <motion.div
                  className="relative rounded-[38px] overflow-hidden"
                  style={{
                    y: index === 1 ? device2Y : index === 3 ? device4Y : 0,
                    height: '440px',
                    background: 'linear-gradient(180deg, #121314 0%, #0a0b0c 100%)',
                    boxShadow:
                      '0 18px 36px rgba(0,0,0,0.28), 0 8px 16px rgba(0,0,0,0.18), inset 0 0 0 1px rgba(255,255,255,0.04)'
                  } as any}
                >
                  <div className="absolute inset-0 rounded-[38px] z-10 pointer-events-none" style={{ boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.8), inset 0 1px 2px rgba(255,255,255,0.06)' }} />
                  <div className="absolute inset-0 rounded-[38px] border-[7px] border-black/95 z-10 pointer-events-none" />
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20" style={{ width: '88px', height: '26px', borderRadius: 9999, background: 'linear-gradient(180deg, #0b0c0d 0%, #000 100%)', boxShadow: 'inset 0 -2px 3px rgba(255,255,255,0.08), inset 0 0 0 1px rgba(255,255,255,0.06)' }} />
                  <div className="absolute inset-[7px] rounded-[32px] overflow-hidden">
                    <img src={image} alt={`Device ${index + 1}`} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 rounded-[32px] pointer-events-none" style={{ background: 'linear-gradient(20deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 35%, rgba(255,255,255,0) 70%, rgba(255,255,255,0.06) 100%)' }} />
                    <div className="absolute inset-0 rounded-[32px] pointer-events-none" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 20px 40px rgba(255,255,255,0.06)' }} />
                  </div>
                </motion.div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
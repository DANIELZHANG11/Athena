import { motion } from 'framer-motion'

export default function HomeSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <motion.div className="h-10 w-40 rounded-md bg-secondary-background" animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 1.2, repeat: Infinity }} />
      <motion.div className="mt-4 h-24 rounded-2xl border border-separator bg-secondary-background shadow-sm" animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 1.2, repeat: Infinity }} />
      <div className="mt-4 flex gap-3">
        {[0, 1, 2].map((i) => (
          <motion.div key={i} className="min-w-[160px] h-48 rounded-2xl border border-separator bg-secondary-background shadow-sm" animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 1.2, repeat: Infinity }} />
        ))}
      </div>
    </div>
  )
}


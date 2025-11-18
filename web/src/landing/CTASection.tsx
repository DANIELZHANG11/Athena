import { motion } from 'framer-motion'

export default function CTASection() {
  return (
    <div className="py-32 bg-gradient-to-b from-white to-gray-50">
      <div className="max-w-4xl mx-auto px-6 text-center">
        <motion.div initial={{ y: 60, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true, margin: '-100px' }} transition={{ duration: 0.8 }}>
          <div className="mb-8 flex justify-center">
            <img src="/LOGO.png" alt="Athena Reader Logo" className="w-16 h-16 object-contain" />
          </div>
          <h2 className="text-5xl md:text-6xl text-gray-900 mb-8" style={{ fontWeight: 700, lineHeight: 1.1 }}>Working with Athena Reader.</h2>
          <p className="text-xl md:text-2xl text-gray-600 max-w-3xl mx-auto leading-relaxed mb-12">
            A reading app is a handy tool for readers who want to keep track of the books they're reading and access curated content from their favorite authors. Here are some of our favorite features that make Athena Reader an essential companion for book lovers everywhere.
          </p>
          <motion.div initial={{ y: 40, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.2 }}>
            <a href="#" className="inline-block text-lg text-blue-600 hover:underline" style={{ fontWeight: 600 }}>Learn more →</a>
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}
import { motion } from 'motion/react';

interface FeatureHighlightProps {
  title: string;
  description: string;
  imageSrc?: string;
  imageAlt?: string;
  layout?: 'horizontal' | 'vertical';
}

export function FeatureHighlight({
  title,
  description,
  imageSrc,
  imageAlt = '',
  layout = 'horizontal',
}: FeatureHighlightProps) {
  return (
    <div className="py-16 bg-white">
      <div className="max-w-6xl mx-auto px-6">
        <div className={`${layout === 'horizontal' ? 'grid grid-cols-1 md:grid-cols-2 gap-12 items-center' : 'text-center'}`}>
          {/* Text Content */}
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8 }}
          >
            <h3 
              className="text-3xl md:text-4xl text-gray-900 mb-6"
              style={{ fontWeight: 700, lineHeight: 1.1 }}
            >
              {title}
            </h3>
            <p className="text-lg md:text-xl text-gray-600 leading-relaxed">
              {description}
            </p>
          </motion.div>

          {/* Image (if provided) */}
          {imageSrc && (
            <motion.div
              initial={{ y: 80, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="flex justify-center"
            >
              <img
                src={imageSrc}
                alt={imageAlt}
                className="max-w-full h-auto rounded-2xl shadow-xl"
              />
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

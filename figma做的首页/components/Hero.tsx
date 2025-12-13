import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import logoImage from 'figma:asset/5256e7afc4e4424b58652701f95174ad5a4f6dcb.png';

export function Hero() {
  const [animationComplete, setAnimationComplete] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimationComplete(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="relative bg-white text-gray-900 overflow-hidden pt-20 pb-0">
      <div className="max-w-6xl mx-auto px-6 text-center">
        {/* Logo Animation - Scale from large to small AND rise up */}
        <motion.div
          initial={{ scale: 5, y: 200, opacity: 1 }}
          animate={{ 
            scale: 1,
            y: 0,
            opacity: 1
          }}
          transition={{ 
            duration: 1.5,
            ease: [0.22, 1, 0.36, 1]
          }}
          className="mb-12 flex justify-center"
        >
          <img 
            src={logoImage} 
            alt="Athena Reader Logo" 
            className="w-20 h-20 object-contain"
          />
        </motion.div>

        {/* Main Headline - Slide up */}
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ 
            delay: 1.3,
            duration: 0.8,
            ease: [0.22, 1, 0.36, 1]
          }}
        >
          <h1 
            className="text-6xl md:text-7xl text-gray-900 mb-3"
            style={{ fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.015em' }}
          >
            Read, listen, discover.
          </h1>
          <h1 
            className="text-6xl md:text-7xl text-gray-900 mb-8"
            style={{ fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.015em' }}
          >
            All in one app.
          </h1>
        </motion.div>

        {/* Description - Slide up */}
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ 
            delay: 1.6,
            duration: 0.8,
            ease: [0.22, 1, 0.36, 1]
          }}
          className="mb-20"
        >
          <p className="text-xl md:text-2xl text-gray-600 max-w-4xl mx-auto leading-relaxed">
            Athena Reader is the single destination to find, buy, and dive into audiobooks and ebooks. 
            Browse curated collections and get personalized recommendations. Share your books with up to 
            five family members.* All with no subscription or monthly commitment.
          </p>
        </motion.div>
      </div>
    </div>
  );
}

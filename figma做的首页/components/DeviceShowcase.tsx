import { motion, useScroll, useTransform } from 'motion/react';
import { useRef } from 'react';

const deviceImages = [
  'https://images.unsplash.com/photo-1657639039662-9edac2e6a40b?w=300&h=650&fit=crop',
  'https://images.unsplash.com/photo-1683355879142-8a750ffa9ab6?w=300&h=650&fit=crop',
  'https://images.unsplash.com/photo-1589591872987-12784bb24d90?w=300&h=650&fit=crop',
  'https://images.unsplash.com/photo-1752079432635-12b7b68966ee?w=300&h=650&fit=crop',
  'https://images.unsplash.com/photo-1763013258650-c92b085726c4?w=300&h=650&fit=crop',
];

export function DeviceShowcase() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"]
  });

  // All devices move down to align bottoms as user scrolls
  // Devices 2 and 4 (index 1, 3) start higher, then move down to align with others
  const device2Y = useTransform(scrollYProgress, [0.2, 0.6], [-60, 0]);
  const device4Y = useTransform(scrollYProgress, [0.2, 0.6], [-60, 0]);

  return (
    <div ref={containerRef} className="relative bg-white pb-20 overflow-visible">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex justify-center items-end gap-2 md:gap-3 relative">
          {deviceImages.map((image, index) => {
            const isMiddle = index === 2;
            
            // Calculate initial X position for converging animation
            // Middle phone (index 2) doesn't move horizontally
            let initialX = 0;
            if (index === 0) initialX = -400;
            if (index === 1) initialX = -200;
            if (index === 3) initialX = 200;
            if (index === 4) initialX = 400;

            // All phones rise up from below
            const initialY = 300;

            return (
              <motion.div
                key={index}
                initial={{ 
                  x: initialX,
                  y: initialY,
                  opacity: 0 
                }}
                animate={{ 
                  x: 0,
                  y: 0,
                  opacity: 1 
                }}
                transition={{
                  duration: 1,
                  delay: 1.8 + (Math.abs(index - 2) * 0.1),
                  ease: [0.22, 1, 0.36, 1]
                }}
                className="relative flex-shrink-0"
                style={{
                  width: '180px',
                }}
              >
                <motion.div
                  style={{
                    // Devices 2 and 4 (index 1, 3) start higher, then align on scroll
                    y: index === 1 ? device2Y : index === 3 ? device4Y : 0
                  }}
                  className="relative rounded-[36px] overflow-hidden bg-black"
                  style={{
                    height: '360px', // All same height
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4), 0 10px 20px -8px rgba(0, 0, 0, 0.3)',
                  }}
                >
                  {/* Phone frame */}
                  <div className="absolute inset-0 rounded-[36px] border-[10px] border-black z-10 pointer-events-none" />
                  
                  {/* Notch */}
                  <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-24 h-7 bg-black rounded-b-3xl z-20" />
                  
                  {/* Screen content */}
                  <div className="absolute inset-[10px] rounded-[28px] overflow-hidden">
                    <img
                      src={image}
                      alt={`Device ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                </motion.div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

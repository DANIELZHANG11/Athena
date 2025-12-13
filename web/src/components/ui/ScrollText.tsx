import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface ScrollTextProps {
  text: string
  className?: string
  containerClassName?: string
}

export function ScrollText({ text, className, containerClassName }: ScrollTextProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [shouldScroll, setShouldScroll] = useState(false)
  const [duration, setDuration] = useState(0)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    const checkScroll = () => {
      if (containerRef.current && textRef.current) {
        const containerWidth = containerRef.current.offsetWidth
        const textWidth = textRef.current.offsetWidth
        
        if (textWidth > containerWidth) {
          setShouldScroll(true)
          setOffset(textWidth - containerWidth + 8) // Add a bit of buffer
          
          // Calculate duration
          // Speed: 30px/s
          const scrollTime = (textWidth - containerWidth) / 30
          // Total: Start Pause (1.5s) + Scroll + End Pause (1.5s) + Scroll Back
          setDuration(3 + scrollTime * 2) 
        } else {
          setShouldScroll(false)
        }
      }
    }

    checkScroll()
    // Re-check on window resize
    window.addEventListener('resize', checkScroll)
    return () => window.removeEventListener('resize', checkScroll)
  }, [text])

  return (
    <div 
      ref={containerRef} 
      className={cn("overflow-hidden whitespace-nowrap relative mask-linear-fade", containerClassName)}
      title={text}
    >
      <span
        ref={textRef}
        className={cn(
          "inline-block",
          className
        )}
        style={shouldScroll ? {
          animation: `scroll-horizontal-once ${duration}s linear 1 forwards`,
          '--scroll-offset': `-${offset}px`
        } as React.CSSProperties : undefined}
      >
        {text}
      </span>
      <style>{`
        @keyframes scroll-horizontal-once {
          0%, 20% { transform: translateX(0); }
          45%, 65% { transform: translateX(var(--scroll-offset)); }
          90%, 100% { transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}

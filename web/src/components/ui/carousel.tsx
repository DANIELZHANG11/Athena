"use client"

import * as React from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { cn } from './utils'

function Carousel({ className, options, children }: { className?: string; options?: any; children: React.ReactNode }) {
  const [emblaRef] = useEmblaCarousel(options)
  return (
    <div data-slot="carousel" className={cn('overflow-hidden', className)} ref={emblaRef}>
      <div className="flex">{children}</div>
    </div>
  )
}

function CarouselItem({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="carousel-item" className={cn('min-w-0 flex-[0_0_100%]', className)} {...props} />
}

export { Carousel, CarouselItem }
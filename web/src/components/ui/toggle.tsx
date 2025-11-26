"use client"

import * as React from 'react'
import * as TogglePrimitive from '@radix-ui/react-toggle'
import { cn } from './utils'

function Toggle({ className, ...props }: React.ComponentProps<typeof TogglePrimitive.Root>) {
  return <TogglePrimitive.Root data-slot="toggle" className={cn('hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 inline-flex items-center justify-center gap-2 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground', className)} {...props} />
}

export { Toggle }
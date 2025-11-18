"use client"

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from './utils'

function Sheet(props: React.ComponentProps<typeof DialogPrimitive.Root>) { return <DialogPrimitive.Root data-slot="sheet" {...props} /> }
function SheetTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) { return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} /> }
function SheetPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) { return <DialogPrimitive.Portal data-slot="sheet-portal" {...props} /> }
function SheetOverlay(props: React.ComponentProps<typeof DialogPrimitive.Overlay>) { return <DialogPrimitive.Overlay data-slot="sheet-overlay" className={cn('fixed inset-0 z-50 bg-black/50', props.className)} {...props} /> }
function SheetContent({ className, side = 'right', ...props }: React.ComponentProps<typeof DialogPrimitive.Content> & { side?: 'left' | 'right' | 'top' | 'bottom' }) {
  const styles = side === 'right' ? 'inset-y-0 right-0 w-3/4 sm:w-96' : side === 'left' ? 'inset-y-0 left-0 w-3/4 sm:w-96' : side === 'top' ? 'inset-x-0 top-0 h-1/2' : 'inset-x-0 bottom-0 h-1/2'
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content data-slot="sheet-content" className={cn('bg-popover text-popover-foreground fixed z-50 border shadow-lg', styles, className)} {...props} />
    </SheetPortal>
  )
}
function SheetHeader(props: React.ComponentProps<'div'>) { return <div data-slot="sheet-header" className={cn('grid gap-2 p-4', props.className)} {...props} /> }
function SheetFooter(props: React.ComponentProps<'div'>) { return <div data-slot="sheet-footer" className={cn('grid gap-2 p-4', props.className)} {...props} /> }
function SheetTitle(props: React.ComponentProps<typeof DialogPrimitive.Title>) { return <DialogPrimitive.Title data-slot="sheet-title" className={cn('text-lg font-semibold', props.className)} {...props} /> }
function SheetDescription(props: React.ComponentProps<typeof DialogPrimitive.Description>) { return <DialogPrimitive.Description data-slot="sheet-description" className={cn('text-sm text-muted-foreground', props.className)} {...props} /> }

export { Sheet, SheetTrigger, SheetPortal, SheetOverlay, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription }
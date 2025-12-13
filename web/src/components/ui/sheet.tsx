/**
 * 侧边抽屉组件（Radix Dialog 实现）
 * - 支持 left/right/top/bottom 四个方向
 * - 封装 Overlay/Content/Header/Footer 等结构
 */
"use client"

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from './utils'

function Sheet(props: React.ComponentProps<typeof DialogPrimitive.Root>) { return <DialogPrimitive.Root data-slot="sheet" {...props} /> }
function SheetTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) { return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} /> }
function SheetPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) { return <DialogPrimitive.Portal data-slot="sheet-portal" {...props} /> }

// 使用 forwardRef 修复警告
const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay 
    ref={ref}
    data-slot="sheet-overlay" 
    className={cn('fixed inset-0 z-50 bg-black/50', className)} 
    {...props} 
  />
))
SheetOverlay.displayName = 'SheetOverlay'

function SheetContent({ className, side = 'right', ...props }: React.ComponentProps<typeof DialogPrimitive.Content> & { side?: 'left' | 'right' | 'top' | 'bottom' }) {
  // 根据方向设置位置样式
  const positionStyles = {
    right: 'inset-y-0 right-0 w-3/4 sm:w-96',
    left: 'inset-y-0 left-0 w-3/4 sm:w-96',
    top: 'inset-x-0 top-0 h-1/2',
    bottom: 'inset-x-0 bottom-0'
  }
  // 根据方向设置动画样式 - 使用 Motion Token duration-slow (500ms)
  const animationStyles = {
    right: 'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right duration-slow ease-apple',
    left: 'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left duration-slow ease-apple',
    top: 'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top duration-slow ease-apple',
    bottom: 'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom duration-slow ease-apple'
  }
  return (
    <SheetPortal>
      <SheetOverlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content 
        data-slot="sheet-content" 
        className={cn(
          'bg-popover text-popover-foreground fixed z-50 border shadow-lg transition-transform duration-medium ease-apple',
          positionStyles[side],
          animationStyles[side],
          className
        )} 
        {...props} 
      />
    </SheetPortal>
  )
}
function SheetHeader(props: React.ComponentProps<'div'>) { return <div data-slot="sheet-header" className={cn('grid gap-2 p-4', props.className)} {...props} /> }
function SheetFooter(props: React.ComponentProps<'div'>) { return <div data-slot="sheet-footer" className={cn('grid gap-2 p-4', props.className)} {...props} /> }
function SheetTitle(props: React.ComponentProps<typeof DialogPrimitive.Title>) { return <DialogPrimitive.Title data-slot="sheet-title" className={cn('text-lg font-semibold', props.className)} {...props} /> }
function SheetDescription(props: React.ComponentProps<typeof DialogPrimitive.Description>) { return <DialogPrimitive.Description data-slot="sheet-description" className={cn('text-sm text-muted-foreground', props.className)} {...props} /> }

export { Sheet, SheetTrigger, SheetPortal, SheetOverlay, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription }

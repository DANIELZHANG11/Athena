/**
 * 抽屉组件（Vaul）
 * - 提供底部弹出抽屉的结构与样式
 * - 封装 Trigger/Overlay/Content 等子组件
 */
"use client"

import * as React from 'react'
import { Drawer as VaulDrawer } from 'vaul'
import { cn } from './utils'

function Drawer({ className, ...props }: any) {
  return <VaulDrawer.Root data-slot="drawer" className={cn(className)} {...props} />
}

function DrawerTrigger(props: React.ComponentProps<typeof VaulDrawer.Trigger>) { return <VaulDrawer.Trigger data-slot="drawer-trigger" {...props} /> }
function DrawerPortal(props: React.ComponentProps<typeof VaulDrawer.Portal>) { return <VaulDrawer.Portal data-slot="drawer-portal" {...props} /> }
function DrawerOverlay(props: React.ComponentProps<typeof VaulDrawer.Overlay>) { return <VaulDrawer.Overlay data-slot="drawer-overlay" {...props} /> }
function DrawerContent({ className, ...props }: React.ComponentProps<typeof VaulDrawer.Content>) { return <VaulDrawer.Content data-slot="drawer-content" className={cn('bg-popover text-popover-foreground fixed inset-x-0 bottom-0 z-50 flex h-auto w-full flex-col rounded-t-[10px] border', className)} {...props} /> }
function DrawerHeader({ className, ...props }: React.ComponentProps<'div'>) { return <div data-slot="drawer-header" className={cn('grid gap-2 px-4 pt-4', className)} {...props} /> }
function DrawerFooter({ className, ...props }: React.ComponentProps<'div'>) { return <div data-slot="drawer-footer" className={cn('grid gap-2 px-4 pb-4', className)} {...props} /> }
function DrawerTitle({ className, ...props }: React.ComponentProps<'div'>) { return <h5 data-slot="drawer-title" className={cn('text-lg font-semibold', className)} {...props} /> }
function DrawerDescription({ className, ...props }: React.ComponentProps<'div'>) { return <p data-slot="drawer-description" className={cn('text-sm text-muted-foreground', className)} {...props} /> }

export { Drawer, DrawerTrigger, DrawerPortal, DrawerOverlay, DrawerContent, DrawerHeader, DrawerFooter, DrawerTitle, DrawerDescription }

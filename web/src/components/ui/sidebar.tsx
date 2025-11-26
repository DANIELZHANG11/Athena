import * as React from 'react'
import { cn } from './utils'

function Sidebar({ className, ...props }: React.ComponentProps<'aside'>) { return <aside data-slot="sidebar" className={cn('bg-sidebar text-sidebar-foreground sticky top-0 z-40 flex h-screen max-h-screen w-64 flex-col border-r', className)} {...props} /> }
function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) { return <div data-slot="sidebar-header" className={cn('p-4', className)} {...props} /> }
function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) { return <div data-slot="sidebar-footer" className={cn('mt-auto p-4', className)} {...props} /> }
function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) { return <div data-slot="sidebar-content" className={cn('flex-1 overflow-y-auto p-2', className)} {...props} /> }
function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) { return <div data-slot="sidebar-group" className={cn('mb-2', className)} {...props} /> }
function SidebarGroupLabel({ className, ...props }: React.ComponentProps<'div'>) { return <div data-slot="sidebar-group-label" className={cn('px-2 py-1 text-xs font-medium text-muted-foreground', className)} {...props} /> }
function SidebarGroupContent({ className, ...props }: React.ComponentProps<'div'>) { return <div data-slot="sidebar-group-content" className={cn('grid gap-1', className)} {...props} /> }
function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) { return <ul data-slot="sidebar-menu" className={cn('grid gap-1', className)} {...props} /> }
function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) { return <li data-slot="sidebar-menu-item" className={cn('list-none', className)} {...props} /> }
function SidebarMenuButton({ className, ...props }: React.ComponentProps<'button'>) { return <button data-slot="sidebar-menu-button" className={cn('hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring/50 inline-flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm outline-hidden focus-visible:ring-[3px]', className)} {...props} /> }

export { Sidebar, SidebarHeader, SidebarFooter, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton }
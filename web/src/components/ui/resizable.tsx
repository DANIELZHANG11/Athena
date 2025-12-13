"use client"

import * as React from 'react'
import * as ResizablePrimitive from 'react-resizable-panels'
import { cn } from './utils'

function ResizablePanelGroup({ className, ...props }: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) {
  return <ResizablePrimitive.PanelGroup data-slot="resizable-panel-group" className={cn('flex', className)} {...props} />
}
function ResizablePanel({ className, ...props }: React.ComponentProps<typeof ResizablePrimitive.Panel>) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" className={cn('min-w-0', className)} {...props} />
}
function ResizableHandle({ className, ...props }: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle>) {
  return <ResizablePrimitive.PanelResizeHandle data-slot="resizable-handle" className={cn('bg-border data-[resize-handle-active=true]:bg-primary relative w-2.5 cursor-col-resize rounded-full', className)} {...props} />
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
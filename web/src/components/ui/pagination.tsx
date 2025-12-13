import * as React from 'react'
import { cn } from './utils'
import { buttonVariants } from './button'

function Pagination({ className, ...props }: React.ComponentProps<'nav'>) { return <nav data-slot="pagination" className={cn('flex items-center justify-between gap-2 py-2', className)} {...props} /> }
function PaginationContent({ className, ...props }: React.ComponentProps<'ul'>) { return <ul data-slot="pagination-content" className={cn('flex items-center gap-1', className)} {...props} /> }
function PaginationItem({ className, ...props }: React.ComponentProps<'li'>) { return <li data-slot="pagination-item" className={cn('list-none', className)} {...props} /> }
function PaginationLink({ className, isActive, ...props }: React.ComponentProps<'a'> & { isActive?: boolean }) { return <a data-slot="pagination-link" aria-current={isActive ? 'page' : undefined} className={cn(buttonVariants({ variant: isActive ? 'default' : 'outline', size: 'sm' }), 'min-w-9 justify-center', className)} {...props} /> }
function PaginationPrevious({ className, ...props }: React.ComponentProps<'a'>) { return <a data-slot="pagination-previous" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), className)} {...props} /> }
function PaginationNext({ className, ...props }: React.ComponentProps<'a'>) { return <a data-slot="pagination-next" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), className)} {...props} /> }
function PaginationEllipsis({ className, ...props }: React.ComponentProps<'span'>) { return <span data-slot="pagination-ellipsis" className={cn('px-2 text-muted-foreground', className)} {...props}>…</span> }

export { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis }
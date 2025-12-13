import * as React from 'react'
import { cn } from './utils'

function Alert({ className, variant = 'default', ...props }: React.ComponentProps<'div'> & { variant?: 'default' | 'destructive' }) {
  return <div data-slot="alert" data-variant={variant} className={cn('bg-card text-card-foreground relative w-full rounded-lg border p-4 [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg~*]:pl-7 [&>svg]:size-4 data-[variant=destructive]:border-destructive/80 data-[variant=destructive]:text-destructive [&>svg]:text-muted-foreground', className)} {...props} />
}
function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) { return <h5 data-slot="alert-title" className={cn('leading-none font-medium tracking-tight', className)} {...props} /> }
function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) { return <div data-slot="alert-description" className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} /> }

export { Alert, AlertTitle, AlertDescription }
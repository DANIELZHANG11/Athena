import * as React from 'react'
import { cn } from './utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return <input data-slot="input" type={type} className={cn('border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex h-9 w-full rounded-md border bg-input-background px-3 py-2 text-sm transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50', className)} {...props} />
}

export { Input }
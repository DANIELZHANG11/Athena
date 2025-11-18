import * as React from 'react'
import { cn } from './utils'

function Form({ className, ...props }: React.ComponentProps<'form'>) { return <form data-slot="form" className={cn('grid gap-4', className)} {...props} /> }
function FormField({ className, ...props }: React.ComponentProps<'div'>) { return <div data-slot="form-field" className={cn('grid gap-2', className)} {...props} /> }
function FormLabel({ className, ...props }: React.ComponentProps<'label'>) { return <label data-slot="form-label" className={cn('text-sm font-medium', className)} {...props} /> }
function FormControl({ className, ...props }: React.ComponentProps<'div'>) { return <div data-slot="form-control" className={cn('grid', className)} {...props} /> }
function FormDescription({ className, ...props }: React.ComponentProps<'p'>) { return <p data-slot="form-description" className={cn('text-muted-foreground text-xs', className)} {...props} /> }
function FormMessage({ className, ...props }: React.ComponentProps<'p'>) { return <p data-slot="form-message" className={cn('text-destructive text-xs', className)} {...props} /> }

export { Form, FormField, FormLabel, FormControl, FormDescription, FormMessage }
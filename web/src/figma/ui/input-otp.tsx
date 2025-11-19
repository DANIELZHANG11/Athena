"use client"

import * as React from 'react'
import { OTPInput } from 'input-otp'
import { cn } from './utils'

function InputOTP({ className, containerClassName, maxLength = 6, renderSeparator, renderInput, ...props }: any) {
  return (
    <OTPInput data-slot="input-otp" maxLength={maxLength} className={cn('group flex *:data-[slot=input-otp-group]:gap-2', className)} containerClassName={containerClassName} renderSeparator={renderSeparator} renderInput={renderInput} {...props} />
  )
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<'div'>) { return <div data-slot="input-otp-group" className={cn('flex items-center gap-1', className)} {...props} /> }
function InputOTPSlot(props: any) { return (<div data-slot="input-otp-slot" className={cn('border-input text-foreground focus-within:border-ring focus-within:ring-ring/50 dark:bg-input/30 relative flex h-9 w-9 items-center justify-center rounded-md border ring-offset-background transition-[color,box-shadow] outline-none focus-within:ring-[3px] [&:has(input[data-input-otp])]:bg-input-background [&:has(input[data-input-otp])]:shadow-xs [&:has(input[data-input-otp])]:ring-offset-2', (props.value || props.char) ? 'bg-input-background shadow-xs ring-offset-2' : '')}><input data-input-otp {...props} className="text-muted-foreground font-medium absolute inset-0 size-full rounded-md bg-transparent text-center outline-hidden focus-visible:bg-transparent focus-visible:ring-0" /></div>) }
function InputOTPSeparator({ className, ...props }: React.ComponentProps<'div'>) { return <div data-slot="input-otp-separator" role="separator" aria-orientation="vertical" className={cn('bg-border mx-2 w-px shrink-0', className)} {...props} /> }

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator }
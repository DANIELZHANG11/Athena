/**
 * UI 工具函数
 * - `cn`: 合并类名并应用 tailwind-merge 规则
 */
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

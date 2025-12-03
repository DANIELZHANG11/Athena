/**
 * OcrTriggerDialog.tsx
 * 
 * OCR 文字识别触发对话框
 * 显示书籍页数、配额消耗、剩余配额，并提供触发 OCR 的功能
 */

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { FileText, Loader2, AlertTriangle, X, Zap, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

interface OcrQuotaInfo {
  pageCount: number | null
  tier: number  // 1, 2, 3
  cost: number  // 消耗的配额单位数
  canTrigger: boolean
  reason?: string
  freeRemaining: number
  proRemaining: number
  addonRemaining: number
  isPro: boolean
  maxPages: number
}

interface OcrTriggerDialogProps {
  bookId: string
  bookTitle: string
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}

/** 获取配额信息 */
async function fetchOcrQuotaInfo(bookId: string): Promise<OcrQuotaInfo> {
  const token = useAuthStore.getState().accessToken
  const res = await fetch(`/api/v1/books/${bookId}/ocr/quota`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error('Failed to fetch OCR quota info')
  }
  const data = await res.json()
  return data.data
}

/** 触发 OCR */
async function triggerOcr(bookId: string): Promise<{ jobId: string }> {
  const token = useAuthStore.getState().accessToken
  const res = await fetch(`/api/v1/books/${bookId}/ocr`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || err.detail || 'OCR trigger failed')
  }
  return res.json()
}

export default function OcrTriggerDialog({
  bookId,
  bookTitle,
  open,
  onClose,
  onSuccess,
}: OcrTriggerDialogProps) {
  const { t } = useTranslation('common')
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)
  const [quotaInfo, setQuotaInfo] = useState<OcrQuotaInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 加载配额信息
  useEffect(() => {
    if (open && bookId) {
      setLoading(true)
      setError(null)
      fetchOcrQuotaInfo(bookId)
        .then(setQuotaInfo)
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false))
    }
  }, [open, bookId])

  // 触发 OCR
  const handleTrigger = useCallback(async () => {
    if (!quotaInfo?.canTrigger) return
    setTriggering(true)
    setError(null)
    try {
      await triggerOcr(bookId)
      onSuccess?.()
      onClose()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setTriggering(false)
    }
  }, [bookId, quotaInfo, onSuccess, onClose])

  if (!open) return null

  // 根据 tier 获取描述
  const getTierLabel = (tier: number) => {
    switch (tier) {
      case 1: return t('ocr.tier_1')
      case 2: return t('ocr.tier_2')
      case 3: return t('ocr.tier_3')
      default: return ''
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 遮罩层 */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 对话框 */}
      <div
        className={cn(
          'relative w-full max-w-md',
          'bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl',
          'shadow-2xl border border-gray-200/50 dark:border-white/10',
          'rounded-2xl overflow-hidden',
          'animate-in fade-in-0 zoom-in-95 duration-200'
        )}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-separator">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-system-blue/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-system-blue" />
            </div>
            <div>
              <h3 className="text-base font-bold text-label">{t('ocr.confirm_title')}</h3>
              <p className="text-xs text-secondary-label line-clamp-1">{bookTitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-secondary-background transition-colors"
          >
            <X className="w-5 h-5 text-secondary-label" />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-6 py-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="w-8 h-8 text-system-blue animate-spin mb-3" />
              <span className="text-sm text-secondary-label">加载中...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-8">
              <AlertTriangle className="w-8 h-8 text-system-orange mb-3" />
              <span className="text-sm text-secondary-label">{error}</span>
            </div>
          ) : quotaInfo ? (
            <div className="space-y-4">
              {/* 页数信息 */}
              <div className="bg-secondary-background rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-secondary-label">书籍页数</span>
                  <span className="text-lg font-bold text-label">
                    {quotaInfo.pageCount ? t('ocr.page_count', { count: quotaInfo.pageCount }) : '未知'}
                  </span>
                </div>
                {quotaInfo.pageCount && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-secondary-label">书籍规模</span>
                    <span className="text-sm font-medium text-label">{getTierLabel(quotaInfo.tier)}</span>
                  </div>
                )}
              </div>

              {/* 配额消耗 */}
              <div className="bg-system-blue/5 dark:bg-system-blue/10 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-system-blue" />
                  <span className="text-sm font-medium text-label">配额消耗</span>
                </div>
                <div className="text-2xl font-bold text-system-blue mb-1">
                  {t('ocr.cost_units', { count: quotaInfo.cost })}
                </div>
                <p className="text-xs text-secondary-label">
                  {t('ocr.confirm_message')}
                </p>
              </div>

              {/* 剩余配额 */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Info className="w-4 h-4 text-secondary-label" />
                  <span className="text-secondary-label">剩余配额</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {!quotaInfo.isPro && (
                    <div className="bg-secondary-background rounded-lg px-3 py-2">
                      <span className="text-secondary-label">免费额度: </span>
                      <span className="font-medium text-label">{quotaInfo.freeRemaining}</span>
                    </div>
                  )}
                  {quotaInfo.isPro && (
                    <div className="bg-secondary-background rounded-lg px-3 py-2">
                      <span className="text-secondary-label">Pro 赠送: </span>
                      <span className="font-medium text-label">{quotaInfo.proRemaining}</span>
                    </div>
                  )}
                  <div className="bg-secondary-background rounded-lg px-3 py-2">
                    <span className="text-secondary-label">加油包: </span>
                    <span className="font-medium text-label">{quotaInfo.addonRemaining}</span>
                  </div>
                </div>
              </div>

              {/* 不能触发的原因 */}
              {!quotaInfo.canTrigger && quotaInfo.reason && (
                <div className="bg-system-red/10 rounded-xl p-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-system-red flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-system-red">{quotaInfo.reason}</p>
                    {quotaInfo.reason.includes('配额') && (
                      <button className="mt-2 text-sm text-system-blue font-medium hover:underline">
                        {t('ocr.buy_addon')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-separator flex gap-3">
          <button
            onClick={onClose}
            disabled={triggering}
            className={cn(
              'flex-1 py-3 px-4 rounded-full',
              'bg-secondary-background text-label',
              'border border-separator',
              'font-medium text-sm',
              'hover:bg-tertiary-background transition-colors',
              'disabled:opacity-50'
            )}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleTrigger}
            disabled={loading || triggering || !quotaInfo?.canTrigger}
            className={cn(
              'flex-1 py-3 px-4 rounded-full',
              'bg-system-blue text-white',
              'font-medium text-sm',
              'hover:opacity-90 transition-opacity',
              'disabled:opacity-50',
              'flex items-center justify-center gap-2'
            )}
          >
            {triggering && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('ocr.confirm_button')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

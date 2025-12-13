import { useEffect, useState } from 'react'
import i18n from './i18n'

export default function Price() {
  const [price, setPrice] = useState<{ amount_minor: number; currency: string } | null>(null)
  useEffect(() => {
    const cur = i18n.language === 'zh-CN' ? 'CNY' : 'USD'
    fetch(`/api/v1/pricing/plans?currency=${cur}`)
      .then((r) => r.json())
      .then((j) => {
        const proMonthly = (j.data || []).find((x: any) => x.plan_code === 'pro' && x.period === 'monthly')
        if (proMonthly) setPrice({ amount_minor: proMonthly.amount_minor, currency: proMonthly.currency })
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.language])
  if (!price) return null
  const factor = price.currency === 'JPY' ? 1 : 100
  const amount = price.amount_minor / factor
  const fmt = new Intl.NumberFormat(i18n.language, { style: 'currency', currency: price.currency })
  return <div style={{ marginTop: 16 }}>{fmt.format(amount)}/mo</div>
}
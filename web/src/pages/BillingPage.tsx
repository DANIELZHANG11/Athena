import { useEffect, useState, useCallback } from 'react'

export default function BillingPage() {
  const [balance, setBalance] = useState<any>(null)
  const [ledger, setLedger] = useState<any[]>([])
  const at = typeof window !== 'undefined' ? localStorage.getItem('access_token') || '' : ''
  const fetchJson = useCallback(async (url: string) => {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${at}` } })
    return r.json()
  }, [at])
  useEffect(() => {
    const load = async () => {
      const b = await fetchJson('/api/v1/billing/balance')
      setBalance(b.data)
      const l = await fetchJson('/api/v1/billing/ledger')
      setLedger(l.data || [])
    }
    load()
  }, [fetchJson])
  return (
    <div style={{ padding: 16 }}>
      <h2>余额</h2>
      {balance && (
        <div>
          <div>Credits: {balance.balance}</div>
          <div>钱包: {balance.wallet_amount} {balance.wallet_currency}</div>
        </div>
      )}
      <h2 style={{ marginTop: 12 }}>账单</h2>
      <ul>
        {ledger.map((x, i) => (
          <li key={i}>{x.direction} {x.amount} {x.currency} {x.reason}</li>
        ))}
      </ul>
    </div>
  )
}
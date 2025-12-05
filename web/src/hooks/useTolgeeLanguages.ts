/**
 * Tolgee 语言列表 Hook
 *
 * 说明：
 * - 优先从 Tolgee API 获取语言；缺失时回退到本地 i18n 资源
 * - 规范化语言标签（如 zh → zh-CN）
 * - 定期轮询语言列表并在当前语言不在集合时回退
 */
import { useEffect, useState } from 'react'
import i18n from '../i18n'

type Lang = { code: string; name?: string; raw?: string }

function normalize(tag: string): string {
  const t = (tag || '').toLowerCase()
  if (t === 'zh' || t === 'zh_cn' || t === 'zh-hans') return 'zh-CN'
  if (t === 'en' || t === 'en_us') return 'en-US'
  return tag
}

async function fetchTolgeeLanguages(): Promise<Lang[]> {
  const apiUrl = import.meta.env.VITE_APP_TOLGEE_API_URL as string
  const apiKey = import.meta.env.VITE_APP_TOLGEE_API_KEY as string
  if (!apiUrl || !apiKey) {
    const res = i18n.options?.resources || {}
    return Object.keys(res).map((code) => ({ code: normalize(code), raw: code }))
  }
  try {
    const r = await fetch(`${apiUrl}/v2/projects/current/languages`, { headers: { 'X-API-Key': apiKey } })
    const j = await r.json().catch(() => undefined)
    const arr = Array.isArray(j) ? j : (j?.languages || [])
    return arr.map((it: any) => { const raw = it.tag || it.code || it.languageTag || it.name || it; return ({ code: normalize(raw), raw, name: it.name }) })
  } catch {
    const res = i18n.options?.resources || {}
    return Object.keys(res).map((code) => ({ code: normalize(code), raw: code }))
  }
}

export function useTolgeeLanguages() {
  const [langs, setLangs] = useState<Lang[]>([])
  useEffect(() => {
    let mounted = true
    const load = async () => {
      const list = await fetchTolgeeLanguages()
      if (!mounted) return
      setLangs(list)
      const cur = i18n.language
      const codes = list.map((l) => l.code)
      if (cur && codes.length && !codes.includes(cur)) {
        i18n.changeLanguage(codes[0])
      }
    }
    load()
    const timerId = setInterval(load, 15000)
    return () => { mounted = false; clearInterval(timerId) }
  }, [])
  return langs
}

/**
 * i18n 同步脚本
 * - 从后端拉取指定命名空间与语言的翻译
 * - 写入到 `public/locales/<lang>/<ns>.json`
 * - 需设置环境变量：`ADMIN_TOKEN` 与 `I18N_SYNC_BASE`
 */
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''
const BASE = process.env.I18N_SYNC_BASE || 'http://localhost:8000'

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const req = mod.request(url, { method: 'GET', headers }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

async function run() {
  if (!ADMIN_TOKEN) {
    console.error('Missing ADMIN_TOKEN')
    process.exit(1)
  }
  const headers = { 'X-Admin-Token': ADMIN_TOKEN }
  const langs = ['zh-CN', 'en-US']
  const ns = 'common'
  for (const lang of langs) {
    const url = `${BASE}/api/v1/admin/translations?namespace=${encodeURIComponent(ns)}&lang=${encodeURIComponent(lang)}`
    const json = await fetchJson(url, headers)
    const out = {}
    for (const item of json.data || []) {
      out[item.key] = item.value
    }
    const outDir = path.join(__dirname, '..', 'public', 'locales', lang)
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, `${ns}.json`), JSON.stringify(out, null, 2))
    console.log(`Synced ${lang} entries: ${Object.keys(out).length}`)
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

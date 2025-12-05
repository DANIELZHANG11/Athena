/**
 * 国际化与 Tolgee 集成
 *
 * 结构：
 * - 通过 `import.meta.glob` 预加载本地 JSON 作为离线回退资源
 * - 可选启用 Tolgee：从远端拉取翻译并与本地资源合并
 * - 自动构建 key→namespace 映射，确保资源归属正确
 *
 * 注意：
 * - 开发环境使用 Vite 代理 `/tolgee-api`，生产从环境变量读取 URL
 * - 为避免页面阻塞，远端翻译加载采用异步串行方式
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { Tolgee, DevTools } from '@tolgee/web'
import { FormatIcu } from '@tolgee/format-icu'

// 动态加载所有翻译文件 (作为离线回退)
const modules = import.meta.glob('./locales/*/*.json', { eager: true })

const resources: Record<string, any> = {}

for (const path in modules) {
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/)
  if (match) {
    const [, lang, ns] = match
    if (!resources[lang]) resources[lang] = {}
    resources[lang][ns] = (modules[path] as any).default || modules[path]
  }
}

const storedLng = typeof window !== 'undefined' ? (localStorage.getItem('i18nextLng') as string) : undefined
const defaultLng = (import.meta.env.VITE_DEFAULT_LANG as string) || 'en-US'

const apiKey = import.meta.env.VITE_APP_TOLGEE_API_KEY as string
// 使用 Vite 代理路径，这样移动端也能访问
const apiUrl = import.meta.env.DEV
  ? '/tolgee-api'  // 开发环境：通过 Vite 代理
  : (import.meta.env.VITE_APP_TOLGEE_API_URL as string) || 'http://localhost:8085'  // 生产环境：直接URL

console.log('🔧 Initializing i18n...')
console.log('📍 API URL:', apiUrl)
console.log('🔑 API Key present:', !!apiKey)

// 初始化 Tolgee（仅当有 API Key 时）
export const tolgee = apiKey ? Tolgee()
  .use(DevTools())
  .use(FormatIcu())
  .init({
    apiUrl,
    apiKey,
    defaultLanguage: 'en-US',
    fallbackLanguage: 'en-US',
  }) : null

// 初始化 i18next
i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: storedLng || defaultLng,
    fallbackLng: 'en-US',
    ns: ['common', 'landing', 'auth'],
    defaultNS: 'landing',
    interpolation: {
      escapeValue: false
    },
    load: 'currentOnly',
    debug: import.meta.env.DEV,
    react: {
      useSuspense: false
    }
  })

// 如果有 Tolgee，从本地 JSON 知道哪些 key 属于哪个命名空间
let tolgeeInitialized = false
if (tolgee && apiKey && !tolgeeInitialized) {
  tolgeeInitialized = true
  tolgee.run().then(async () => {
    console.log('✅ Tolgee initialized successfully')

    // 构建 key 到命名空间的映射（从本地 JSON 文件）
    const keyToNamespace: Record<string, string> = {}

    Object.keys(resources).forEach(lang => {
      Object.keys(resources[lang]).forEach(ns => {
        const flattenKeys = (obj: any, prefix = ''): void => {
          Object.keys(obj).forEach(key => {
            const fullKey = prefix ? `${prefix}.${key}` : key
            if (typeof obj[key] === 'object' && obj[key] !== null) {
              flattenKeys(obj[key], fullKey)
            } else {
              keyToNamespace[fullKey] = ns
            }
          })
        }
        flattenKeys(resources[lang][ns])
      })
    })

    console.log(`📋 Mapped ${Object.keys(keyToNamespace).length} keys to namespaces`)

    // 从 Tolgee 加载翻译
    const loadLanguageTranslations = async (lang: string) => {
      console.log(`📥 Loading translations for ${lang}...`)

      try {
        const response = await fetch(`${apiUrl}/v2/projects/translations?languages=${lang}&size=1000`, {
          headers: {
            'X-API-Key': apiKey
          }
        })

        if (!response.ok) {
          console.warn(`⚠️ Failed to fetch translations for ${lang}:`, response.status)
          return
        }

        const data = await response.json()

        if (data._embedded && data._embedded.keys) {
          const translations: Record<string, Record<string, string>> = {
            common: {},
            landing: {},
            auth: {}
          }

          let processedCount = 0

          data._embedded.keys.forEach((key: any) => {
            const keyName = key.keyName
            const translation = key.translations?.[lang]?.text

            if (!keyName || !translation) return

            // 使用映射表确定命名空间
            const ns = keyToNamespace[keyName] || 'common'
            translations[ns][keyName] = translation
            processedCount++
          })

          console.log(`� Processed ${processedCount} translations for ${lang}`)

          // 转换为嵌套对象
          const convertToNested = (flat: Record<string, string>): any => {
            const nested: any = {}
            Object.keys(flat).forEach(key => {
              const parts = key.split('.')
              let current = nested

              for (let i = 0; i < parts.length; i++) {
                const part = parts[i]
                const isLast = i === parts.length - 1

                if (isLast) {
                  current[part] = flat[key]
                } else {
                  if (typeof current[part] === 'string') {
                    console.warn(`⚠️ Key conflict: "${parts.slice(0, i + 1).join('.')}" is both a value and a parent. Skipping "${key}"`)
                    return
                  }
                  current[part] = current[part] || {}
                  current = current[part]
                }
              }
            })
            return nested
          }

          Object.keys(translations).forEach(ns => {
            const flatKeys = translations[ns]
            if (Object.keys(flatKeys).length > 0) {
              const nestedTranslations = convertToNested(flatKeys)
              i18n.addResourceBundle(lang, ns, nestedTranslations, true, true)
              console.log(`✅ Loaded ${Object.keys(flatKeys).length} keys for ${lang}/${ns}`)
            }
          })
        }
      } catch (err) {
        console.error(`❌ Failed to load translations for ${lang}:`, err)
      }
    }

    // 加载所有语言的翻译
    await loadLanguageTranslations('en-US')
    await loadLanguageTranslations('zh-CN')

    // 从 Tolgee 获取所有可用语言并加载
    try {
      const langResponse = await fetch(`${apiUrl}/v2/projects/languages`, {
        headers: { 'X-API-Key': apiKey }
      })

      if (langResponse.ok) {
        const langData = await langResponse.json()
        const languages = langData._embedded?.languages || []

        console.log(`📚 Found ${languages.length} languages in Tolgee`)

        // 加载除了 en-US 和 zh-CN 之外的其他语言
        for (const lang of languages) {
          const langTag = lang.tag
          if (langTag !== 'en-US' && langTag !== 'zh-CN') {
            console.log(`📥 Loading additional language: ${langTag}`)
            await loadLanguageTranslations(langTag)
          }
        }
      }
    } catch (err) {
      console.warn('⚠️ Failed to fetch language list from Tolgee:', err)
    }

    console.log('🎉 All translations loaded!')
  }).catch((err) => {
    console.error('❌ Tolgee initialization failed:', err)
  })
}

export default i18n

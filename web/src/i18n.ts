/**
 * 国际化配置 (App-First / 离线优先)
 *
 * 说明：
 * - 通过 `import.meta.glob` 预加载本地 JSON 翻译资源
 * - 完全离线可用，无需外部服务
 * - 支持 zh-CN / en-US 双语言
 *
 * @see 00 - AI 编码宪法与规范AI_Coding_Constitution_and_Rules.md 第五章
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// 动态加载所有翻译文件
const modules = import.meta.glob('./locales/*/*.json', { eager: true })

const resources: Record<string, Record<string, any>> = {}

for (const path in modules) {
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/)
  if (match) {
    const [, lang, ns] = match
    if (!resources[lang]) resources[lang] = {}
    resources[lang][ns] = (modules[path] as any).default || modules[path]
  }
}

// 语言检测优先级：localStorage > 浏览器语言 > 默认 zh-CN
const storedLng = typeof window !== 'undefined' 
  ? localStorage.getItem('i18nextLng') 
  : undefined

const browserLng = typeof navigator !== 'undefined' 
  ? (navigator.language?.startsWith('zh') ? 'zh-CN' : navigator.language?.startsWith('en') ? 'en-US' : undefined)
  : undefined

const defaultLng = storedLng || browserLng || 'zh-CN'

// 初始化 i18next
i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: defaultLng,
    fallbackLng: 'en-US',
    ns: ['common', 'landing', 'auth'],
    defaultNS: 'common',
    interpolation: {
      escapeValue: false
    },
    load: 'currentOnly',
    debug: import.meta.env.DEV,
    react: {
      useSuspense: false
    }
  })

export default i18n

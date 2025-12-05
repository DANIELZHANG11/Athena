/**
 * Vitest 单元测试配置
 * - 环境使用 `jsdom`
 * - v8 覆盖率与阈值配置
 * - 排除 UI/页面等非单测目标
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      all: false,
      thresholds: { lines: 20, branches: 20, functions: 20, statements: 20 },
      exclude: [
        'scripts/**',
        'src/pages/**',
        'src/components/**',
        'src/services/**',
        'src/main.tsx',
        'src/App.tsx',
        'src/i18n.ts'
      ]
    }
  }
})

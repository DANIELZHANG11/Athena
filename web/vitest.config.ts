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
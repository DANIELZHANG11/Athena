/// <reference types="vitest" />
import { mergeConfig } from 'vite'
import { defineConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(viteConfig, defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/__tests__/*.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/test/**/*',
        'src/vite-env.d.ts',
        'src/main.tsx',
        'src/dev/**'
      ],
      all: true,
      thresholds: {
        // 初始设置较低，后续逐步提高
        statements: 0,
        branches: 0,
        functions: 0,
        lines: 0
      }
    },
  },
}))

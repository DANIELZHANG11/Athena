/**
 * Cypress 端到端测试配置
 * - 设置 `baseUrl` 与自定义任务日志
 * - 使用 `cypress/support/e2e.js` 作为支持文件
 */
import { defineConfig } from 'cypress'
export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:4173',
    supportFile: 'cypress/support/e2e.js',
    setupNodeEvents(on, config) {
      on('task', {
        log(message) {
          console.log(message)
          return null
        },
        error(message) {
          console.error(message)
          return null
        }
      })
      return config
    }
  }
})

import { defineConfig } from 'cypress'
export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:4173',
    supportFile: 'cypress/support/e2e.js',
    setupNodeEvents(on, config) {
      on('task', {
        log(message: string) {
          console.log(message)
          return null
        },
        error(message: string) {
          console.error(message)
          return null
        }
      })
      return config
    }
  }
})
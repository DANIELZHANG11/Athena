declare global {
  namespace Cypress {
    interface Chainable {
      login(): Chainable<void>
    }
    interface AUTWindow {
      __e2e_logs?: unknown[]
      __e2e_errors?: unknown[]
    }
  }
}

export {}

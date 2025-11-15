// custom commands
Cypress.Commands.add('login', () => {
  cy.intercept('POST', /\/api\/v1\/auth\/email\/send[-_]code(?:\?.*)?$/).as('sendCode')
  cy.intercept('POST', /\/api\/v1\/auth\/email\/verify[-_]code(?:\?.*)?$/).as('verifyCode')

  // optional: profile fetch not required in current app flow

  cy.visit('/login')
  cy.get('input[aria-label="邮箱"]').type('e2e@example.com')
  cy.get('[data-testid="login-send"]').click()
  cy.wait('@sendCode')

  cy.get('input[aria-label="验证码"]').type('123456')
  cy.log('[E2E DEBUG] Preparing to click Login button...')
  cy.get('[data-testid="login-submit"]').debug()
  cy.get('[data-testid="login-submit"]').click()
  cy.log('[E2E DEBUG] Login button has been clicked. Waiting for API call...')
  cy.debug()
  cy.wait('@verifyCode', { timeout: 10000 })

  cy.url().should('include', '/')
})
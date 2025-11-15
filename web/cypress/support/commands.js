// custom commands
Cypress.Commands.add('login', () => {
  cy.intercept('POST', /\/api\/v1\/auth\/email\/send[-_]code$/).as('sendCode')
  cy.intercept('POST', /\/api\/v1\/auth\/email\/verify[-_]code$/).as('verifyCode')

  cy.intercept('GET', '/api/v1/profile/me', { statusCode: 200, body: { data: { display_name: 'E2E User' } } }).as('getProfile')

  cy.visit('/login')
  cy.get('input[aria-label="邮箱"]').type('e2e@example.com')
  cy.contains('发送验证码').click()
  cy.wait('@sendCode')

  cy.get('input[aria-label="验证码"]').type('123456')
  cy.log('[E2E DEBUG] Preparing to click Login button...')
  cy.contains('登录').debug()
  cy.contains('登录').click()
  cy.log('[E2E DEBUG] Login button has been clicked. Waiting for API call...')
  cy.debug()
  cy.wait('@verifyCode', { timeout: 10000 })
  cy.wait('@getProfile')

  cy.url().should('include', '/')
})
// custom commands
Cypress.Commands.add('login', () => {
  cy.intercept('POST', /\/api\/v1\/auth\/email\/send[-_]code(?:\?.*)?$/, {
    statusCode: 200,
    body: { status: 'success', message: 'Code sent', data: { dev_code: '123456' } }
  }).as('sendCode')
  cy.intercept('POST', /\/api\/v1\/auth\/email\/verify[-_]code(?:\?.*)?$/, {
    statusCode: 200,
    body: {
      status: 'success',
      data: {
        tokens: { access_token: 'fake-jwt-token', refresh_token: 'fake-refresh', expires_in: 3600 },
        user: { id: 'u1', email: 'e2e@example.com', nickname: 'E2E User' }
      }
    }
  }).as('verifyCode')

  // optional: profile fetch not required in current app flow

  cy.visit('/login', {
    onBeforeLoad(win) {
      Object.defineProperty(win.navigator, 'language', { value: 'zh-CN' })
      Object.defineProperty(win.navigator, 'languages', { value: ['zh-CN'] })
      win.localStorage.setItem('i18nextLng', 'zh-CN')
    }
  })

  cy.get('#email').type('e2e@example.com')
  cy.get('[data-testid="login-send"]').click()
  cy.wait('@sendCode')

  cy.get('#code').type('123456')
  cy.log('[E2E DEBUG] Preparing to click Login button...')
  cy.get('[data-testid="login-submit"]').debug()
  cy.get('[data-testid="login-submit"]').click()
  cy.log('[E2E DEBUG] Login button has been clicked. Waiting for API call...')
  cy.debug()
  cy.wait('@verifyCode', { timeout: 10000 })

  cy.url().should('include', '/')
})
// custom commands
Cypress.Commands.add('login', () => {
  cy.intercept('POST', /\/api\/v1\/auth\/email\/send[-_]code/, {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: { status: 'success' }
  }).as('sendCode')

  cy.intercept('POST', /\/api\/v1\/auth\/email\/verify[-_]code/, {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: {
      status: 'success',
      data: { tokens: { access_token: 'fake-access-token', refresh_token: 'fake-refresh-token' } }
    }
  }).as('verifyCode')

  cy.intercept('GET', '/api/v1/billing/balance', {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: { data: { balance: 100, wallet_amount: 10, wallet_currency: 'CNY' } }
  }).as('getBalance')

  cy.intercept('GET', '/api/v1/billing/ledger', {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: { data: [{ direction: 'debit', amount: 1, currency: 'CNY', reason: 'tts' }] }
  }).as('getLedger')

  cy.visit('/login', { onBeforeLoad: (win) => win.localStorage.setItem('i18nextLng', 'zh-CN') })
  cy.get('input[aria-label="邮箱"]').type('e2e@example.com')
  cy.contains('发送验证码').click()
  cy.wait('@sendCode')
  cy.get('input[aria-label="验证码"]').type('123456')
  cy.contains('登录').click()
  cy.wait('@verifyCode', { timeout: 10000 })
  cy.url().should('include', '/')
})
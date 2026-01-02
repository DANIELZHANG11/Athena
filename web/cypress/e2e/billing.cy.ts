/// <reference types="cypress" />

describe('Billing page', () => {
  it('shows balance and ledger list', () => {
    cy.login()

    cy.intercept('GET', '/api/v1/billing/balance', {
      statusCode: 200,
      body: { status: 'success', data: { balance: 1234, wallet_amount: 56.78, wallet_currency: 'CNY' } }
    }).as('balance')

    cy.intercept('GET', '/api/v1/billing/ledger', {
      statusCode: 200,
      body: { status: 'success', data: [{ direction: 'debit', amount: 50, currency: 'CREDITS', reason: 'tts' }] }
    }).as('ledger')

    // Force zh-CN when visiting
    cy.visit('/billing', {
      onBeforeLoad(win) {
        Object.defineProperty(win.navigator, 'language', { value: 'zh-CN' })
        Object.defineProperty(win.navigator, 'languages', { value: ['zh-CN'] })
        win.localStorage.setItem('i18nextLng', 'zh-CN')
      }
    })

    cy.contains('余额').should('exist')
    cy.contains('账单').should('exist')
    // The Credits text might be consistent across languages or come from API data structure
    cy.get('div').contains('Credits').should('exist')
    cy.wait('@ledger')
    cy.get('ul li').its('length').should('be.greaterThan', 0)
  })
})
/// <reference types="cypress" />

describe('Billing page', () => {
  it('shows balance and ledger list', () => {
    cy.visit('/login')
    cy.window().then((win) => win.localStorage.setItem('access_token', 'test-token'))
    cy.intercept('GET', '/api/v1/billing/balance', {
      statusCode: 200,
      body: { status: 'success', data: { balance: 1234, wallet_amount: 56.78, wallet_currency: 'CNY' } }
    }).as('balance')
    cy.intercept('GET', '/api/v1/billing/ledger', {
      statusCode: 200,
      body: { status: 'success', data: [{ direction: 'debit', amount: 50, currency: 'CREDITS', reason: 'tts' }] }
    }).as('ledger')
    cy.visit('/billing')
    cy.contains('余额').should('exist')
    cy.contains('账单').should('exist')
    cy.get('div').contains('Credits').should('exist')
    cy.wait('@ledger')
    cy.get('ul li').its('length').should('be.greaterThan', 0)
  })
})
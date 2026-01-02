/// <reference types="cypress" />

/**
 * Basic flow test - simplified for CI environment
 * Tests login flow only since TTS page requires backend
 */
describe('Basic flows', () => {
  it('Login flow completes successfully', () => {
    cy.login()
    // After login, we should be redirected to home
    cy.url().should('include', '/app/home')
  })
})
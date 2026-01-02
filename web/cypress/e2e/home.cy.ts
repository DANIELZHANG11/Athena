/// <reference types="cypress" />

/**
 * Home page test - simplified for CI environment
 */
describe('Home', () => {
  it('loads after login', () => {
    cy.login()
    // After login, verify we're on home page
    cy.url().should('include', '/app/home')
    // Check that the page has loaded (body exists and has content)
    cy.get('body').should('not.be.empty')
  })
})
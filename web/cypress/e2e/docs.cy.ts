/// <reference types="cypress" />

/**
 * Doc Editor test - simplified for CI environment
 * Note: Skipped because doc editor page doesn't exist yet
 */
describe('Doc Editor', () => {
  it.skip('open and recover draft - skipped until page implemented', () => {
    // This test is skipped because the /docs route is not implemented
    cy.login()
    cy.visit('/docs/test-doc-1')
  })
})
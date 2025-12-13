/// <reference types="cypress" />

describe('Home', () => {
  it('loads and switches language', () => {
    cy.login()
    cy.window().then((win) => {
      const logs = Array.isArray((win as any).__e2e_logs) ? (win as any).__e2e_logs : []
      const errs = Array.isArray((win as any).__e2e_errors) ? (win as any).__e2e_errors : []
      logs.forEach((m: unknown) => cy.task('log', m))
      errs.forEach((m: unknown) => cy.task('error', m))
    })
    cy.window().then((win) => cy.log('Page URL is: ' + win.location.href))
    cy.get('body').then(($b) => cy.log($b.html() || ''))
    cy.contains(/雅典娜|Athena|homepage\.title/, { timeout: 10000 })
    cy.window().then((win) => win.localStorage.setItem('i18nextLng', 'en-US'))
    cy.reload()
    cy.contains('Athena', { timeout: 10000 })
  })
})
/// <reference types="cypress" />

describe('Home', () => {
  it('loads and switches language', () => {
    cy.login()
    cy.window().then((win) => cy.log('Page URL is: ' + win.location.href))
    cy.get('body').then(($b) => cy.log($b.html() || ''))
    cy.contains(/雅典娜|Athena|homepage\.title/, { timeout: 10000 })
    cy.window().then((win) => win.localStorage.setItem('i18nextLng', 'en-US'))
    cy.reload()
    cy.contains('Athena', { timeout: 10000 })
  })
})
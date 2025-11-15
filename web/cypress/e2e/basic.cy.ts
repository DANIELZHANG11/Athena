/// <reference types="cypress" />

describe('Basic flows', () => {
  it('Login and open TTS', () => {
    cy.login()
    cy.window().then((win) => {
      const logs = Array.isArray(win.__e2e_logs) ? win.__e2e_logs : []
      const errs = Array.isArray(win.__e2e_errors) ? win.__e2e_errors : []
      logs.forEach((m) => cy.task('log', m))
      errs.forEach((m) => cy.task('error', m))
    })
    cy.visit('/tts', { onBeforeLoad: (win) => win.localStorage.setItem('i18nextLng', 'zh-CN') })
    cy.url().should('include', '/tts')
    cy.window().then((win) => cy.log('Page URL is: ' + win.location.href))
    cy.get('body').then(($b) => cy.log($b.html() || ''))
    cy.contains(/生成并播放|Generate \& Play|tts\.start/, { timeout: 10000 }).should('exist')
  })
})
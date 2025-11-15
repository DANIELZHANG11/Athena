/// <reference types="cypress" />

describe('Basic flows', () => {
  it('Login and open TTS', () => {
    cy.login()
    cy.visit('/tts', { onBeforeLoad: (win) => win.localStorage.setItem('i18nextLng', 'zh-CN') })
    cy.url().should('include', '/tts')
    cy.window().then((win) => cy.log('Page URL is: ' + win.location.href))
    cy.get('body').then(($b) => cy.log($b.html() || ''))
    cy.contains(/生成并播放|Generate \& Play|tts\.start/, { timeout: 10000 }).should('exist')
  })
})
/// <reference types="cypress" />

describe('Basic flows', () => {
  it('Login and open TTS', () => {
    cy.visit('/login')
    cy.get('input[aria-label="邮箱"]').type('e2e@example.com')
    cy.contains('发送验证码').click()
    cy.get('input[aria-label="验证码"]').type('123456')
    cy.contains('登录').click()
    cy.url().should('include', '/')
    cy.window().then((win) => win.localStorage.setItem('i18nextLng', 'zh-CN'))
    cy.visit('/tts')
    cy.get('select').select('zh-CN')
    cy.url().should('include', '/tts')
    cy.contains('生成并播放', { timeout: 10000 }).should('exist')
  })
})
/// <reference types="cypress" />
describe('Accessibility', () => {
  it('Login page has no serious violations', () => {
    cy.visit('/login')
    cy.request('https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.7.2/axe.min.js').then((resp) => {
      cy.window().then((win: any) => { (win as any).eval(resp.body) })
    })
    cy.wait(500)
    cy.window().then(async (win: any) => {
      const results = await (win as any).axe.run(win.document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })
      const bad = (results.violations || []).filter((v: any) => v.impact === 'serious' || v.impact === 'critical')
      expect(bad.length).to.eq(0)
    })
  })
})
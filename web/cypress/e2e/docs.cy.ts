/// <reference types="cypress" />

describe('Doc Editor', () => {
  it('open and recover draft', () => {
    cy.window().then((win) => win.localStorage.setItem('access_token', 'test-token'))
    cy.intercept('GET', '/api/v1/docs/test-doc-1/conflicts', {
      statusCode: 200,
      body: { status: 'success', data: [{ id: 'c1', base_version: 1, actual_version: 2, created_at: '2025-01-01T00:00:00Z' }] }
    }).as('conflicts')
    cy.intercept('POST', '/api/v1/docs/test-doc-1/draft/recover', {
      statusCode: 200,
      body: { status: 'success', data: { draft_id: 'd1', snapshot: 'restored-content' } }
    }).as('recover')
    cy.visit('/docs/test-doc-1')
    cy.contains('发送').should('exist')
    cy.window().then((win: any) => {
      // Trigger conflict with mismatched base_version
      win.__sendDoc(999, 'force-conflict')
    })
    cy.contains('冲突').click()
    cy.wait('@conflicts')
    cy.contains('恢复草稿').click()
    cy.wait('@recover')
    cy.get('textarea').should('have.value', 'restored-content')
  })
})
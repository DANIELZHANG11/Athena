```cypress
/// <reference types="cypress" />

describe('Doc Editor', () => {
  it('open and recover draft', () => {
    cy.login()
    
    cy.intercept('GET', '/api/v1/docs/test-doc-1/conflicts', {
      statusCode: 200,
      body: { status: 'success', data: [{ id: 'c1', base_version: 1, actual_version: 2, created_at: '2025-01-01T00:00:00Z' }] }
    }).as('conflicts')

    cy.intercept('POST', '/api/v1/docs/test-doc-1/draft/recover', {
      statusCode: 200,
      body: { status: 'success', data: { draft_id: 'd1', snapshot: 'restored-content' } }
    }).as('recover')

    // Force zh-CN
    cy.visit('/docs/test-doc-1', {
      onBeforeLoad(win) {
        Object.defineProperty(win.navigator, 'language', { value: 'zh-CN' })
        Object.defineProperty(win.navigator, 'languages', { value: ['zh-CN'] })
        win.localStorage.setItem('i18nextLng', 'zh-CN')
      }
    })

    cy.contains('发送').should('exist')

    cy.window().then((win: any) => {
      // Trigger conflict with mismatched base_version
      if (win.__sendDoc) {
        win.__sendDoc(999, 'force-conflict')
      } else {
        // If window.__sendDoc isn't available immediately, we might need to wait or it's attached by the component
        cy.log('__sendDoc not found on window')
      }
    })

    // Wait for the conflict dialog or indicator
    // Assuming '冲突' appears in a dialog or status area
    cy.contains('冲突').should('be.visible').click()
    cy.wait('@conflicts')
    cy.contains('恢复草稿').click()
    cy.wait('@recover')
    cy.get('textarea').should('have.value', 'restored-content')
  })
})
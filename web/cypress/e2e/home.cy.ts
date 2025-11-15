describe('Home', () => {
  it('loads and switches language', () => {
    cy.visit('/')
    cy.contains('雅典娜')
    cy.get('select').select('en-US')
    cy.contains('Athena')
  })
})
/// <reference types="cypress" />

describe('Authentication', () => {
    beforeEach(() => {

        it('should complete login flow with valid credentials', () => {
            // Mock API responses
            cy.intercept('POST', /\/api\/v1\/auth\/email\/send[-_]code(?:\?.*)?$/, {
                statusCode: 200,
                body: { message: 'Code sent' }
            }).as('sendCode')

            cy.intercept('POST', /\/api\/v1\/auth\/email\/verify[-_]code(?:\?.*)?$/, {
                statusCode: 200,
                /// <reference types="cypress" />

                describe('Authentication', () => {
                    beforeEach(() => {

                        it('should complete login flow with valid credentials', () => {
                // Mock API responses
                cy.intercept('POST', /\/api\/v1\/auth\/email\/send[-_]code(?:\?.*)?$/, {
                    statusCode: 200,
                    body: { message: 'Code sent' }
                }).as('sendCode')

            cy.intercept('POST', /\/api\/v1\/auth\/email\/verify[-_]code(?:\?.*)?$/, {
                    statusCode: 200,
                    body: {
                        token: 'fake-jwt-token',
                        user: { id: 'u1', email: 'e2e@example.com' }
                    }
                }).as('verifyCode')

            cy.get('#email').type('e2e@example.com')
            cy.get('[data-testid="login-send"]').click()
            cy.wait('@sendCode')

            cy.get('#code').should('be.visible').type('123456')
            cy.get('[data-testid="login-submit"]').click()
            cy.wait('@verifyCode')

            cy.url().should('not.include', '/login')
            })
        })

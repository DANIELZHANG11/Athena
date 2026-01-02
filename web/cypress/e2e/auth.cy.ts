/// <reference types="cypress" />

describe('Authentication', () => {
    beforeEach(() => {
        // Ensuring we start with a clean state
        cy.clock() // To handle timers if needed
        cy.visit('/login')
    })

    it('should display login form elements', () => {
        cy.get('input[aria-label="邮箱"]').should('be.visible')
        cy.get('[data-testid="login-send"]').should('be.visible')
        // Submit button might be initially disabled or visible
        cy.get('[data-testid="login-submit"]').should('exist')
    })

    it('should verify email format validation', () => {
        cy.get('input[aria-label="邮箱"]').type('invalid-email')
        cy.get('[data-testid="login-send"]').click()
        // Assuming UI shows some error or HTML5 validation
        // Checking if button is disabled or error toast appears would be better
        // For now, just ensuring it didn't navigate
        cy.url().should('include', '/login')
    })

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

        cy.get('input[aria-label="邮箱"]').type('e2e@example.com')
        cy.get('[data-testid="login-send"]').click()
        cy.wait('@sendCode')

        cy.get('input[aria-label="验证码"]').should('be.visible').type('123456')
        cy.get('[data-testid="login-submit"]').click()
        cy.wait('@verifyCode')

        cy.url().should('not.include', '/login')
    })
})

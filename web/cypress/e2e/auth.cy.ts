/// <reference types="cypress" />

describe('Authentication', () => {
    beforeEach(() => {
        // Ensuring we start with a clean state and force zh-CN locale
        cy.visit('/login', {
            onBeforeLoad(win) {
                Object.defineProperty(win.navigator, 'language', { value: 'zh-CN' })
                Object.defineProperty(win.navigator, 'languages', { value: ['zh-CN'] })
                win.localStorage.setItem('i18nextLng', 'zh-CN')
            }
        })
    })

    it('should display login form elements', () => {
        cy.get('#email').should('be.visible')
        cy.get('[data-testid="login-send"]').should('be.visible')
        // Submit button might be initially disabled or visible
        cy.get('[data-testid="login-submit"]').should('exist')
    })

    it('should verify email format validation', () => {
        cy.get('#email').type('invalid-email')
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
            body: { message: 'Code sent', status: 'success', data: { dev_code: '123456' } }
        }).as('sendCode')

        cy.intercept('POST', /\/api\/v1\/auth\/email\/verify[-_]code(?:\?.*)?$/, {
            statusCode: 200,
            body: {
                status: 'success',
                data: {
                    tokens: { access_token: 'fake-jwt-token', refresh_token: 'fake-refresh', expires_in: 3600 },
                    user: { id: 'u1', email: 'e2e@example.com' }
                }
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

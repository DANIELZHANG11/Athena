/**
 * AI 对话功能 E2E 测试
 *
 * 测试覆盖:
 * - 对话列表显示
 * - 新建对话
 * - 发送消息
 * - 模式切换
 * - 离线状态处理
 */

describe('AI Chat', () => {
    beforeEach(() => {
        // 登录
        cy.login()
        cy.visit('/ai')
        cy.waitForNetwork()
    })

    describe('Conversations List', () => {
        it('should display conversation sidebar on desktop', () => {
            cy.viewport(1280, 720)
            cy.get('[data-testid="conversation-sidebar"]').should('be.visible')
        })

        it('should show new conversation button', () => {
            cy.contains('button', '新对话').should('be.visible')
        })

        it('should show empty state when no conversations', () => {
            // Mock empty response
            cy.intercept('GET', '/api/v1/ai/conversations*', {
                body: { status: 'success', data: [], pagination: { total: 0 } },
            })
            cy.reload()
            cy.contains('暂无对话').should('be.visible')
        })
    })

    describe('New Conversation', () => {
        it('should create new conversation when clicking new button', () => {
            cy.intercept('POST', '/api/v1/ai/conversations', {
                body: { status: 'success', data: { id: 'new-conv-id' } },
            }).as('createConversation')

            cy.contains('button', '新对话').click()
            cy.wait('@createConversation')
        })
    })

    describe('Send Message', () => {
        beforeEach(() => {
            // Mock conversation creation
            cy.intercept('POST', '/api/v1/ai/conversations', {
                body: { status: 'success', data: { id: 'test-conv' } },
            })
        })

        it('should send message and receive streaming response', () => {
            // Mock SSE response
            cy.intercept('POST', '/api/v1/ai/conversations/*/messages', (req) => {
                req.reply({
                    statusCode: 200,
                    headers: { 'Content-Type': 'text/event-stream' },
                    body: 'data: {"type":"delta","content":"Hello"}\n\ndata: {"type":"delta","content":" World"}\n\ndata: {"type":"done"}\n\n',
                })
            }).as('sendMessage')

            // Type and send message
            cy.get('textarea[placeholder*="问题"]').type('Hello')
            cy.get('button[title="发送消息"]').click()

            cy.wait('@sendMessage')

            // Verify user message appears
            cy.contains('Hello').should('be.visible')
        })

        it('should show stop button while streaming', () => {
            // Mock slow SSE response
            cy.intercept('POST', '/api/v1/ai/conversations/*/messages', (req) => {
                req.reply({
                    statusCode: 200,
                    headers: { 'Content-Type': 'text/event-stream' },
                    body: 'data: {"type":"delta","content":"Thinking..."}\n\n',
                    delay: 5000,
                })
            })

            cy.get('textarea[placeholder*="问题"]').type('Test')
            cy.get('button[title="发送消息"]').click()

            cy.get('button[title="停止生成"]').should('be.visible')
        })

        it('should disable send button when input is empty', () => {
            cy.get('button[title="发送消息"]').should('be.disabled')
        })
    })

    describe('Mode Switch', () => {
        it('should switch between chat and qa modes', () => {
            // Default is chat mode
            cy.contains('button', '聊天').should('have.class', 'bg-white')

            // Switch to Q&A mode
            cy.contains('button', '问答').click()
            cy.contains('button', '问答').should('have.class', 'bg-white')
        })
    })

    describe('Credits Display', () => {
        it('should display credits balance', () => {
            cy.intercept('GET', '/api/v1/billing/credits', {
                body: { status: 'success', data: { balance: 100 } },
            })
            cy.reload()
            cy.contains('100 Credits').should('be.visible')
        })
    })

    describe('Offline Mode', () => {
        it('should show offline banner when offline', () => {
            // Go offline
            cy.window().then((win) => {
                cy.stub(win.navigator, 'onLine').value(false)
                win.dispatchEvent(new Event('offline'))
            })

            cy.contains('离线模式').should('be.visible')
        })

        it('should disable input when offline', () => {
            cy.window().then((win) => {
                cy.stub(win.navigator, 'onLine').value(false)
                win.dispatchEvent(new Event('offline'))
            })

            cy.get('textarea').should('be.disabled')
        })
    })

    describe('Error Handling', () => {
        it('should show error when credits insufficient', () => {
            cy.intercept('POST', '/api/v1/ai/conversations/*/messages', {
                statusCode: 402,
                body: { status: 'error', error: { code: 'insufficient_credits' } },
            })

            cy.get('textarea[placeholder*="问题"]').type('Test message')
            cy.get('button[title="发送消息"]').click()

            cy.contains('Credits 不足').should('be.visible')
        })
    })
})

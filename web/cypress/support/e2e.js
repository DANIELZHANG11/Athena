// support
require('./commands')
Cypress.on('uncaught:exception', () => false)

Cypress.on('window:before:load', (win) => {
  win.__e2e_logs = []
  win.__e2e_errors = []
  const wrap = (method) => {
    const orig = win.console[method]
    win.console[method] = (...args) => {
      try {
        const msg = args.map(a => {
          try { return typeof a === 'string' ? a : JSON.stringify(a) } catch { return String(a) }
        }).join(' ')
        ;(method === 'error' ? win.__e2e_errors : win.__e2e_logs).push(msg)
      } catch {}
      orig && orig(...args)
    }
  }
  wrap('log')
  wrap('error')
})
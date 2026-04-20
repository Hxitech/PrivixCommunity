import test, { after } from 'node:test'
import assert from 'node:assert/strict'

const { api } = await import('../src/lib/tauri-api.js')
const hermesEngine = (await import('../src/engines/hermes/index.js')).default

const originalCheckHermes = api.checkHermes

after(() => {
  api.checkHermes = originalCheckHermes
})

test('Hermes engine registers public routes that should open directly in Hermes mode', () => {
  const routes = hermesEngine.getRoutes().map(route => route.path)

  assert.ok(routes.includes('/clawswarm'))
  assert.ok(routes.includes('/star-office'))
  assert.ok(routes.includes('/quick-setup'))
  assert.ok(routes.includes('/logs'))
  assert.ok(routes.includes('/diagnose'))
})

test('Hermes setup nav hides secondary routes until Hermes is ready', async () => {
  api.checkHermes = async () => ({ installed: false, configExists: false, gatewayRunning: false })
  await hermesEngine.detect()

  const items = hermesEngine.getNavItems().flatMap(section => section.items || [])
  const routes = items.map(item => item.route)

  assert.ok(routes.includes('/h/setup'))
  assert.ok(routes.includes('/assistant'))
  assert.ok(routes.includes('/settings'))
  assert.ok(routes.includes('/about'))
})

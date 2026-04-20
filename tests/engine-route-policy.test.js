import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ENGINE_ROUTE_IDS,
  HERMES_DIRECT_ROUTES,
  canRouteRunInEngine,
  getRouteRequiredEngine,
  isHermesDirectRoute,
} from '../src/lib/engine-route-policy.js'

test('Hermes direct-route list includes agreed public pages', () => {
  assert.ok(HERMES_DIRECT_ROUTES.includes('/clawswarm'))
  assert.ok(HERMES_DIRECT_ROUTES.includes('/quick-setup'))
  assert.ok(HERMES_DIRECT_ROUTES.includes('/star-office'))
})

test('isHermesDirectRoute accepts Hermes pages and shared public pages', () => {
  assert.equal(isHermesDirectRoute('/h/dashboard'), true)
  assert.equal(isHermesDirectRoute('/clawswarm?tab=review'), true)
  assert.equal(isHermesDirectRoute('/pipeline'), false)
})

test('Hermes route policy does not require engine switch for shared public pages', () => {
  assert.equal(getRouteRequiredEngine(ENGINE_ROUTE_IDS.HERMES, '/clawswarm'), null)
  assert.equal(getRouteRequiredEngine(ENGINE_ROUTE_IDS.HERMES, '/quick-setup'), null)
  assert.equal(getRouteRequiredEngine(ENGINE_ROUTE_IDS.HERMES, '/star-office'), null)
})

test('Hermes route policy still routes OpenClaw-only pages back to OpenClaw', () => {
  assert.equal(getRouteRequiredEngine(ENGINE_ROUTE_IDS.HERMES, '/pipeline'), ENGINE_ROUTE_IDS.OPENCLAW)
  assert.equal(getRouteRequiredEngine(ENGINE_ROUTE_IDS.HERMES, '/models'), ENGINE_ROUTE_IDS.OPENCLAW)
  assert.equal(getRouteRequiredEngine(ENGINE_ROUTE_IDS.HERMES, '/services'), ENGINE_ROUTE_IDS.OPENCLAW)
})

test('OpenClaw engine can run any registered app route', () => {
  assert.equal(canRouteRunInEngine(ENGINE_ROUTE_IDS.OPENCLAW, '/pipeline'), true)
  assert.equal(canRouteRunInEngine(ENGINE_ROUTE_IDS.OPENCLAW, '/h/dashboard'), true)
})

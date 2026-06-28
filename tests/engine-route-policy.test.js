import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ENGINE_ROUTE_IDS,
  HERMES_DIRECT_ROUTES,
  canRouteRunInEngine,
  getRouteRequiredEngine,
  isHermesDirectRoute,
  isHermesEngineRoute,
} from '../src/lib/engine-route-policy.js'

test('Hermes direct-route list includes agreed public pages', () => {
  assert.ok(HERMES_DIRECT_ROUTES.includes('/clawswarm'))
  assert.ok(HERMES_DIRECT_ROUTES.includes('/quick-setup'))
  assert.ok(HERMES_DIRECT_ROUTES.includes('/star-office'))
})

test('isHermesDirectRoute accepts Hermes pages and shared public pages', () => {
  assert.equal(isHermesEngineRoute('/h/dashboard'), true)
  assert.equal(isHermesEngineRoute('/clawswarm'), false)
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

test('OpenClaw route policy routes Hermes pages to Hermes', () => {
  // OpenClaw 引擎能跑任意非 Hermes 路由
  assert.equal(canRouteRunInEngine(ENGINE_ROUTE_IDS.OPENCLAW, '/pipeline'), true)
  // 但 Hermes 深链(/h/*)必须切到 Hermes —— 修复深链直达时卡在 OpenClaw 下空白
  assert.equal(canRouteRunInEngine(ENGINE_ROUTE_IDS.OPENCLAW, '/h/dashboard'), false)
  assert.equal(getRouteRequiredEngine(ENGINE_ROUTE_IDS.OPENCLAW, '/h/dashboard'), ENGINE_ROUTE_IDS.HERMES)
  assert.equal(getRouteRequiredEngine(ENGINE_ROUTE_IDS.OPENCLAW, '/h/models?tab=main'), ENGINE_ROUTE_IDS.HERMES)
})

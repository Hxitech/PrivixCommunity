import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getProductProfile,
  getAllowedRoutes,
  isRouteAllowed,
  requiresOpenclawSetup,
  isModuleEnabled,
  isRouteModuleEnabled,
  setEnabledModules,
  MODULE_IDS,
  getRouteModule,
  getActiveProductProfile,
  getActiveProductProfileId,
  supportsPevcKnowledgeBase,
} from '../src/lib/product-profile.js'

test('community edition exposes unified privix-community profile', () => {
  const profile = getActiveProductProfile()
  assert.equal(getActiveProductProfileId(), 'privix-community')
  assert.equal(profile.id, 'privix-community')
  assert.equal(profile.productName, 'Privix Community')
})

test('allowed routes cover core OpenClaw + Hermes set', () => {
  const routes = getAllowedRoutes()
  assert.ok(routes.includes('/overview'))
  assert.ok(routes.includes('/dashboard'))
  assert.ok(routes.includes('/chat'))
  assert.ok(routes.includes('/models'))
  assert.ok(routes.includes('/agents'))
  assert.ok(routes.includes('/gateway'))
  assert.ok(routes.includes('/skills'))
  assert.ok(routes.includes('/assistant'))
  assert.ok(routes.includes('/h/dashboard'))
  assert.ok(routes.includes('/h/chat'))
  assert.equal(routes.includes('/nonexistent'), false)
})

test('community edition strips proprietary routes', () => {
  const routes = getAllowedRoutes()
  const stripped = ['/invest-dashboard', '/pipeline', '/pool', '/companies',
    '/contacts', '/deal', '/audit', '/scoring', '/automation', '/knowledge',
    '/sop', '/evoscientist', '/clawswarm', '/star-office', '/invest-repair']
  for (const r of stripped) {
    assert.equal(routes.includes(r), false, `${r} should be removed from community edition`)
  }
})

test('isRouteAllowed reflects the allowed set', () => {
  assert.equal(isRouteAllowed('/chat'), true)
  assert.equal(isRouteAllowed('/dashboard'), true)
  assert.equal(isRouteAllowed('/pipeline'), false)
  assert.equal(isRouteAllowed('/invest-dashboard'), false)
  assert.equal(isRouteAllowed('/knowledge'), false)
})

test('only BASE module is defined and always enabled', () => {
  assert.equal(Object.keys(MODULE_IDS).length, 1)
  assert.equal(MODULE_IDS.BASE, 'base')
  assert.equal(isModuleEnabled(MODULE_IDS.BASE), true)
})

test('setEnabledModules is a no-op beyond BASE in community edition', () => {
  setEnabledModules([MODULE_IDS.BASE])
  assert.equal(isModuleEnabled(MODULE_IDS.BASE), true)
})

test('isRouteModuleEnabled proxies to isRouteAllowed', () => {
  assert.equal(isRouteModuleEnabled('/chat'), true)
  assert.equal(isRouteModuleEnabled('/pipeline'), false)
})

test('getRouteModule returns BASE for allowed routes, null for denied', () => {
  assert.equal(getRouteModule('/chat'), MODULE_IDS.BASE)
  assert.equal(getRouteModule('/pipeline'), null)
})

test('requiresOpenclawSetup returns true for community edition', () => {
  assert.equal(requiresOpenclawSetup(), true)
})

test('supportsPevcKnowledgeBase is false in community edition', () => {
  assert.equal(supportsPevcKnowledgeBase(), false)
})

test('getProductProfile returns the unified profile regardless of input', () => {
  const a = getProductProfile('anything')
  const b = getProductProfile('privix-community')
  assert.equal(a.id, b.id)
  assert.equal(a.productName, 'Privix Community')
})

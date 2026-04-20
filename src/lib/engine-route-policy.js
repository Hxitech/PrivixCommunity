/**
 * 引擎路由策略
 * 统一描述 Hermes 模式下哪些页面可直接访问，避免导航 / 守卫 / 路由注册三处漂移。
 */

export const ENGINE_ROUTE_IDS = Object.freeze({
  OPENCLAW: 'openclaw',
  HERMES: 'hermes',
})

export const HERMES_DIRECT_ROUTES = Object.freeze([
  '/assistant',
  '/settings',
  '/about',
  '/logs',
  '/diagnose',
  '/evoscientist',
  '/clawswarm',
  '/star-office',
  '/quick-setup',
])

const HERMES_DIRECT_ROUTE_SET = new Set(HERMES_DIRECT_ROUTES)

function normalizeRoute(route = '') {
  const raw = String(route || '').replace(/^#/, '')
  const [path] = raw.split('?')
  return path || '/'
}

export function isHermesDirectRoute(route) {
  const path = normalizeRoute(route)
  return path.startsWith('/h/') || HERMES_DIRECT_ROUTE_SET.has(path)
}

export function canRouteRunInEngine(engineId, route) {
  if (engineId === ENGINE_ROUTE_IDS.HERMES) {
    return isHermesDirectRoute(route)
  }
  return true
}

export function getRouteRequiredEngine(activeEngineId, route) {
  if (activeEngineId === ENGINE_ROUTE_IDS.HERMES && !canRouteRunInEngine(activeEngineId, route)) {
    return ENGINE_ROUTE_IDS.OPENCLAW
  }
  return null
}

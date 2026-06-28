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

export function isHermesEngineRoute(route) {
  return normalizeRoute(route).startsWith('/h/')
}

export function isHermesDirectRoute(route) {
  const path = normalizeRoute(route)
  return isHermesEngineRoute(path) || HERMES_DIRECT_ROUTE_SET.has(path)
}

export function canRouteRunInEngine(engineId, route) {
  if (engineId === ENGINE_ROUTE_IDS.HERMES) {
    return isHermesDirectRoute(route)
  }
  // OpenClaw 引擎不能跑 Hermes 专属深链(/h/*),否则深链直达时会卡在错误引擎下空白
  if (engineId === ENGINE_ROUTE_IDS.OPENCLAW) {
    return !isHermesEngineRoute(route)
  }
  return true
}

export function getRouteRequiredEngine(activeEngineId, route) {
  // 当前在 OpenClaw 但目标是 Hermes 深链 → 要求切到 Hermes(修复深链直达路由加载)
  if (activeEngineId === ENGINE_ROUTE_IDS.OPENCLAW && isHermesEngineRoute(route)) {
    return ENGINE_ROUTE_IDS.HERMES
  }
  if (activeEngineId === ENGINE_ROUTE_IDS.HERMES && !canRouteRunInEngine(activeEngineId, route)) {
    return ENGINE_ROUTE_IDS.OPENCLAW
  }
  return null
}

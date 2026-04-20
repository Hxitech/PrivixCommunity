/**
 * 极简 hash 路由
 */
import { t } from './lib/i18n.js'

const routes = {}
const _moduleCache = {}
let _contentEl = null
let _loadId = 0
let _currentCleanup = null
let _initialized = false
let _indicatorFrame = 0
let _routeGuard = null
let _firstRouteSettled = false

let _defaultRoute = '/dashboard'

function announceFirstRouteReady(path, status = 'ready') {
  if (_firstRouteSettled) return
  _firstRouteSettled = true
  window.dispatchEvent(new CustomEvent('app:first-route-ready', {
    detail: { path, status },
  }))
}

export function registerRoute(path, loader) {
  routes[path] = loader
}

export function setDefaultRoute(path) {
  _defaultRoute = path
}

export function setRouteGuard(guard) {
  _routeGuard = guard
}

export function buildRouteHash(path, query = {}) {
  const normalized = String(path || '').replace(/^#/, '') || _defaultRoute
  const [basePath, existingSearch = ''] = normalized.split('?')
  const params = new URLSearchParams(existingSearch)
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value == null || value === '') params.delete(key)
    else params.set(key, String(value))
  })
  const search = params.toString()
  return search ? `${basePath}?${search}` : basePath
}

export function getHashPath(hash = globalThis?.window?.location?.hash, fallback = _defaultRoute) {
  const raw = String(hash || '').replace(/^#/, '') || fallback
  const [pathnameRaw] = raw.split('?')
  return pathnameRaw || fallback
}

export function navigate(pathOrState, query) {
  const targetHash = (typeof pathOrState === 'object' && pathOrState)
    ? buildRouteHash(pathOrState.path, pathOrState.query)
    : buildRouteHash(pathOrState, query)
  // hash 变了 → 浏览器 hashchange 自动触发 loadRoute;hash 未变(引擎切换到同名路由)→ 手动触发
  if (window.location.hash.slice(1) !== targetHash) {
    window.location.hash = targetHash
  } else {
    reloadCurrentRoute()
  }
}

export function initRouter(contentEl) {
  _contentEl = contentEl
  if (!_initialized) {
    window.addEventListener('hashchange', () => loadRoute())
    window.addEventListener('resize', syncActiveIndicator)
    _initialized = true
  }
  loadRoute()
}

async function loadRoute() {
  let routeState = getCurrentRouteState()
  if (_routeGuard) {
    try {
      const decision = await _routeGuard(routeState)
      if (decision?.redirectTo) {
        navigate(decision.redirectTo.path, decision.redirectTo.query)
        return
      }
      if (decision?.routeState) routeState = decision.routeState
    } catch (e) {
      console.warn('[router] 路由守卫执行失败:', e)
    }
  }

  const loader = routes[routeState.path]
  if (!loader || !_contentEl) return

  // 竞态防护：记录本次加载 ID
  const thisLoad = ++_loadId

  // 清理上一个页面
  if (_currentCleanup) {
    try { _currentCleanup() } catch (_) {}
    _currentCleanup = null
  }

  // 立即移除旧页面（不等退出动画，消除切换卡顿）
  _contentEl.innerHTML = ''

  // 已缓存的模块：跳过 spinner，直接渲染
  let mod = _moduleCache[routeState.path]
  if (!mod) {
    // 仅首次加载显示 spinner
    const spinnerEl = document.createElement('div')
    spinnerEl.className = 'page-loader'
    spinnerEl.innerHTML = `
      <div class="page-loader-shell">
        <div class="page-loader-spinner"></div>
        <div class="page-loader-copy">
          <div class="page-loader-kicker">Privix</div>
          <div class="page-loader-text">${escHtml(t('main.page_loading'))}</div>
        </div>
      </div>
    `
    _contentEl.appendChild(spinnerEl)

    try {
      mod = await retryLoad(loader, 3, 500)
    } catch (e) {
      console.error('[router] 模块加载失败:', routeState.raw, e)
      if (thisLoad === _loadId) {
        showLoadError(_contentEl, routeState.raw, e)
        announceFirstRouteReady(routeState.path, 'error')
      }
      return
    }
    _moduleCache[routeState.path] = mod
  }

  // 如果加载期间路由又变了，丢弃本次结果
  if (thisLoad !== _loadId) return

  let page
  try {
    const renderFn = mod.render || mod.default
    page = renderFn ? await withTimeout(renderFn(), 15000, '页面渲染超时') : mod
  } catch (e) {
    console.error('[router] 页面渲染失败:', routeState.raw, e)
    // 渲染失败时清除缓存，下次重试时重新加载模块
    delete _moduleCache[routeState.path]
    if (thisLoad === _loadId) {
      showLoadError(_contentEl, routeState.raw, e)
      announceFirstRouteReady(routeState.path, 'error')
    }
    return
  }
  if (thisLoad !== _loadId) return

  // 插入页面内容
  _contentEl.innerHTML = ''
  if (typeof page === 'string') {
    _contentEl.innerHTML = page
  } else if (page instanceof HTMLElement) {
    _contentEl.appendChild(page)
  }

  // 保存页面清理函数
  _currentCleanup = mod.cleanup || null

  announceFirstRouteReady(routeState.path)

  syncSidebarState(routeState)
}

async function retryLoad(loader, maxRetries, delayMs) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await withTimeout(loader(), 15000, '模块加载超时')
    } catch (e) {
      const isNetworkError = /fetch|network|connection|ERR_/i.test(String(e?.message || e))
      if (i < maxRetries && isNetworkError) {
        console.warn(`[router] 模块加载失败，${delayMs}ms 后重试 (${i + 1}/${maxRetries})...`)
        await new Promise(r => setTimeout(r, delayMs))
        continue
      }
      throw e
    }
  }
}

export function withTimeout(promise, ms, msg) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg || `超时(${ms / 1000}s)`)), ms))
  ])
}

function showLoadError(container, hash, error) {
  const name = hash.replace('/', '') || 'unknown'
  container.innerHTML = `
    <div class="page-loader">
      <div style="color:var(--error,#ef4444);margin-bottom:12px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      </div>
      <div class="page-loader-text" style="color:var(--text-primary)">页面加载失败</div>
      <div style="color:var(--text-tertiary);font-size:12px;margin:8px 0 16px;max-width:400px;word-break:break-all">${escHtml(String(error?.message || error))}</div>
      <button onclick="location.hash='${hash}';location.reload()" style="padding:6px 20px;border-radius:6px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:13px">重新加载</button>
    </div>
  `
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

export function getCurrentRoute() {
  return getCurrentRouteState().path
}

export function getCurrentRouteState() {
  const raw = window.location.hash.replace(/^#/, '') || _defaultRoute
  const [pathnameRaw, searchRaw = ''] = raw.split('?')
  const pathname = pathnameRaw || _defaultRoute
  const matched = resolveRoutePath(pathname)
  const suffix = matched === pathname ? '' : pathname.slice(matched.length)
  const segments = suffix.split('/').filter(Boolean)
  const query = {}
  const params = new URLSearchParams(searchRaw)
  for (const [key, value] of params.entries()) query[key] = value
  return {
    raw,
    path: matched,
    pathname,
    suffix,
    segments,
    query,
    search: searchRaw ? `?${searchRaw}` : '',
  }
}

export function reloadCurrentRoute() {
  loadRoute()
}

export function syncSidebarState(pathOrState = getCurrentRouteState()) {
  const routeState = typeof pathOrState === 'string'
    ? { path: pathOrState, query: {} }
    : (pathOrState || getCurrentRouteState())
  const currentHash = buildRouteHash(routeState.path, routeState.query)
  const hasQuery = routeState.query && Object.keys(routeState.query).length > 0

  document.querySelectorAll('.nav-item[data-route]').forEach(item => {
    const navHash = item.dataset.navHash || buildRouteHash(item.dataset.route || '')
    const isDefaultMatch = !hasQuery
      && item.dataset.navDefault === '1'
      && item.dataset.route === routeState.path
    item.classList.toggle('active', navHash === currentHash || isDefaultMatch)
  })
  document.querySelectorAll('.flyout-zone').forEach(zone => {
    const hasActive = !!zone.querySelector('.nav-item[data-route].active')
    zone.classList.toggle('zone-active', hasActive)
    const row = zone.querySelector('.flyout-zone-row')
    if (row) row.classList.toggle('active', hasActive)
  })
  syncActiveIndicator()
}

export function syncActiveIndicator() {
  if (_indicatorFrame) cancelAnimationFrame(_indicatorFrame)
  _indicatorFrame = requestAnimationFrame(() => {
    _indicatorFrame = 0

    const indicator = document.querySelector('.nav-zone-primary .nav-active-indicator')
    if (!indicator) return

    const activeItem = document.querySelector('.nav-zone-primary .nav-item.active')
    if (!activeItem) {
      indicator.style.opacity = '0'
      indicator.style.top = ''
      indicator.style.height = ''
      return
    }

    const zone = indicator.parentElement
    if (!zone) return

    const zoneRect = zone.getBoundingClientRect()
    const itemRect = activeItem.getBoundingClientRect()
    indicator.style.top = `${itemRect.top - zoneRect.top + zone.scrollTop}px`
    indicator.style.height = `${itemRect.height}px`
    indicator.style.opacity = '1'
  })
}

function resolveRoutePath(pathname) {
  if (routes[pathname]) return pathname
  const matches = Object.keys(routes)
    .filter(route => pathname === route || pathname.startsWith(`${route}/`) || pathname.startsWith(`${route}?`))
    .sort((a, b) => b.length - a.length)
  return matches[0] || pathname
}

/**
 * Hermes Agent 引擎
 */
import { t } from '../../lib/i18n.js'
import { HERMES_DIRECT_ROUTES } from '../../lib/engine-route-policy.js'
import { api, invalidate } from '../../lib/tauri-api.js'

// Hermes 状态
let _ready = false
let _running = false
let _listeners = []
let _pollTimer = null

async function detectHermesStatus() {
  try {
    invalidate('check_hermes')
    const info = await api.checkHermes()
    _ready = !!info?.installed && !!info?.configExists
    _running = !!info?.gatewayRunning
  } catch (_) {
    _ready = false
    _running = false
  }
  _listeners.forEach(fn => { try { fn({ ready: _ready, running: _running }) } catch (_) {} })
  return _ready
}

function startPoll() {
  if (_pollTimer) return
  _pollTimer = setInterval(detectHermesStatus, 15000)
}

function stopPoll() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null }
}

export default {
  id: 'hermes',
  name: 'Hermes Agent',
  description: 'Hermes AI Agent with tool-calling capabilities',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',

  async detect() {
    await detectHermesStatus()
    return { installed: _ready, ready: _ready }
  },

  async boot() {
    await detectHermesStatus()
    startPoll()
  },

  cleanup() {
    stopPoll()
  },

  getNavItems() {
    if (!_ready) {
      return [{
        section: '',
        items: [
          { route: '/h/setup', label: t('sidebar.setup') || '安装向导', icon: 'setup' },
          { route: '/assistant', label: t('sidebar.assistant') || 'Assistant', icon: 'assistant' },
        ]
      }, {
        section: '',
        items: [
          { route: '/settings', label: t('sidebar.settings') || '设置', icon: 'settings' },
          { route: '/about', label: t('sidebar.about') || '关于', icon: 'about' },
        ]
      }]
    }
    return [{
      section: t('sidebar.sectionMonitor') || '监控',
      items: [
        { route: '/h/dashboard', label: t('sidebar.dashboard') || '仪表盘', icon: 'dashboard' },
        { route: '/h/chat', label: t('sidebar.chat') || '聊天', icon: 'chat' },
        { route: '/h/logs', label: t('sidebar.logs') || '日志', icon: 'logs' },
      ]
    }, {
      section: t('sidebar.sectionManage') || '管理',
      items: [
        { route: '/h/skills', label: t('sidebar.skills') || 'Skills', icon: 'skills' },
        { route: '/h/memory', label: t('sidebar.memory') || '记忆', icon: 'memory' },
        { route: '/h/cron', label: t('sidebar.cron') || '定时任务', icon: 'clock' },
      ]
    }, {
      section: '',
      items: [
        { route: '/assistant', label: t('sidebar.assistant') || 'Assistant', icon: 'assistant' },
        { route: '/settings', label: t('sidebar.settings') || '设置', icon: 'settings' },
        { route: '/about', label: t('sidebar.about') || '关于', icon: 'about' },
      ]
    }]
  },

  getRoutes() {
    const directRouteLoaders = {
      '/assistant': () => import('../../pages/assistant.js'),
      '/settings': () => import('../../pages/settings.js'),
      '/about': () => import('../../pages/about.js'),
      '/logs': () => import('../../pages/logs.js'),
      '/diagnose': () => import('../../pages/diagnose.js'),
      '/quick-setup': () => import('../../pages/quick-setup.js'),
    }

    return [
      { path: '/h/setup', loader: () => import('./pages/setup.js') },
      { path: '/h/dashboard', loader: () => import('./pages/dashboard.js') },
      { path: '/h/chat', loader: () => import('./pages/chat.js') },
      { path: '/h/logs', loader: () => import('./pages/logs.js') },
      { path: '/h/memory', loader: () => import('./pages/memory.js') },
      { path: '/h/services', loader: () => import('./pages/services.js') },
      { path: '/h/config', loader: () => import('./pages/config.js') },
      { path: '/h/channels', loader: () => import('./pages/channels.js') },
      { path: '/h/cron', loader: () => import('./pages/cron.js') },
      { path: '/h/skills', loader: () => import('./pages/skills.js') },
      // Hermes 模式下可直开的公共页面
      ...HERMES_DIRECT_ROUTES.map(path => ({ path, loader: directRouteLoaders[path] })),
    ]
  },

  getSetupRoute() { return '/h/setup' },
  getDefaultRoute() { return '/h/dashboard' },

  isReady() { return _ready },
  isGatewayRunning() { return _running },
  isGatewayForeign() { return false },

  onStateChange(fn) {
    _listeners.push(fn)
    return () => { _listeners = _listeners.filter(cb => cb !== fn) }
  },

  onReadyChange(fn) {
    _listeners.push(fn)
    return () => { _listeners = _listeners.filter(cb => cb !== fn) }
  },

  isFeatureAvailable() { return true },
}

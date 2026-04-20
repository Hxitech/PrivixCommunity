/**
 * 全局概览 — 9 主线 Apple 风格入口卡片
 * Phase C(v1.5.0):
 *   - 与侧边栏 9 主线一一对应(含 OpenClaw + Hermes 独立入口)
 *   - 56px SF Pro Display hero + 21px 副标题
 *   - 奇数卡浅底 / 偶数卡深底(cinematic 交替)
 *   - Apple 卡片:8px radius、无边框、.btn-pill-filled CTA
 */
import { navigate } from '../router.js'
import { api } from '../lib/tauri-api.js'
import { isOpenclawReady } from '../lib/app-state.js'
import { isRouteAllowed, getProductProfile } from '../lib/product-profile.js'
import { t } from '../lib/i18n.js'
import { switchEngine, getActiveEngineId, getActiveEngine } from '../lib/engine-manager.js'

// 卡片图标(与侧边栏 ICONS 风格一致,但页面内联以便独立)
const CARD_ICONS = {
  invest: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>',
  knowledge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/><path d="M8 7h8M8 11h6"/></svg>',
  sop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
  hermes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
  openclaw: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  evo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3h6"/><path d="M12 3v4"/><path d="M10 8h4a6 6 0 0 1 6 6v3a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-3a6 6 0 0 1 6-6Z"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/><path d="M9 19h6"/></svg>',
  swarm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="6" r="3"/><circle cx="5" cy="17" r="3"/><circle cx="19" cy="17" r="3"/><path d="M12 9v2.5M8.5 14.5l-2 1.5M15.5 14.5l2 1.5"/></svg>',
  assistant: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  'ai-office': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/><circle cx="16" cy="15" r="2"/></svg>',
  'quick-setup': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 4V2M15 16v-2M8 9H6M22 9h-2M17.8 11.8L19 13M15 9h0M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/></svg>',
  system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
}

function escapeHtml(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 社区版:5 卡片入口 */
function getOverviewCards() {
  const quickSetupRoute = isRouteAllowed('/quick-setup') ? '/quick-setup' : '/setup'
  return [
    {
      key: 'hermes',
      icon: CARD_ICONS.hermes,
      label: t('pages.overview.card_hermes_label') || 'Hermes',
      desc: t('pages.overview.card_hermes_desc') || '轻量 Agent 引擎 — 一键启动、开箱即用',
      engineSwitch: 'hermes',
    },
    {
      key: 'openclaw',
      icon: CARD_ICONS.openclaw,
      label: t('pages.overview.card_openclaw_label') || 'OpenClaw',
      desc: t('pages.overview.card_openclaw_desc') || '仪表盘、实时聊天、模型配置、Agent 管理',
      route: '/dashboard',
      statKey: 'openclaw',
    },
    {
      key: 'claw-assistant',
      icon: CARD_ICONS.assistant,
      label: t('pages.overview.zone_ops_label') || '钳子医生',
      desc: t('pages.overview.zone_ops_desc') || 'AI 驱动的操作协同助手',
      route: '/assistant',
    },
    {
      key: 'quick-setup',
      icon: CARD_ICONS['quick-setup'],
      label: t('pages.overview.card_quick_setup_label') || '一键配置',
      desc: t('pages.overview.card_quick_setup_desc') || 'OpenClaw + AI 服务商 一步启用',
      route: quickSetupRoute,
    },
    {
      key: 'system',
      icon: CARD_ICONS.system,
      label: t('pages.overview.zone_system_label') || '系统设置',
      desc: t('pages.overview.zone_system_desc') || '服务管理、安全、定时任务等基础配置',
      route: '/services',
      statKey: 'system',
    },
  ]
}

/** 异步加载 Stats(仅 OpenClaw + 系统卡) */
async function loadStats() {
  const stats = {}
  try {
    if (!isOpenclawReady()) return stats
    const [servicesRes, agentsRes] = await Promise.allSettled([
      api.getServicesStatus(),
      api.listAgents(),
    ])
    if (servicesRes.status === 'fulfilled') {
      const services = servicesRes.value || []
      const running = services.filter(s => s.running).length
      stats.system = `${running}/${services.length} 服务运行中`
    }
    if (agentsRes.status === 'fulfilled') {
      const agents = agentsRes.value || []
      stats.openclaw = `${agents.length} 个 Agent`
    }
  } catch (e) { console.warn('[overview] loadStats:', e) }
  return stats
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page overview-v2-page'

  const profile = getProductProfile()
  const cards = getOverviewCards()
  const statsPromise = loadStats()

  const heroTitle = t('pages.overview.hero_title') || 'AI Agent 工作台'
  const heroSubtitle = t('pages.overview.hero_subtitle') || '本地存储 · 直连模型 Provider'
  const ctaEnter = t('pages.overview.cta_enter') || '进入'

  page.innerHTML = `
    <section class="overview-v2-hero">
      <h1 class="overview-v2-hero-title">${escapeHtml(heroTitle)}</h1>
      <p class="overview-v2-hero-subtitle">${escapeHtml(heroSubtitle)}</p>
      <div class="overview-v2-hero-meta">${escapeHtml(profile.productName)}</div>
    </section>

    <section class="overview-v2-grid">
      ${cards.map((c, i) => {
        // 奇数 index(0-based: 1/3/5/7/9 视觉序号)用深底,其余浅底
        // 即:index 1,3,5,7 深底(Hermes、ProspectResearch、Assistant、Quick Setup)
        const isDark = i % 2 === 1
        const variantAttr = isDark ? ' data-variant="dark"' : ''
        const extraAttrs = c.engineSwitch
          ? ` data-engine-switch="${escapeHtml(c.engineSwitch)}"`
          : ` data-nav="${escapeHtml(c.route || '')}"`
        const statSlot = c.statKey
          ? `<div class="overview-v2-card-stat" data-stat-key="${escapeHtml(c.statKey)}"></div>`
          : ''
        return `
          <button type="button" class="overview-v2-card"${variantAttr}${extraAttrs}>
            <div class="overview-v2-card-icon">${c.icon}</div>
            <div class="overview-v2-card-title">${escapeHtml(c.label)}</div>
            <div class="overview-v2-card-desc">${escapeHtml(c.desc)}</div>
            ${statSlot}
            <div class="overview-v2-card-cta">
              <span class="apple-link">${escapeHtml(ctaEnter)}</span>
            </div>
          </button>
        `
      }).join('')}
    </section>
  `

  // 点击处理 — 引擎切换走 switchEngine(),路由跳转走 navigate()
  _clickHandler = (e) => {
    const card = e.target.closest('.overview-v2-card')
    if (!card) return
    const engine = card.dataset.engineSwitch
    if (engine) {
      if (getActiveEngineId() === engine) return
      switchEngine(engine).then(() => {
        const active = getActiveEngine()
        const route = active?.isReady() ? active.getDefaultRoute() : (active?.getSetupRoute() || '/h/setup')
        navigate(route)
      })
      return
    }
    const route = card.dataset.nav
    if (route) navigate(route)
  }
  page.addEventListener('click', _clickHandler)
  _root = page

  // 异步填充 stats(不阻塞首屏)
  statsPromise.then(stats => {
    if (!page.isConnected) return
    Object.keys(stats).forEach(key => {
      const el = page.querySelector(`[data-stat-key="${key}"]`)
      if (el && stats[key]) el.textContent = stats[key]
    })
  })

  return page
}

let _root = null
let _clickHandler = null

export function cleanup() {
  if (_root && _clickHandler) _root.removeEventListener('click', _clickHandler)
  _root = null
  _clickHandler = null
}

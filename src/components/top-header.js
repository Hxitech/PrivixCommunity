/**
 * 顶部 Header 栏 — 面包屑 + 全局操作
 */
import { getCurrentRouteState } from '../router.js'
import { BRAND_NAME, BRAND_SUBTITLE } from '../lib/brand.js'
import { t } from '../lib/i18n.js'
// v1.2.2: 统一 profile，不再按旧版 profile 切换面包屑

// 路由 → 面包屑映射（函数形式，确保 t() 在运行时调用）
function getBreadcrumbs() {
  const breadcrumbs = {
    '/dashboard': { section: t('comp.header.section_overview'), page: t('comp.header.page_dashboard') },
    '/assistant': { section: t('comp.header.section_ops'), page: t('comp.header.page_assistant') },
    '/chat': { section: t('comp.header.section_overview'), page: t('comp.header.page_chat') },
    '/models': { section: t('comp.header.section_overview'), page: t('comp.header.page_models') },
    '/agents': { section: t('comp.header.section_overview'), page: t('comp.header.page_agents') },
    '/memory': { section: t('comp.header.section_overview'), page: t('comp.header.page_memory') },
    '/channels': { section: t('comp.header.section_overview'), page: t('comp.header.page_channels') },
    '/mcp': { section: t('comp.header.section_overview'), page: t('comp.header.page_mcp') },
    '/services': { section: t('comp.header.section_system'), page: t('comp.header.page_services') },
    '/logs': { section: t('comp.header.section_system'), page: t('comp.header.page_logs') },
    '/gateway': { section: t('comp.header.section_system'), page: t('comp.header.page_gateway') },
    '/communication': { section: t('comp.header.section_system'), page: t('comp.header.page_communication') },
    '/security': { section: t('comp.header.section_system'), page: t('comp.header.page_security') },
    '/pipeline': { section: t('comp.header.section_invest'), page: t('comp.header.page_pipeline') },
    '/pool': { section: t('comp.header.section_invest'), page: t('comp.header.page_pool') },
    '/companies': { section: t('comp.header.section_invest'), page: t('comp.header.page_companies') },
    '/contacts': { section: t('comp.header.section_invest'), page: t('comp.header.page_contacts') },
    '/invest-docs': { section: t('comp.header.section_invest'), page: t('comp.header.page_invest_docs') },
    '/sop': { section: t('comp.header.section_invest'), page: t('comp.header.page_sop') },
    '/invest-dashboard': { section: t('comp.header.section_invest'), page: t('comp.header.page_invest_dashboard') },
    '/scoring': { section: t('comp.header.section_invest'), page: t('comp.header.page_scoring') },
    '/workflows': { section: t('comp.header.section_invest'), page: t('comp.header.page_workflows') },
    '/audit': { section: t('comp.header.section_invest'), page: t('comp.header.page_audit') },
    '/automation': { section: t('comp.header.section_invest'), page: t('comp.header.page_automation') },
    '/invest-repair': { section: t('comp.header.section_invest'), page: t('comp.header.page_invest_repair') },
    '/cron': { section: t('comp.header.section_system'), page: t('comp.header.page_cron') },
    '/usage': { section: t('comp.header.section_system'), page: t('comp.header.page_usage') },
    '/evoscientist': { section: 'Prospect-Research', page: 'Prospect-Research' },
    '/skills': { section: t('comp.header.section_system'), page: t('comp.header.page_skills') },
    '/settings': { section: t('comp.header.section_system'), page: t('comp.header.page_settings') },
    '/chat-debug': { section: t('comp.header.section_system'), page: t('comp.header.page_chat_debug') },
    '/about': { section: t('comp.header.section_system'), page: t('comp.header.page_about') },
    '/setup': { section: '', page: t('comp.header.page_setup') },
    '/h/setup': { section: 'Hermes', page: t('comp.header.page_setup') },
    '/h/dashboard': { section: 'Hermes', page: t('comp.header.page_dashboard') },
    '/h/chat': { section: 'Hermes', page: t('comp.header.page_chat') },
    '/h/logs': { section: 'Hermes', page: t('comp.header.page_logs') },
    '/h/memory': { section: 'Hermes', page: t('comp.header.page_memory') },
    '/h/services': { section: 'Hermes', page: t('comp.header.page_services') },
    '/h/config': { section: 'Hermes', page: t('comp.header.page_models') },
    '/h/channels': { section: 'Hermes', page: t('comp.header.page_channels') },
    '/h/cron': { section: 'Hermes', page: t('comp.header.page_cron') },
    '/h/skills': { section: 'Hermes', page: t('comp.header.page_skills') },
  }

  // 知识库和 SOP 面包屑始终注册（统一 profile）
  breadcrumbs['/knowledge'] = { section: t('comp.header.section_knowledge'), page: t('comp.header.page_knowledge') }
  breadcrumbs['/sop'] = breadcrumbs['/sop'] || { section: t('comp.header.section_sop'), page: t('comp.header.page_sop_config') }

  return breadcrumbs
}

function resolveEvoscientistBreadcrumb(query = {}) {
  const tab = String(query.tab || 'chat').trim()
  const page = {
    chat: t('comp.header.evo_tab_chat'),
    settings: t('comp.header.evo_tab_settings'),
  }[tab] || t('comp.header.evo_tab_chat')
  return { section: 'Prospect-Research', page }
}

export function renderTopHeader(el) {
  updateBreadcrumb(el)
}

export function updateBreadcrumb(el) {
  if (!el) return
  const routeState = getCurrentRouteState()
  const breadcrumbs = getBreadcrumbs()
  const crumb = routeState.path === '/evoscientist'
    ? resolveEvoscientistBreadcrumb(routeState.query)
    : (breadcrumbs[routeState.path] || { section: '', page: routeState.path.replace('/', '') })
  const chipLabel = crumb.section || BRAND_NAME
  const contextLabel = crumb.section
    ? `${BRAND_NAME} · ${crumb.section}`
    : BRAND_SUBTITLE

  el.innerHTML = `
    <div class="breadcrumb">
      <span class="breadcrumb-chip">${chipLabel}</span>
      <div class="breadcrumb-copy">
        <span class="breadcrumb-current">${crumb.page}</span>
        <span class="breadcrumb-context">${contextLabel}</span>
      </div>
    </div>
    <div class="header-actions">
      <div class="header-status-pill">
        <span class="header-status-dot"></span>
        <span>${t('comp.header.status_ready')}</span>
      </div>
    </div>
  `
}

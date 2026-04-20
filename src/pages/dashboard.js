/**
 * 仪表盘页面
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { onGatewayChange } from '../lib/app-state.js'
import { navigate, withTimeout } from '../router.js'
import { t } from '../lib/i18n.js'
import { wsClient } from '../lib/ws-client.js'
import { getActiveEngineId } from '../lib/engine-manager.js'
import { icon } from '../lib/icons.js'

let _unsubGw = null
let _loadInFlight = false
let _lastGwChangeLoad = 0

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('pages.dashboard.title')}</h1>
      <p class="page-desc">${t('pages.dashboard.status_overview')}</p>
    </div>
    <div class="stat-cards" id="stat-cards">
      <div class="stat-card loading-placeholder"></div>
      <div class="stat-card loading-placeholder"></div>
      <div class="stat-card loading-placeholder"></div>
      <div class="stat-card loading-placeholder"></div>
      <div class="stat-card loading-placeholder"></div>
      <div class="stat-card loading-placeholder"></div>
    </div>
    <div id="dashboard-overview-container">
      <div class="dashboard-skeleton">
        <div class="skeleton-row"><div class="skeleton-block" style="width:100%;height:120px"></div><div class="skeleton-block" style="width:100%;height:120px"></div></div>
        <div class="skeleton-row"><div class="skeleton-block" style="width:100%;height:120px"></div><div class="skeleton-block" style="width:100%;height:120px"></div></div>
      </div>
    </div>
    <div class="quick-actions">
      <button class="btn btn-secondary" id="btn-restart-gw">${t('pages.dashboard.restart_gw')}</button>
      <button class="btn btn-secondary" id="btn-check-update">${t('pages.dashboard.check_update')}</button>
      <button class="btn btn-secondary" id="btn-create-backup">${t('pages.dashboard.create_backup')}</button>
    </div>
    <div class="config-section">
      <div class="config-section-title">${t('pages.dashboard.recent_logs')}</div>
      <div class="log-viewer" id="recent-logs" style="max-height:300px"></div>
    </div>
  `

  // 绑定事件（只绑一次）
  bindActions(page)

  // 异步加载数据
  loadDashboardData(page)

  // 监听 Gateway 状态变化，节流刷新仪表盘（至少间隔 5 秒，防止状态抖动导致 UI 闪烁）
  if (_unsubGw) _unsubGw()
  _unsubGw = onGatewayChange(() => {
    const now = Date.now()
    if (now - _lastGwChangeLoad < 5000) return
    _lastGwChangeLoad = now
    loadDashboardData(page)
  })

  return page
}

export function cleanup() {
  if (_unsubGw) { _unsubGw(); _unsubGw = null }
}

async function loadDashboardData(page) {
  // 并发保护：如果上一次加载仍在进行，跳过本次
  if (_loadInFlight) return
  _loadInFlight = true
  try { await _loadDashboardDataInner(page) } finally { _loadInFlight = false }
}

async function _loadDashboardDataInner(page) {
  // 分波加载：关键数据先渲染，次要数据后填充，减少白屏等待
  // 每个请求独立 withTimeout 包裹,任意慢请求不再拖垮仪表盘
  const coreP = Promise.allSettled([
    withTimeout(api.getServicesStatus(), 12000),
    withTimeout(api.getVersionInfo(), 8000),
    withTimeout(api.readOpenclawConfig(), 5000),
  ])
  const secondaryP = Promise.allSettled([
    withTimeout(api.listAgents(), 10000),
    withTimeout(api.readMcpConfig(), 10000),
    withTimeout(api.listBackups(), 10000),
    withTimeout(api.getStatusSummary(), 10000),
    withTimeout(api.listConfiguredPlatforms(), 10000).catch(() => []),
  ])
  const logsP = api.readLogTail('gateway', 20).catch(() => '')

  // 第一波：服务状态 + 版本 + 配置 → 立即渲染统计卡片
  const [servicesRes, versionRes, configRes] = await coreP
  const services = servicesRes.status === 'fulfilled' ? servicesRes.value : []
  const version = versionRes.status === 'fulfilled' ? (versionRes.value || {}) : {}
  const config = configRes.status === 'fulfilled' ? configRes.value : null
  if (servicesRes.status === 'rejected') toast(t('pages.dashboard.toast_services_failed'), 'error')
  if (versionRes.status === 'rejected') toast(t('pages.dashboard.toast_version_failed'), 'error')

  // 自愈：补全关键默认值
  if (config && typeof config === 'object') {
    let patched = false
    if (!config.gateway || typeof config.gateway !== 'object') { config.gateway = {}; patched = true }
    if (!config.gateway.mode) { config.gateway.mode = 'local'; patched = true }
    // 修复旧版错误：mode 不应在顶层（OpenClaw 不认识）
    if (config.mode) { delete config.mode; patched = true }
    if (!config.tools || typeof config.tools !== 'object' || config.tools.profile !== 'full') {
      config.tools = { profile: 'full', sessions: { visibility: 'all' }, ...(config.tools || {}) }
      config.tools.profile = 'full'
      if (!config.tools.sessions || typeof config.tools.sessions !== 'object') config.tools.sessions = {}
      config.tools.sessions.visibility = 'all'
      patched = true
    }
    if (patched) api.writeOpenclawConfig(config).catch(e => console.warn('[dashboard] writeOpenclawConfig:', e))
  }

  renderStatCards(page, services, version, [], config)

  // 第二波：Agent、MCP、备份 → 更新卡片 + 渲染总览
  const [agentsRes, mcpRes, backupsRes, statusRes, channelsRes] = await secondaryP
  const agents = agentsRes.status === 'fulfilled' ? agentsRes.value : []
  const mcpConfig = mcpRes.status === 'fulfilled' ? mcpRes.value : null
  const backups = backupsRes.status === 'fulfilled' ? backupsRes.value : []
  const statusSummary = statusRes.status === 'fulfilled' ? statusRes.value : null
  const channels = channelsRes.status === 'fulfilled' ? (channelsRes.value || []) : []

  renderStatCards(page, services, version, agents, config)
  renderOverview(page, services, mcpConfig, backups, config, agents, statusSummary, channels)

  // 第三波：日志（最低优先级）
  const logs = await logsP
  renderLogs(page, logs)
}

function renderStatCards(page, services, version, agents, config) {
  const cardsEl = page.querySelector('#stat-cards')
  const gw = services.find(s => s.label === 'ai.openclaw.gateway')
  const runningCount = services.filter(s => s.running).length
  const versionMeta = version?.recommended
    ? `${version.ahead_of_recommended ? t('pages.dashboard.version_ahead', { version: version.recommended }) : version.is_recommended ? t('pages.dashboard.version_stable') + ' ' + version.recommended : t('pages.dashboard.version_recommended') + ' ' + version.recommended}${version.latest_update_available && version.latest ? ' · ' + t('pages.dashboard.version_latest_upstream') + ' ' + version.latest : ''}`
    : (version?.latest_update_available && version?.latest ? t('pages.dashboard.version_latest_upstream') + ': ' + version.latest : t('pages.dashboard.version_unknown'))

  const defaultAgent = agents.find(a => a.id === 'main')?.name || 'main'
  const modelCount = (config?.models?.providers && typeof config.models.providers === 'object') ? Object.values(config.models.providers).reduce((acc, p) => acc + ((p?.models?.length) || 0), 0) : 0
  const providerCount = (config?.models?.providers && typeof config.models.providers === 'object') ? Object.keys(config.models.providers).length : 0

  cardsEl.innerHTML = `
    <div class="stat-card">
      <div class="stat-card-header">
        <span class="stat-card-label">Gateway</span>
        <span class="status-dot ${gw?.running ? 'running' : 'stopped'}"></span>
      </div>
      <div class="stat-card-value">${gw?.running ? t('pages.dashboard.running') : t('pages.dashboard.stopped')}</div>
      <div class="stat-card-meta">${gw?.pid ? 'PID: ' + gw.pid : (gw?.running ? t('pages.dashboard.port_detect') : t('pages.dashboard.not_started'))}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-header">
        <span class="stat-card-label">${t('pages.dashboard.version_label')} · ${version?.source === 'official' ? t('pages.dashboard.source_official') : version?.source === 'chinese' ? t('pages.dashboard.source_chinese') : t('pages.dashboard.version_unknown')}</span>
      </div>
      <div class="stat-card-value">${version?.current || t('pages.dashboard.version_unknown')}</div>
      <div class="stat-card-meta">${versionMeta}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-header">
        <span class="stat-card-label">${t('pages.dashboard.agent_fleet')}</span>
      </div>
      <div class="stat-card-value">${t('pages.dashboard.count_unit', { count: agents.length })}</div>
      <div class="stat-card-meta">${t('pages.dashboard.default_agent', { name: defaultAgent })}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-header">
        <span class="stat-card-label">${t('pages.dashboard.model_pool')}</span>
      </div>
      <div class="stat-card-value">${t('pages.dashboard.count_unit', { count: modelCount })}</div>
      <div class="stat-card-meta">${t('pages.dashboard.provider_count', { count: providerCount })}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-header">
        <span class="stat-card-label">${t('pages.dashboard.base_services')}</span>
      </div>
      <div class="stat-card-value">${runningCount}/${services.length}</div>
      <div class="stat-card-meta">${t('pages.dashboard.alive_rate', { rate: services.length ? Math.round(runningCount / services.length * 100) : 0 })}</div>
    </div>
    <div class="stat-card stat-card-clickable" id="card-control-ui" title="${t('pages.dashboard.open_control_ui')}">
      <div class="stat-card-header">
        <span class="stat-card-label">Control UI</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="opacity:0.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </div>
      <div class="stat-card-value" style="font-size:var(--font-size-sm)">${t('pages.dashboard.native_panel')}</div>
      <div class="stat-card-meta">${gw?.running ? t('pages.dashboard.click_open_browser') : t('pages.dashboard.gw_not_running')}</div>
    </div>
    <div class="stat-card stat-card-clickable" data-nav="/clawswarm">
      <div class="stat-card-header">
        <span class="stat-card-label">ClawSwarm</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="opacity:0.5"><circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><circle cx="12" cy="16" r="3"/><line x1="9.5" y1="8.5" x2="14.5" y2="8.5"/></svg>
      </div>
      <div class="stat-card-value" style="font-size:var(--font-size-sm)">${t('pages.dashboard.swarm_collab')}</div>
      <div class="stat-card-meta">${t('pages.dashboard.swarm_desc')}</div>
    </div>
    <div class="stat-card stat-card-clickable" data-action="open-ai-config">
      <div class="stat-card-header">
        <span class="stat-card-label">${t('pages.dashboard.ai_config')}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="opacity:0.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
      </div>
      <div class="stat-card-value" style="font-size:var(--font-size-sm)">${t('pages.dashboard.quick_config_model')}</div>
      <div class="stat-card-meta">${t('pages.dashboard.ai_config_desc')}</div>
    </div>
  `
}

function renderOverview(page, services, mcpConfig, backups, config, agents, statusSummary, channels) {
  const containerEl = page.querySelector('#dashboard-overview-container')
  const isHermes = getActiveEngineId() === 'hermes'
  const gw = isHermes ? null : services.find(s => s.label === 'ai.openclaw.gateway')
  const mcpCount = (mcpConfig?.mcpServers && typeof mcpConfig.mcpServers === 'object') ? Object.keys(mcpConfig.mcpServers).length : 0

  const formatDate = (timestamp) => {
    if (!timestamp) return '——'
    const d = new Date(timestamp * 1000)
    const mon = d.getMonth() + 1
    const day = d.getDate()
    const hr = d.getHours().toString().padStart(2, '0')
    const min = d.getMinutes().toString().padStart(2, '0')
    return mon + '-' + day + ' ' + hr + ':' + min
  }

  const latestBackup = backups.length > 0 ? backups.sort((a,b) => b.created_at - a.created_at)[0] : null
  const lastUpdate = config?.meta?.lastTouchedVersion || t('pages.dashboard.version_unknown')
  const runtimeVer = statusSummary?.runtimeVersion || null
  const sessions = statusSummary?.sessions || null

  const gwPort = config?.gateway?.port || 18789
  const primaryModel = config?.agents?.defaults?.model?.primary || t('pages.dashboard.not_set')

  containerEl.innerHTML = `
    <div class="dashboard-overview">
      <div class="overview-grid">
        <div class="overview-card" data-nav="/gateway">
          <div class="overview-card-icon" style="color:${gw?.running ? 'var(--success)' : 'var(--error)'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          </div>
          <div class="overview-card-body">
            <div class="overview-card-title">Gateway</div>
            <div class="overview-card-value" style="color:${gw?.running ? 'var(--success)' : 'var(--error)'}">${gw?.running ? t('pages.dashboard.running') : t('pages.dashboard.stopped')}</div>
            <div class="overview-card-meta">${t('pages.dashboard.port')} ${gwPort} ${gw?.pid ? '· PID ' + gw.pid : ''}</div>
          </div>
          <div class="overview-card-actions">
            ${gw?.running
              ? `<button class="btn btn-danger btn-xs" data-action="stop-gw">${t('pages.dashboard.stop')}</button><button class="btn btn-secondary btn-xs" data-action="restart-gw">${t('pages.dashboard.restart')}</button>`
              : `<button class="btn btn-primary btn-xs" data-action="start-gw">${t('pages.dashboard.start')}</button>`
            }
          </div>
        </div>

        <div class="overview-card" data-nav="/models">
          <div class="overview-card-icon" style="color:var(--accent)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>
          </div>
          <div class="overview-card-body">
            <div class="overview-card-title">${t('pages.dashboard.primary_model')}</div>
            <div class="overview-card-value" style="font-size:var(--font-size-sm)">${primaryModel}</div>
            <div class="overview-card-meta">${t('pages.dashboard.concurrency_limit', { count: config?.agents?.defaults?.maxConcurrent || 4 })}</div>
          </div>
        </div>

        <div class="overview-card" data-nav="/skills">
          <div class="overview-card-icon" style="color:var(--warning)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
          </div>
          <div class="overview-card-body">
            <div class="overview-card-title">${t('pages.dashboard.mcp_tools')}</div>
            <div class="overview-card-value">${t('pages.dashboard.count_unit', { count: mcpCount })}</div>
            <div class="overview-card-meta">${t('pages.dashboard.mounted_extensions')}</div>
          </div>
        </div>

        <div class="overview-card" data-nav="/services">
          <div class="overview-card-icon" style="color:var(--text-tertiary)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </div>
          <div class="overview-card-body">
            <div class="overview-card-title">${t('pages.dashboard.recent_backup')}</div>
            <div class="overview-card-value" style="font-size:var(--font-size-sm)">${latestBackup ? formatDate(latestBackup.created_at) : t('pages.dashboard.no_backup')}</div>
            <div class="overview-card-meta">${t('pages.dashboard.backup_count', { count: backups.length })}</div>
          </div>
        </div>

        <div class="overview-card" data-nav="/agents">
          <div class="overview-card-icon" style="color:var(--success)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
          </div>
          <div class="overview-card-body">
            <div class="overview-card-title">${t('pages.dashboard.agent_fleet')}</div>
            <div class="overview-card-value">${t('pages.dashboard.count_unit', { count: agents.length })}</div>
            <div class="overview-card-meta">${t('pages.dashboard.workspace_count', { count: agents.filter(a => a.workspace).length })}</div>
          </div>
        </div>

        <div class="overview-card">
          <div class="overview-card-icon" style="color:var(--text-tertiary)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </div>
          <div class="overview-card-body">
            <div class="overview-card-title">${t('pages.dashboard.runtime_version')}</div>
            <div class="overview-card-value" style="font-size:var(--font-size-sm)">${runtimeVer || lastUpdate}</div>
            <div class="overview-card-meta">${runtimeVer ? 'OpenClaw Runtime' : 'openclaw.json'}</div>
          </div>
        </div>

        <div class="overview-card" data-nav="/evoscientist">
          <div class="overview-card-icon" style="color:#8b5cf6">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
          </div>
          <div class="overview-card-body">
            <div class="overview-card-title">Prospect-Research</div>
            <div class="overview-card-value" style="font-size:var(--font-size-sm)">${t('pages.dashboard.multi_agent_collab')}</div>
            <div class="overview-card-meta">${t('pages.dashboard.prospect_research_meta')}</div>
          </div>
        </div>

        <div class="overview-card" data-nav="/clawswarm">
          <div class="overview-card-icon" style="color:#f59e0b">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><circle cx="12" cy="16" r="3"/><line x1="9.5" y1="8.5" x2="14.5" y2="8.5"/><line x1="8.5" y1="9.5" x2="10.5" y2="14"/><line x1="15.5" y1="9.5" x2="13.5" y2="14"/></svg>
          </div>
          <div class="overview-card-body">
            <div class="overview-card-title">ClawSwarm</div>
            <div class="overview-card-value" style="font-size:var(--font-size-sm)">${t('pages.dashboard.swarm_collab')}</div>
            <div class="overview-card-meta">${t('pages.dashboard.swarm_full_desc')}</div>
          </div>
        </div>

        <div class="overview-card" data-action="open-ai-config">
          <div class="overview-card-icon" style="color:#f59e0b">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
          </div>
          <div class="overview-card-body">
            <div class="overview-card-title">${t('pages.dashboard.ai_config')}</div>
            <div class="overview-card-value" style="font-size:var(--font-size-sm)">${t('pages.dashboard.quick_config_model')}</div>
            <div class="overview-card-meta">${t('pages.dashboard.ai_config_full_desc')}</div>
          </div>
        </div>
      </div>

      <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-md);padding:14px 16px;margin-top:var(--space-md);font-size:12px;line-height:1.7;color:var(--text-secondary)">
        <div style="font-weight:600;color:var(--text-primary);margin-bottom:6px;font-size:13px">${t('pages.dashboard.card_openclaw')}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <div style="font-weight:600;color:var(--text-primary);margin-bottom:2px">${t('pages.dashboard.openclaw_infra')}</div>
            ${t('pages.dashboard.openclaw_infra_desc')}
          </div>
          <div>
            <div style="font-weight:600;color:var(--text-primary);margin-bottom:2px">${t('pages.dashboard.prospect_research_collab')}</div>
            ${t('pages.dashboard.prospect_research_collab_desc')}
          </div>
        </div>
      </div>

      ${renderWsStatus()}
      ${renderChannelsOverview(channels)}
      ${renderSessionStatus(sessions)}
    </div>
  `

  // 概览卡片点击导航
  containerEl.querySelectorAll('[data-nav]').forEach(card => {
    card.style.cursor = 'pointer'
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return
      navigate(card.dataset.nav)
    })
  })
}

function renderSessionStatus(sessions) {
  if (!sessions || !sessions.recent || sessions.recent.length === 0) return ''
  const rows = sessions.recent.slice(0, 5).map(s => {
    const pct = s.percentUsed ?? 0
    const barColor = pct > 80 ? 'var(--error)' : pct > 50 ? 'var(--warning)' : 'var(--success)'
    const flags = (s.flags || []).map(f => `<span class="session-flag">${escapeHtml(f)}</span>`).join('')
    const model = s.model ? `<span class="session-model">${escapeHtml(s.model)}</span>` : ''
    const tokens = s.totalTokens != null && s.totalTokens > 0 ? `${Math.round(s.totalTokens / 1000)}k` : '0'
    const ctx = s.contextTokens != null ? `${Math.round(s.contextTokens / 1000)}k` : '—'
    const remaining = s.remainingTokens != null ? `${Math.round(s.remainingTokens / 1000)}k` : ctx
    const key = escapeHtml(s.key || '').replace(/^agent:main:/, '')
    return `<div class="session-row">
      <div class="session-row-header">
        <span class="session-key" title="${escapeHtml(s.key || '')}">${key || '—'}</span>
        ${model}${flags}
      </div>
      <div class="session-bar-wrap">
        <div class="session-bar" style="width:${Math.min(pct, 100)}%;background:${barColor}"></div>
      </div>
      <div class="session-row-meta">${tokens} / ${ctx} · ${t('pages.dashboard.remaining')} ${remaining} · ${pct}%</div>
    </div>`
  })
  const defaultModel = sessions.defaults?.model || '—'
  const defaultCtx = sessions.defaults?.contextTokens ? `${Math.round(sessions.defaults.contextTokens / 1000)}k` : '—'
  return `
    <div class="config-section" style="margin-top:16px">
      <div class="config-section-title">${t('pages.dashboard.active_sessions')} <span style="font-weight:normal;color:var(--text-tertiary);font-size:var(--font-size-xs)">${sessions.count || 0} ${t('pages.dashboard.count_unit', { count: '' }).trim()} · ${t('pages.dashboard.default_model')} ${escapeHtml(defaultModel)} · ${t('pages.dashboard.context')} ${defaultCtx}</span></div>
      <div class="session-list">${rows.join('')}</div>
    </div>`
}

// WebSocket 连接状态指示器（绿/黄/灰点 + 版本号）
function renderWsStatus() {
  const connected = wsClient.connected
  const ready = wsClient.gatewayReady
  const reconnecting = wsClient.reconnectState === 'attempting' || wsClient.reconnectState === 'scheduled'
  const attempts = wsClient.reconnectAttempts
  const serverVer = wsClient.serverVersion

  let statusColor, statusLabel, statusDetail
  if (ready) {
    statusColor = 'var(--success)'
    statusLabel = t('pages.dashboard.ws_connected') || 'Connected'
    statusDetail = serverVer ? `Gateway ${serverVer}` : ''
  } else if (connected) {
    statusColor = 'var(--warning)'
    statusLabel = t('pages.dashboard.ws_handshaking') || 'Handshaking'
    statusDetail = ''
  } else if (reconnecting) {
    statusColor = 'var(--warning)'
    statusLabel = t('pages.dashboard.ws_reconnecting') || 'Reconnecting'
    statusDetail = `#${attempts}`
  } else {
    statusColor = 'var(--text-tertiary)'
    statusLabel = t('pages.dashboard.ws_disconnected') || 'Disconnected'
    statusDetail = ''
  }

  return `
    <div class="config-section" style="margin-top:16px">
      <div class="config-section-title" style="display:flex;align-items:center;gap:8px">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColor}"></span>
        WebSocket ${statusLabel}
        ${statusDetail ? `<span style="font-weight:normal;color:var(--text-tertiary);font-size:var(--font-size-xs)">${escapeHtml(statusDetail)}</span>` : ''}
      </div>
    </div>`
}

// 已连接渠道平台图标映射 — 用 Apple 线条 SVG 替代 emoji(严肃化 v1.4.4)
const CHANNEL_ICONS = {
  qqbot:    'message-circle',
  qq:       'message-circle',
  feishu:   'message-square',
  dingtalk: 'bell',
  telegram: 'send',
  discord:  'message-square',
  slack:    'hash',
  weixin:   'message-circle',
  wechat:   'message-circle',
  webchat:  'globe',
  whatsapp: 'smartphone',
  line:     'message-circle',
  teams:    'users',
  matrix:   'link',
}

// 渲染已连接渠道概览
function renderChannelsOverview(channels) {
  if (!channels || channels.length === 0) return ''
  const items = channels.map(ch => {
    const iconId = CHANNEL_ICONS[ch.platform] || 'radio'
    const enabled = ch.enabled !== false
    const dot = enabled ? 'var(--success)' : 'var(--text-tertiary)'
    const name = ch.name || ch.platform || ch.id || ''
    return `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:20px;background:var(--bg-secondary);font-size:var(--font-size-xs);white-space:nowrap;color:var(--text-primary)">
      <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${dot}"></span>
      <span style="color:var(--accent-blue);display:inline-flex">${icon(iconId, 14)}</span>
      ${escapeHtml(name)}
    </span>`
  })
  return `
    <div class="config-section" style="margin-top:12px">
      <div class="config-section-title">${t('pages.dashboard.connected_channels') || 'Connected Channels'} <span style="font-weight:normal;color:var(--text-tertiary);font-size:var(--font-size-xs)">${channels.length}</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${items.join('')}</div>
    </div>`
}

// 解析日志行：提取时间、级别、消息
function parseLogLine(line) {
  // 常见日志格式: [2024-01-15 14:30:25] [INFO] message 或 2024-01-15T14:30:25 INFO message
  const m = line.match(/^[\[（]?(\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)\]?\s*[\[（]?\s*(DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|TRACE)\s*[\]）]?\s*(.*)$/i)
  if (m) return { time: m[1].replace('T', ' ').replace(/\.\d+$/, ''), level: m[2].toUpperCase().replace('WARNING', 'WARN'), msg: m[3] }
  // 简单 level 前缀: INFO: xxx / [ERROR] xxx
  const m2 = line.match(/^[\[（]?\s*(DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|TRACE)\s*[\]）:]\s*(.*)$/i)
  if (m2) return { time: '', level: m2[1].toUpperCase().replace('WARNING', 'WARN'), msg: m2[2] }
  return { time: '', level: '', msg: line }
}

// 日志级别颜色样式映射（ERROR: 红色, WARN: 黄色, INFO: 蓝色, DEBUG/TRACE: 灰色）
const LOG_LEVEL_STYLE = {
  ERROR: 'background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.2)',
  FATAL: 'background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.2)',
  WARN: 'background:rgba(234,179,8,0.12);color:#ca8a04;border:1px solid rgba(234,179,8,0.2)',
  INFO: 'background:rgba(90,114,238,0.10);color:#5A72EE;border:1px solid rgba(90,114,238,0.15)',
  DEBUG: 'background:rgba(148,163,184,0.10);color:#94a3b8;border:1px solid rgba(148,163,184,0.15)',
  TRACE: 'background:rgba(148,163,184,0.08);color:#94a3b8;border:1px solid rgba(148,163,184,0.1)',
}

function renderLogs(page, logs) {
  const logsEl = page.querySelector('#recent-logs')
  if (!logs) {
    logsEl.innerHTML = `<div style="color:var(--text-tertiary);padding:12px">${t('pages.dashboard.no_logs')}</div>`
    return
  }
  const lines = logs.trim().split('\n')
  logsEl.innerHTML = lines.map(l => {
    const parsed = parseLogLine(l)
    if (!parsed.level) return `<div class="log-line">${escapeHtml(l)}</div>`
    const badge = `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;letter-spacing:0.5px;${LOG_LEVEL_STYLE[parsed.level] || ''}">${parsed.level}</span>`
    const time = parsed.time ? `<span style="color:var(--text-tertiary);font-size:11px;opacity:0.7;margin-right:4px">${escapeHtml(parsed.time)}</span>` : ''
    return `<div class="log-line" style="display:flex;align-items:center;gap:6px">${time}${badge}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${escapeHtml(parsed.msg)}</span></div>`
  }).join('')
  logsEl.scrollTop = logsEl.scrollHeight
}

function bindActions(page) {
  const btnRestart = page.querySelector('#btn-restart-gw')
  const btnUpdate = page.querySelector('#btn-check-update')
  const btnCreateBackup = page.querySelector('#btn-create-backup')

  // 统计卡片区域的 data-nav 点击导航（事件委托，因为卡片是动态渲染的）
  page.addEventListener('click', (e) => {
    const navCard = e.target.closest('.stat-card[data-nav]')
    if (!navCard) return
    if (e.target.closest('button')) return
    navigate(navCard.dataset.nav)
  })

  // Control UI 卡片点击 → 打开 OpenClaw 原生面板（用事件委托，因为卡片是动态渲染的）
  page.addEventListener('click', async (e) => {
    const card = e.target.closest('#card-control-ui')
    if (!card) return
    if (e.target.closest('button')) return
    try {
      const config = await api.readOpenclawConfig()
      const port = config?.gateway?.port || 18789
      // 远程部署时使用当前浏览器域名/IP，桌面版用 127.0.0.1
      const host = window.__TAURI_INTERNALS__ ? '127.0.0.1' : (location.hostname || '127.0.0.1')
      const proto = location.protocol === 'https:' ? 'https' : 'http'
      let url = `${proto}://${host}:${port}`
      // 如果 Gateway 配置了 token 鉴权，附加到 URL 方便直接访问
      const authToken = config?.gateway?.auth?.token
      if (authToken) url += `?token=${encodeURIComponent(authToken)}`
      // 尝试多种方式打开浏览器
      if (window.__TAURI_INTERNALS__) {
        try {
          const { open } = await import('@tauri-apps/plugin-shell')
          await open(url)
        } catch {
          window.open(url, '_blank')
        }
      } else {
        window.open(url, '_blank')
      }
    } catch (e2) {
      toast(t('pages.dashboard.toast_open_control_failed', { error: String(e2.message || e2) }), 'error')
    }
  })

  // 一键 AI 配置卡片 → 跳转到投资首页触发向导
  page.addEventListener('click', (e) => {
    const aiConfigCard = e.target.closest('[data-action="open-ai-config"]')
    if (aiConfigCard) {
      navigate('/invest-dashboard')
      // 延迟触发向导（等页面渲染完成）
      setTimeout(() => {
        if (!page.isConnected) return
        const wizardBtn = document.querySelector('[data-action="open-ai-config-wizard"]')
        if (wizardBtn) wizardBtn.click()
      }, 500)
    }
  })

  // 概览区域的 Gateway 启动/停止/重启 + ClawApp 导航
  page.addEventListener('click', async (e) => {
    const actionBtn = e.target.closest('[data-action]')
    if (!actionBtn) return
    const action = actionBtn.dataset.action
    if (action === 'open-ai-config') return  // 已在上面处理

    if (action === 'start-gw') {
      actionBtn.disabled = true; actionBtn.textContent = t('pages.dashboard.starting')
      try {
        await api.startService('ai.openclaw.gateway')
        toast(t('pages.dashboard.toast_gw_start_sent'), 'success')
        setTimeout(() => { if (page.isConnected) loadDashboardData(page) }, 2000)
      } catch (err) { toast(t('pages.dashboard.toast_start_failed', { error: String(err) }), 'error') }
      finally { actionBtn.disabled = false; actionBtn.textContent = t('pages.dashboard.start') }
    }
    if (action === 'stop-gw') {
      actionBtn.disabled = true; actionBtn.textContent = t('pages.dashboard.stopping')
      try {
        await api.stopService('ai.openclaw.gateway')
        toast(t('pages.dashboard.toast_gw_stopped'), 'success')
        setTimeout(() => { if (page.isConnected) loadDashboardData(page) }, 1500)
      } catch (err) { toast(t('pages.dashboard.toast_stop_failed', { error: String(err) }), 'error') }
      finally { actionBtn.disabled = false; actionBtn.textContent = t('pages.dashboard.stop') }
    }
    if (action === 'restart-gw') {
      actionBtn.disabled = true; actionBtn.textContent = t('pages.dashboard.restarting')
      try {
        await api.restartService('ai.openclaw.gateway')
        toast(t('pages.dashboard.toast_gw_restart_sent'), 'success')
        setTimeout(() => { if (page.isConnected) loadDashboardData(page) }, 3000)
      } catch (err) { toast(t('pages.dashboard.toast_restart_failed', { error: String(err) }), 'error') }
      finally { actionBtn.disabled = false; actionBtn.textContent = t('pages.dashboard.restart') }
    }
  })

  btnRestart?.addEventListener('click', async () => {
    btnRestart.disabled = true
    btnRestart.classList.add('btn-loading')
    btnRestart.textContent = t('pages.dashboard.restarting')
    try {
      await api.restartService('ai.openclaw.gateway')
    } catch (e) {
      toast(t('pages.dashboard.toast_restart_failed', { error: String(e) }), 'error')
      btnRestart.disabled = false
      btnRestart.classList.remove('btn-loading')
      btnRestart.textContent = t('pages.dashboard.restart_gw')
      return
    }
    // 轮询等待实际重启完成
    const t0 = Date.now()
    while (Date.now() - t0 < 30000) {
      try {
        const s = await api.getServicesStatus()
        const gw = s?.find?.(x => x.label === 'ai.openclaw.gateway') || s?.[0]
        if (gw?.running) {
          toast(t('pages.dashboard.toast_gw_restarted', { pid: gw.pid }), 'success')
          btnRestart.disabled = false
          btnRestart.classList.remove('btn-loading')
          btnRestart.textContent = t('pages.dashboard.restart_gw')
          loadDashboardData(page)
          return
        }
      } catch {}
      const sec = Math.floor((Date.now() - t0) / 1000)
      btnRestart.textContent = `${t('pages.dashboard.restarting')} ${sec}s`
      await new Promise(r => setTimeout(r, 1500))
    }
    toast(t('pages.dashboard.toast_restart_timeout'), 'warning')
    btnRestart.disabled = false
    btnRestart.classList.remove('btn-loading')
    btnRestart.textContent = t('pages.dashboard.restart_gw')
    loadDashboardData(page)
  })

  btnUpdate?.addEventListener('click', async () => {
    btnUpdate.disabled = true
    btnUpdate.textContent = t('pages.dashboard.checking')
    try {
      const info = await api.getVersionInfo()
      if (info.ahead_of_recommended && info.recommended) {
        toast(t('pages.dashboard.toast_version_ahead', { current: info.current || '', recommended: info.recommended }), 'warning')
      } else if (info.update_available && info.recommended) {
        toast(t('pages.dashboard.toast_update_found', { version: info.recommended }), 'info')
      } else if (info.latest_update_available && info.latest) {
        toast(t('pages.dashboard.toast_aligned_latest', { version: info.latest }), 'info')
      } else {
        toast(t('pages.dashboard.toast_aligned'), 'success')
      }
    } catch (e) {
      toast(t('pages.dashboard.toast_check_update_failed', { error: String(e) }), 'error')
    } finally {
      btnUpdate.disabled = false
      btnUpdate.textContent = t('pages.dashboard.check_update')
    }
  })

  btnCreateBackup?.addEventListener('click', async () => {
    btnCreateBackup.disabled = true
    btnCreateBackup.innerHTML = t('pages.dashboard.backing_up')
    try {
      const res = await api.createBackup()
      toast(t('pages.dashboard.toast_backup_done', { name: res.name }), 'success')
      setTimeout(() => { if (page.isConnected) loadDashboardData(page) }, 500)
    } catch (e) {
      toast(t('pages.dashboard.toast_backup_failed', { error: String(e) }), 'error')
    } finally {
      btnCreateBackup.disabled = false
      btnCreateBackup.textContent = t('pages.dashboard.create_backup')
    }
  })
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

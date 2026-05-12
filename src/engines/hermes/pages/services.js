/**
 * Hermes Services — 运行时服务总览
 *
 * 列出 4 大子组件 + 启用的 channel 数量,作为单页运维仪表盘。
 * 数据来自现有 RPC(hermes_health_check / hermes_list_channels),不引入新 Rust 命令。
 */
import { api } from '../../../lib/tauri-api.js'
import { t } from '../../../lib/i18n.js'
import { reportError } from '../../../lib/error-report.js'
import { navigate } from '../../../router.js'
import { escapeHtml } from '../../../lib/escape.js'

export function render() {
  const el = document.createElement('div')
  el.className = 'page'
  el.innerHTML = `
    <div class="page-header">
      <h1>${t('comp.header.page_services')}</h1>
      <p style="color:var(--text-tertiary);font-size:var(--font-size-sm);margin-top:6px">
        ${t('pages.engine.servicesHeaderHint')}
      </p>
    </div>
    <div id="hm-services-grid"></div>
  `
  load(el)
  return el
}

async function load(el) {
  const grid = el.querySelector('#hm-services-grid')
  grid.innerHTML = `<div style="text-align:center;color:var(--text-tertiary);padding:24px">${t('common.loading')}</div>`
  try {
    const [info, channels] = await Promise.all([
      api.checkHermes().catch(() => null),
      api.hermesListChannels().catch(() => ({ channels: [] })),
    ])
    renderGrid(el, info, channels)
  } catch (e) {
    reportError(e, { context: t('pages.engine.servicesLoadError') })
    grid.innerHTML = `<div style="color:var(--error);padding:16px;text-align:center">${escapeHtml(String(e))}</div>`
  }
}

function renderGrid(el, info, channels) {
  const gwRunning = !!info?.gatewayRunning
  const port = info?.gatewayPort || 8642
  const apiServerOn = (channels?.channels || []).find(c => c.key === 'api_server')?.enabled ?? false
  const enabledChannels = (channels?.channels || []).filter(c => c.enabled && !['cli', 'api_server'].includes(c.key))
  const apiEndpoint = `http://127.0.0.1:${port}/v1/runs`
  const apiCurl = `curl -X POST ${apiEndpoint} \\
  -H "Authorization: Bearer clawpanel-local" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt":"Hello"}'`
  const grid = el.querySelector('#hm-services-grid')
  grid.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">
      ${serviceCard({
        title: t('pages.engine.servicesGateway'),
        desc: t('pages.engine.servicesGatewayDesc'),
        status: gwRunning ? t('pages.engine.dashRunning') : t('pages.engine.dashStopped'),
        statusOk: gwRunning,
        link: '/h/dashboard',
        cta: t('pages.engine.servicesOpenDashboard'),
      })}
      ${serviceCard({
        title: t('pages.engine.servicesApiServer'),
        desc: t('pages.engine.servicesApiServerDesc'),
        status: apiServerOn ? t('pages.engine.servicesEnabled') : t('pages.engine.servicesDisabled'),
        statusOk: apiServerOn,
        link: '/h/config',
        cta: t('pages.engine.servicesOpenConfig'),
        extra: apiServerOn && gwRunning
          ? `<div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
              <div style="display:flex;align-items:center;gap:6px">
                <code style="flex:1;padding:4px 8px;background:var(--bg-tertiary);border-radius:4px;font-family:var(--font-mono);font-size:var(--font-size-2xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(apiEndpoint)}</code>
                <button class="btn btn-sm btn-secondary" data-copy="${escapeHtml(apiEndpoint)}" style="font-size:var(--font-size-2xs);padding:2px 8px;flex-shrink:0">${t('pages.engine.servicesCopy')}</button>
              </div>
              <details style="font-size:var(--font-size-2xs)">
                <summary style="cursor:pointer;color:var(--text-tertiary)">${t('pages.engine.servicesShowCurl')}</summary>
                <div style="display:flex;gap:6px;margin-top:6px;align-items:flex-start">
                  <pre style="flex:1;margin:0;padding:8px;background:var(--bg-tertiary);border-radius:4px;font-family:var(--font-mono);font-size:var(--font-size-2xs);overflow-x:auto;white-space:pre">${escapeHtml(apiCurl)}</pre>
                  <button class="btn btn-sm btn-secondary" data-copy="${escapeHtml(apiCurl)}" style="font-size:var(--font-size-2xs);padding:2px 8px;flex-shrink:0">${t('pages.engine.servicesCopy')}</button>
                </div>
              </details>
            </div>`
          : '',
      })}
      ${serviceCard({
        title: t('pages.engine.servicesCron'),
        desc: t('pages.engine.servicesCronDesc'),
        status: '—',
        statusOk: null,
        link: '/h/cron',
        cta: t('pages.engine.servicesOpenCron'),
      })}
      ${serviceCard({
        title: t('pages.engine.servicesChannels'),
        desc: t('pages.engine.servicesChannelsDesc'),
        status: t('pages.engine.servicesChannelsEnabledN', { count: enabledChannels.length }),
        statusOk: enabledChannels.length > 0,
        link: '/h/channels',
        cta: t('pages.engine.servicesOpenChannels'),
        extra: enabledChannels.length
          ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">
              ${enabledChannels.slice(0, 6).map(c => `<span style="font-size:var(--font-size-2xs);padding:2px 8px;border-radius:999px;background:var(--accent-muted);color:var(--accent)">${escapeHtml(c.label)}</span>`).join('')}
              ${enabledChannels.length > 6 ? `<span style="font-size:var(--font-size-2xs);color:var(--text-tertiary)">+${enabledChannels.length - 6}</span>` : ''}
            </div>`
          : '',
      })}
    </div>
  `
  el.querySelectorAll('button[data-service-link]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.serviceLink))
  })
  el.querySelectorAll('button[data-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy)
        const orig = btn.textContent
        btn.textContent = t('pages.engine.servicesCopied')
        setTimeout(() => { btn.textContent = orig }, 1200)
      } catch (_) {
        // 无 clipboard 权限,降级 — 选中文本让用户手动复制
      }
    })
  })
}

function serviceCard({ title, desc, status, statusOk, link, cta, extra }) {
  const dotColor = statusOk === true ? 'var(--success)' : statusOk === false ? 'var(--text-tertiary)' : 'var(--warning)'
  return `
    <div class="card" style="padding:14px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px">
        <div style="font-size:var(--font-size-md);font-weight:var(--font-weight-semibold);color:var(--text-primary)">${escapeHtml(title)}</div>
        <span style="display:inline-flex;align-items:center;gap:4px;font-size:var(--font-size-2xs);color:var(--text-secondary)">
          <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${dotColor}"></span>
          ${escapeHtml(status)}
        </span>
      </div>
      <div style="font-size:var(--font-size-2xs);color:var(--text-tertiary);line-height:1.5;margin-bottom:10px">${escapeHtml(desc)}</div>
      ${extra || ''}
      <button class="btn btn-sm btn-secondary" style="margin-top:10px;width:100%" data-service-link="${escapeHtml(link)}">${escapeHtml(cta)} →</button>
    </div>
  `
}

/**
 * 插件中心 — OpenClaw 扩展插件管理与浏览
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { navigate } from '../router.js'
import { t } from '../lib/i18n.js'
import { openAIDrawerWithError } from '../components/ai-drawer.js'
import { icon } from '../lib/icons.js'

// 插件/渠道图标 — Apple 线条 SVG id(替代 emoji)
const PLUGIN_ICONS = {
  qqbot:    'message-circle', feishu:   'message-square', dingtalk: 'bell',     telegram: 'send',
  discord:  'message-square', slack:    'hash',           weixin:   'message-circle', wechat: 'message-circle',
  webchat:  'globe',          whatsapp: 'smartphone',     signal:   'lock',     line:     'message-circle',
  teams:    'users',          matrix:   'link',           irc:      'radio',
}

let _allPlugins = []
let _searchQuery = ''

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') }

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'
  _searchQuery = ''

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title apple-section">${t('pages.plugin_hub.title')}</h1>
      <div class="page-actions" style="display:flex;align-items:center;gap:var(--space-sm)">
        <button class="btn btn-pill-filled" id="ph-refresh">${t('pages.plugin_hub.refresh')}</button>
        <button class="btn btn-pill-outline" id="ph-go-channels">${t('pages.plugin_hub.goToChannels')}</button>
      </div>
    </div>
    <p class="apple-body-secondary" style="margin-bottom:var(--space-md)">${t('pages.plugin_hub.subtitle')}</p>
    <div id="ph-stats" class="route-map-stats"></div>
    <div style="display:flex;gap:10px;margin-bottom:var(--space-md);flex-wrap:wrap">
      <div style="flex:1;min-width:200px;position:relative">
        <input type="text" class="form-input" id="ph-search" placeholder="${t('pages.plugin_hub.searchPlaceholder')}" style="width:100%;padding-left:32px">
        <svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--text-tertiary)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="text" class="form-input" id="ph-pkg-input" placeholder="${t('pages.plugin_hub.installPlaceholder')}" style="width:220px">
        <button class="btn btn-pill-filled" id="ph-install-btn" style="white-space:nowrap">${t('pages.plugin_hub.installBtn')}</button>
      </div>
    </div>
    <div id="ph-install-msg" style="display:none;margin-bottom:var(--space-md)"></div>
    <div id="ph-list">
      <div class="stat-card loading-placeholder" style="height:200px"></div>
    </div>
  `

  page.querySelector('#ph-refresh').onclick = () => loadPlugins(page)
  page.querySelector('#ph-go-channels').onclick = () => navigate('/channels')
  page.querySelector('#ph-install-btn').onclick = () => handleInstall(page)
  page.querySelector('#ph-pkg-input').onkeydown = (e) => { if (e.key === 'Enter') handleInstall(page) }
  page.querySelector('#ph-search').oninput = (e) => {
    _searchQuery = e.target.value.trim().toLowerCase()
    renderPluginList(page)
  }

  // Event delegation for toggle buttons
  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-toggle-plugin]')
    if (!btn) return
    const pluginId = btn.dataset.togglePlugin
    const newEnabled = btn.dataset.toggleTo === 'true'
    btn.disabled = true
    btn.textContent = '...'
    try {
      await api.togglePlugin(pluginId, newEnabled)
      toast(t('pages.plugin_hub.toggleSuccess'), 'success')
      await loadPlugins(page)
    } catch (err) {
      toast(`${t('pages.plugin_hub.toggleFailed')}: ${err}`, 'error')
      btn.disabled = false
      btn.textContent = newEnabled ? t('pages.plugin_hub.enable') : t('pages.plugin_hub.disable')
    }
  })

  // Expand/collapse install messages
  page.addEventListener('click', (e) => {
    if (e.target.closest('#ph-install-msg-toggle')) {
      const detail = page.querySelector('#ph-install-msg-detail')
      const toggle = page.querySelector('#ph-install-msg-toggle')
      if (detail && toggle) {
        const expanded = detail.style.display !== 'none'
        detail.style.display = expanded ? 'none' : 'block'
        toggle.textContent = expanded ? t('pages.plugin_hub.showDetail') : t('pages.plugin_hub.hideDetail')
      }
    }
  })

  setTimeout(() => loadPlugins(page), 0)
  return page
}

async function handleInstall(page) {
  const input = page.querySelector('#ph-pkg-input')
  const btn = page.querySelector('#ph-install-btn')
  const msgEl = page.querySelector('#ph-install-msg')
  const pkg = input.value.trim()
  if (!pkg) return

  btn.disabled = true
  btn.textContent = t('pages.plugin_hub.installing')
  msgEl.style.display = 'block'
  msgEl.innerHTML = `<div style="padding:10px 14px;border-radius:8px;background:var(--bg-secondary);color:var(--text-tertiary);font-size:13px">${t('pages.plugin_hub.installing')}</div>`

  try {
    const result = await api.installPlugin(pkg)
    const output = result.output ? esc(result.output).substring(0, 120) : ''
    msgEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:8px;background:var(--success-bg,#f0fdf4);border:1px solid var(--success-border,#86efac);color:var(--success);font-size:13px">
      ${icon('check-circle', 16)}
      <span>${t('pages.plugin_hub.installSuccess')}${output ? ' — ' + output : ''}</span>
    </div>`
    toast(t('pages.plugin_hub.installSuccess'), 'success')
    input.value = ''
    await loadPlugins(page)
    setTimeout(() => { msgEl.style.display = 'none' }, 5000)
  } catch (e) {
    const errStr = String(e.message || e)
    const short = errStr.length > 100 ? errStr.substring(0, 100) + '...' : errStr
    const hasDetail = errStr.length > 100
    msgEl.innerHTML = `<div style="padding:10px 14px;border-radius:8px;background:var(--error-bg,#fef2f2);border:1px solid var(--error-border,#fca5a5);font-size:13px">
      <div style="display:flex;align-items:center;gap:8px;color:var(--error)">
        ${icon('x-circle', 16)}
        <span>${t('pages.plugin_hub.installFailed')}: ${esc(short)}</span>
        ${hasDetail ? `<button id="ph-install-msg-toggle" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:12px;white-space:nowrap;padding:0">${t('pages.plugin_hub.showDetail')}</button>` : ''}
      </div>
      ${hasDetail ? `<pre id="ph-install-msg-detail" style="display:none;margin-top:8px;font-size:11px;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary);background:var(--bg-secondary);padding:8px;border-radius:6px">${esc(errStr)}</pre>` : ''}
    </div>`
    toast(t('pages.plugin_hub.installFailed'), 'error')
    openAIDrawerWithError({
      scene: 'plugin-install',
      title: t('pages.plugin_hub.installFailed') + ': ' + pkg,
      hint: t('pages.plugin_hub.installPlaceholder'),
      error: errStr,
    })
  } finally {
    btn.disabled = false
    btn.textContent = t('pages.plugin_hub.installBtn')
  }
}

async function loadPlugins(page) {
  const listEl = page.querySelector('#ph-list')
  const statsEl = page.querySelector('#ph-stats')
  listEl.innerHTML = `<div class="stat-card loading-placeholder" style="height:200px;display:flex;align-items:center;justify-content:center;color:var(--text-tertiary)">${t('pages.plugin_hub.loading')}</div>`

  try {
    const result = await api.listAllPlugins()
    _allPlugins = result?.plugins || []

    if (_allPlugins.length === 0) {
      statsEl.innerHTML = ''
      listEl.innerHTML = `<div class="stat-card" style="padding:var(--space-xl);text-align:center">
        <div class="apple-tile">${t('pages.plugin_hub.noPlugins')}</div>
      </div>`
      return
    }

    const enabled = _allPlugins.filter(p => p.enabled).length
    const builtin = _allPlugins.filter(p => p.builtin).length

    statsEl.innerHTML = `
      <div class="route-map-stat"><span class="route-map-stat-num apple-tile">${_allPlugins.length}</span><span class="route-map-stat-label apple-caption">${t('pages.plugin_hub.statsInstalled')}</span></div>
      <div class="route-map-stat"><span class="route-map-stat-num apple-tile">${enabled}</span><span class="route-map-stat-label apple-caption">${t('pages.plugin_hub.statsEnabled')}</span></div>
      ${builtin ? `<div class="route-map-stat"><span class="route-map-stat-num apple-tile">${builtin}</span><span class="route-map-stat-label apple-caption">${t('pages.plugin_hub.statsBuiltin')}</span></div>` : ''}
    `

    renderPluginList(page)
  } catch (e) {
    listEl.innerHTML = `<div class="stat-card" style="padding:var(--space-lg);color:var(--error)">${esc(e.message || e)}</div>`
  }
}

function renderPluginList(page) {
  const listEl = page.querySelector('#ph-list')
  if (!listEl) return

  const filtered = _searchQuery
    ? _allPlugins.filter(p => {
        const q = _searchQuery
        return (p.id || '').toLowerCase().includes(q) ||
               (p.description || '').toLowerCase().includes(q) ||
               (p.version || '').toLowerCase().includes(q)
      })
    : _allPlugins

  if (filtered.length === 0 && _searchQuery) {
    listEl.innerHTML = `<div class="stat-card" style="padding:var(--space-lg);text-align:center;color:var(--text-tertiary)">
      ${t('pages.plugin_hub.noSearchResults', { query: esc(_searchQuery) })}
    </div>`
    return
  }

  listEl.innerHTML = `<div class="plugin-grid">${filtered.map(p => renderPluginCard(p)).join('')}</div>
    <div class="form-hint" style="margin-top:var(--space-md);font-size:var(--font-size-xs)">${t('pages.plugin_hub.restartHint')}</div>`
}

function renderPluginCard(p) {
  const iconId = PLUGIN_ICONS[p.id.toLowerCase()] || 'package'
  const iconSvg = icon(iconId, 22)
  const statusClass = p.enabled ? 'plugin-status-enabled' : (p.installed ? 'plugin-status-disabled' : 'plugin-status-missing')
  const statusText = p.enabled ? t('pages.plugin_hub.enabled') : (p.installed ? t('pages.plugin_hub.disabled') : t('pages.plugin_hub.notInstalled'))
  const badges = []
  if (p.builtin) badges.push(`<span class="plugin-badge plugin-badge-builtin">${t('pages.plugin_hub.builtin')}</span>`)
  if (p.version) badges.push(`<span class="plugin-badge plugin-badge-version">${t('pages.plugin_hub.version')} ${esc(p.version)}</span>`)

  // Toggle button: installed plugins can be enabled/disabled
  let toggleBtn = ''
  if (p.installed) {
    if (p.enabled) {
      toggleBtn = `<button class="btn btn-sm btn-secondary" data-toggle-plugin="${esc(p.id)}" data-toggle-to="false">${t('pages.plugin_hub.disable')}</button>`
    } else {
      toggleBtn = `<button class="btn btn-sm btn-primary" data-toggle-plugin="${esc(p.id)}" data-toggle-to="true">${t('pages.plugin_hub.enable')}</button>`
    }
  }

  return `
    <div class="plugin-card ${p.enabled ? '' : 'plugin-card-inactive'}">
      <div class="plugin-card-header">
        <span class="plugin-card-icon">${iconSvg}</span>
        <div class="plugin-card-title">
          <span class="plugin-card-name">${esc(p.id)}</span>
          <div class="plugin-card-badges">${badges.join('')}</div>
        </div>
        <span class="plugin-status-dot ${statusClass}" title="${statusText}"></span>
      </div>
      <div class="plugin-card-desc">${esc(p.description) || t('pages.plugin_hub.noDescription')}</div>
      <div class="plugin-card-footer">
        <span class="plugin-card-status">${statusText}</span>
        ${toggleBtn}
      </div>
    </div>
  `
}

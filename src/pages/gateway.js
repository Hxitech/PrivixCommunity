/**
 * Gateway 配置页面 — 小白友好版
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { t } from '../lib/i18n.js'

// 兼容新版 SecretRef：token 可能是 string 或 { $env: "VAR" } / { $ref: "x/y" }
function _tokenDisplayStr(token) {
  if (!token) return ''
  if (typeof token === 'string') return token
  if (typeof token === 'object') {
    if (token.$env) return `\$env:${token.$env}`
    if (token.$ref) return `\$ref:${token.$ref}`
    return JSON.stringify(token)
  }
  return String(token)
}
function _isSecretRef(token) {
  return token && typeof token === 'object' && ('$env' in token || '$ref' in token)
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title apple-section">${t('pages.gateway.title')}</h1>
      <p class="page-desc apple-body-secondary">${t('pages.gateway.desc')}</p>
    </div>
    <div id="gateway-config">
      <div class="config-section"><div class="stat-card loading-placeholder" style="height:80px"></div></div>
      <div class="config-section"><div class="stat-card loading-placeholder" style="height:80px"></div></div>
      <div class="config-section"><div class="stat-card loading-placeholder" style="height:80px"></div></div>
    </div>
    <div class="gw-save-bar">
      <button class="btn btn-pill-filled" id="btn-save-gw">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
        ${t('pages.gateway.save_apply')}
      </button>
      <span class="gw-save-hint apple-caption">${t('pages.gateway.save_hint')}</span>
    </div>
  `

  const state = { config: null, _origToken: null }
  // 非阻塞：先返回 DOM，后台加载数据
  loadConfig(page, state)
  page.querySelector('#btn-save-gw').onclick = async () => {
    const btn = page.querySelector('#btn-save-gw')
    btn.disabled = true
    btn.classList.add('btn-loading')
    btn.textContent = t('pages.gateway.saving')
    try {
      await saveConfig(page, state)
    } finally {
      btn.disabled = false
      btn.classList.remove('btn-loading')
      btn.className = 'btn btn-pill-filled'
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg> ${t('pages.gateway.save_apply')}`
    }
  }
  return page
}

async function loadConfig(page, state) {
  const el = page.querySelector('#gateway-config')
  try {
    state.config = await api.readOpenclawConfig()
    state._origToken = state.config?.gateway?.auth?.token ?? null
    renderConfig(page, state)
  } catch (e) {
    el.innerHTML = `<div style="color:var(--error);padding:20px">${t('pages.gateway.load_fail', { error: String(e) })}</div>`
    toast(t('pages.gateway.load_fail', { error: String(e) }), 'error')
  }
}

function renderConfig(page, state) {
  const el = page.querySelector('#gateway-config')
  const gw = state.config?.gateway || {}

  // 端口 + 谁能访问
  el.innerHTML = `
    <div class="config-section">
      <div class="config-section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
        ${t('pages.gateway.section_port')}
      </div>
      <div class="form-group">
        <label class="form-label">${t('pages.gateway.port_label')}</label>
        <input class="form-input" id="gw-port" type="number" value="${gw.port || 18789}" min="1024" max="65535" style="max-width:200px">
        <div class="form-hint">${t('pages.gateway.port_hint')}</div>
      </div>
    </div>

    <div class="config-section">
      <div class="config-section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
        ${t('pages.gateway.section_access')}
      </div>
      <div class="gw-option-cards">
        <label class="gw-option-card ${(gw.bind === 'lan' || gw.bind === 'all') ? '' : 'selected'}" data-bind="loopback">
          <input type="radio" name="gw-bind" value="loopback" ${(gw.bind === 'lan' || gw.bind === 'all') ? '' : 'checked'} hidden>
          <div class="gw-option-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          </div>
          <div class="gw-option-text">
            <div class="gw-option-title">${t('pages.gateway.bind_loopback_title')}</div>
            <div class="gw-option-desc">${t('pages.gateway.bind_loopback_desc')}</div>
          </div>
        </label>
        <label class="gw-option-card ${(gw.bind === 'lan' || gw.bind === 'all') ? 'selected' : ''}" data-bind="lan">
          <input type="radio" name="gw-bind" value="lan" ${(gw.bind === 'lan' || gw.bind === 'all') ? 'checked' : ''} hidden>
          <div class="gw-option-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="6" width="7" height="10" rx="1"/><rect x="9" y="3" width="6" height="14" rx="1"/><rect x="16" y="6" width="7" height="10" rx="1"/><line x1="8" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="16" y2="12"/></svg>
          </div>
          <div class="gw-option-text">
            <div class="gw-option-title">${t('pages.gateway.bind_lan_title')}</div>
            <div class="gw-option-desc">${t('pages.gateway.bind_lan_desc')}</div>
          </div>
        </label>
      </div>
    </div>

    <div class="config-section">
      <div class="config-section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        ${t('pages.gateway.section_auth')}
      </div>
      <div class="form-group" style="margin-bottom:var(--space-md)">
        <label class="form-label">${t('pages.gateway.auth_mode_label')}</label>
        <div class="gw-option-cards">
          <label class="gw-option-card ${gw.auth?.mode === 'password' ? '' : 'selected'}" data-auth="token">
            <input type="radio" name="gw-auth-mode" value="token" ${gw.auth?.mode === 'password' ? '' : 'checked'} hidden>
            <div class="gw-option-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            </div>
            <div class="gw-option-text">
              <div class="gw-option-title">${t('pages.gateway.auth_token_title')}</div>
              <div class="gw-option-desc">${t('pages.gateway.auth_token_desc')}</div>
            </div>
          </label>
          <label class="gw-option-card ${gw.auth?.mode === 'password' ? 'selected' : ''}" data-auth="password">
            <input type="radio" name="gw-auth-mode" value="password" ${gw.auth?.mode === 'password' ? 'checked' : ''} hidden>
            <div class="gw-option-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            </div>
            <div class="gw-option-text">
              <div class="gw-option-title">${t('pages.gateway.auth_password_title')}</div>
              <div class="gw-option-desc">${t('pages.gateway.auth_password_desc')}</div>
            </div>
          </label>
        </div>
      </div>
      <div class="form-group" id="gw-auth-token-group" style="${gw.auth?.mode === 'password' ? 'display:none' : ''}">
        <label class="form-label">${t('pages.gateway.token_label')}</label>
        <div style="display:flex;gap:8px">
          <input class="form-input" id="gw-token" type="password" value="${_tokenDisplayStr(gw.auth?.token || gw.authToken)}" placeholder="${t('pages.gateway.token_placeholder')}" style="flex:1" ${_isSecretRef(gw.auth?.token) ? 'readonly' : ''}>
          <button class="btn btn-sm btn-secondary" id="btn-toggle-token">${t('pages.gateway.btn_show')}</button>
        </div>
        <div class="form-hint">${_isSecretRef(gw.auth?.token) ? t('pages.gateway.token_hint_secretref') : t('pages.gateway.token_hint_normal')}</div>
      </div>
      <div class="form-group" id="gw-auth-password-group" style="${gw.auth?.mode === 'password' ? '' : 'display:none'}">
        <label class="form-label">${t('pages.gateway.password_label')}</label>
        <div style="display:flex;gap:8px">
          <input class="form-input" id="gw-password" type="password" value="${gw.auth?.password || ''}" placeholder="${t('pages.gateway.password_placeholder')}" style="flex:1">
          <button class="btn btn-sm btn-secondary" id="btn-toggle-password">${t('pages.gateway.btn_show')}</button>
        </div>
        <div class="form-hint">${t('pages.gateway.password_hint')}</div>
      </div>
    </div>

    <div class="config-section">
      <div class="config-section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
        ${t('pages.gateway.section_tools')}
      </div>
      <div class="form-group" style="margin-bottom:var(--space-md)">
        <label class="form-label">${t('pages.gateway.tools_label')}</label>
        <div class="gw-option-cards">
          <label class="gw-option-card ${(gw.tools?.profile || 'full') === 'full' ? 'selected' : ''}" data-tools-profile="full">
            <input type="radio" name="gw-tools-profile" value="full" ${(gw.tools?.profile || 'full') === 'full' ? 'checked' : ''} hidden>
            <div class="gw-option-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <div class="gw-option-text">
              <div class="gw-option-title">${t('pages.gateway.tools_full_title')}</div>
              <div class="gw-option-desc">${t('pages.gateway.tools_full_desc')}</div>
            </div>
          </label>
          <label class="gw-option-card ${gw.tools?.profile === 'limited' ? 'selected' : ''}" data-tools-profile="limited">
            <input type="radio" name="gw-tools-profile" value="limited" ${gw.tools?.profile === 'limited' ? 'checked' : ''} hidden>
            <div class="gw-option-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            </div>
            <div class="gw-option-text">
              <div class="gw-option-title">${t('pages.gateway.tools_limited_title')}</div>
              <div class="gw-option-desc">${t('pages.gateway.tools_limited_desc')}</div>
            </div>
          </label>
          <label class="gw-option-card ${gw.tools?.profile === 'none' ? 'selected' : ''}" data-tools-profile="none">
            <input type="radio" name="gw-tools-profile" value="none" ${gw.tools?.profile === 'none' ? 'checked' : ''} hidden>
            <div class="gw-option-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            </div>
            <div class="gw-option-text">
              <div class="gw-option-title">${t('pages.gateway.tools_none_title')}</div>
              <div class="gw-option-desc">${t('pages.gateway.tools_none_desc')}</div>
            </div>
          </label>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('pages.gateway.sessions_label')}</label>
        <select class="form-input" id="gw-sessions-visibility" style="width:auto;min-width:180px">
          <option value="all" ${(gw.tools?.sessions?.visibility || 'all') === 'all' ? 'selected' : ''}>${t('pages.gateway.sessions_all')}</option>
          <option value="own" ${gw.tools?.sessions?.visibility === 'own' ? 'selected' : ''}>${t('pages.gateway.sessions_own')}</option>
          <option value="none" ${gw.tools?.sessions?.visibility === 'none' ? 'selected' : ''}>${t('pages.gateway.sessions_none')}</option>
        </select>
        <div class="form-hint">${t('pages.gateway.sessions_hint')}</div>
      </div>
    </div>

    <div class="gw-advanced-toggle" id="gw-advanced-toggle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="6 9 12 15 18 9"/></svg>
      ${t('pages.gateway.advanced_toggle')}
    </div>
    <div class="gw-advanced-panel" id="gw-advanced-panel" style="display:none">
      <div class="config-section">
        <div class="config-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
          ${t('pages.gateway.section_tailscale')}
        </div>
        <div class="form-group">
          <label class="form-label">${t('pages.gateway.tailscale_label')}</label>
          <input class="form-input" id="gw-tailscale" value="${gw.tailscale?.address || ''}" placeholder="${t('pages.gateway.tailscale_placeholder')}">
          <div class="form-hint">${t('pages.gateway.tailscale_hint')}</div>
        </div>
      </div>
    </div>
  `

  bindConfigEvents(el)
}

function bindConfigEvents(el) {
  // 密码显示/隐藏
  function bindToggle(btnId, inputId) {
    const btn = el.querySelector('#' + btnId)
    if (!btn) return
    btn.onclick = () => {
      const input = el.querySelector('#' + inputId)
      if (input.type === 'password') {
        input.type = 'text'
        btn.textContent = t('pages.gateway.btn_hide')
      } else {
        input.type = 'password'
        btn.textContent = t('pages.gateway.btn_show')
      }
    }
  }
  bindToggle('btn-toggle-token', 'gw-token')
  bindToggle('btn-toggle-password', 'gw-password')

  // 选项卡片点击高亮
  el.querySelectorAll('.gw-option-cards').forEach(group => {
    group.querySelectorAll('.gw-option-card').forEach(card => {
      card.addEventListener('click', () => {
        group.querySelectorAll('.gw-option-card').forEach(c => c.classList.remove('selected'))
        card.classList.add('selected')
      })
    })
  })

  // 认证模式切换：显示/隐藏对应输入框
  el.querySelectorAll('input[name="gw-auth-mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const mode = radio.value
      const tokenGroup = el.querySelector('#gw-auth-token-group')
      const passwordGroup = el.querySelector('#gw-auth-password-group')
      if (tokenGroup) tokenGroup.style.display = mode === 'token' ? '' : 'none'
      if (passwordGroup) passwordGroup.style.display = mode === 'password' ? '' : 'none'
    })
  })

  // 高级选项折叠
  el.querySelector('#gw-advanced-toggle').onclick = () => {
    const panel = el.querySelector('#gw-advanced-panel')
    const toggle = el.querySelector('#gw-advanced-toggle')
    const visible = panel.style.display !== 'none'
    panel.style.display = visible ? 'none' : 'block'
    toggle.classList.toggle('open', !visible)
  }
}

async function saveConfig(page, state) {
  const port = parseInt(page.querySelector('#gw-port')?.value) || 18789
  const bindRadio = page.querySelector('input[name="gw-bind"]:checked')
  const bind = bindRadio?.value || 'loopback'
  const mode = 'local'
  const authModeRadio = page.querySelector('input[name="gw-auth-mode"]:checked')
  const authMode = authModeRadio?.value || 'token'
  const authToken = page.querySelector('#gw-token')?.value || ''
  const authPassword = page.querySelector('#gw-password')?.value || ''
  const tailscaleAddr = page.querySelector('#gw-tailscale')?.value || ''

  // 兼容 SecretRef：如果用户没改 token 显示值，保留原始对象
  let resolvedToken = authToken
  if (_isSecretRef(state._origToken) && authToken === _tokenDisplayStr(state._origToken)) {
    resolvedToken = state._origToken
  }
  const auth = authMode === 'password'
    ? { mode: 'password', password: authPassword }
    : resolvedToken ? { mode: 'token', token: resolvedToken } : {}

  const toolsProfile = page.querySelector('input[name="gw-tools-profile"]:checked')?.value || 'full'
  const sessionsVisibility = page.querySelector('#gw-sessions-visibility')?.value || 'all'

  state.config.tools = {
    ...(state.config.tools || {}),
    profile: toolsProfile,
    sessions: { ...(state.config.tools?.sessions || {}), visibility: sessionsVisibility },
  }

  state.config.gateway = {
    ...state.config.gateway,
    port, bind, mode,
    auth,
    tailscale: tailscaleAddr.trim() ? { address: tailscaleAddr.trim() } : undefined,
  }

  try {
    await api.writeOpenclawConfig(state.config)
    toast(t('pages.gateway.toast_saving'), 'info')
    try {
      await api.reloadGateway()
      toast(t('pages.gateway.toast_reloaded'), 'success')
    } catch (e) {
      toast(t('pages.gateway.toast_reload_fail', { error: String(e) }), 'warning')
    }
  } catch (e) {
    toast(t('pages.gateway.toast_save_fail', { error: String(e) }), 'error')
  }
}

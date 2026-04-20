/**
 * 通信设置页面 — 消息、广播、命令、音频等 openclaw.json 配置的可视化编辑器
 * 对应上游 Dashboard 的「通信」+「自动化」合并页
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { icon } from '../lib/icons.js'
import { t } from '../lib/i18n.js'

let _page = null, _config = null, _dirty = false

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'
  _page = page

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title apple-section">${t('pages.communication.title')}</h1>
      <p class="page-desc apple-body-secondary">${t('pages.communication.desc')}</p>
    </div>
    <div class="comm-toolbar" style="display:flex;gap:8px;margin-bottom:var(--space-lg);flex-wrap:wrap">
      <button class="btn btn-sm btn-primary comm-tab active" data-tab="messages">${t('pages.communication.tab_messages')}</button>
      <button class="btn btn-sm btn-secondary comm-tab" data-tab="broadcast">${t('pages.communication.tab_broadcast')}</button>
      <button class="btn btn-sm btn-secondary comm-tab" data-tab="commands">${t('pages.communication.tab_commands')}</button>
      <button class="btn btn-sm btn-secondary comm-tab" data-tab="hooks">${t('pages.communication.tab_hooks')}</button>
      <button class="btn btn-sm btn-secondary comm-tab" data-tab="approvals">${t('pages.communication.tab_approvals')}</button>
      <div style="flex:1"></div>
      <button class="btn btn-pill-filled" id="btn-comm-save" disabled>${icon('save', 14)} ${t('common.save')}</button>
    </div>
    <div id="comm-content">
      <div class="stat-card loading-placeholder" style="height:200px"></div>
    </div>
  `

  // Tab 切换
  page.querySelectorAll('.comm-tab').forEach(tab => {
    tab.onclick = () => {
      page.querySelectorAll('.comm-tab').forEach(t => { t.classList.remove('active', 'btn-primary'); t.classList.add('btn-secondary') })
      tab.classList.remove('btn-secondary'); tab.classList.add('active', 'btn-primary')
      renderTab(page, tab.dataset.tab)
    }
  })

  // 保存按钮
  page.querySelector('#btn-comm-save').onclick = saveConfig

  await loadConfig(page)
  return page
}

export function cleanup() { _page = null; _config = null; _dirty = false }

async function loadConfig(page) {
  try {
    _config = await api.readOpenclawConfig()
    if (!_config) _config = {}
    renderTab(page, 'messages')
  } catch (e) {
    page.querySelector('#comm-content').innerHTML = `<div style="color:var(--error)">${t('pages.communication.load_fail', { error: esc(e?.message || e) })}</div>`
  }
}

function markDirty() {
  _dirty = true
  const btn = _page?.querySelector('#btn-comm-save')
  if (btn) btn.disabled = false
}

async function saveConfig() {
  if (!_config || !_dirty) return
  const btn = _page?.querySelector('#btn-comm-save')
  if (btn) { btn.disabled = true; btn.textContent = t('pages.communication.saving') }
  try {
    // 从当前表单收集值到 _config
    collectCurrentTab()
    await api.writeOpenclawConfig(_config)
    _dirty = false
    toast(t('pages.communication.toast_saving'), 'info')
    try { await api.reloadGateway(); toast(t('pages.communication.toast_reloaded'), 'success') } catch (e) { console.warn('[communication] reloadGateway:', e) }
  } catch (e) {
    toast(t('pages.communication.toast_save_fail', { error: String(e) }), 'error')
  } finally {
    if (btn) { btn.disabled = !_dirty; btn.innerHTML = `${icon('save', 14)} ${t('common.save')}` }
  }
}

function collectCurrentTab() {
  if (!_page) return
  const activeTab = _page.querySelector('.comm-tab.active')?.dataset.tab
  if (activeTab === 'messages') collectMessages()
  else if (activeTab === 'broadcast') collectBroadcast()
  else if (activeTab === 'commands') collectCommands()
  else if (activeTab === 'hooks') collectHooks()
  else if (activeTab === 'approvals') collectApprovals()
}

// ── Tab 渲染 ──

function renderTab(page, tab) {
  const el = page.querySelector('#comm-content')
  if (tab === 'messages') renderMessages(el)
  else if (tab === 'broadcast') renderBroadcast(el)
  else if (tab === 'commands') renderCommands(el)
  else if (tab === 'hooks') renderHooks(el)
  else if (tab === 'approvals') renderApprovals(el)
}

// ── 消息设置 ──

function renderMessages(el) {
  const m = _config?.messages || {}
  const sr = m.statusReactions || {}
  el.innerHTML = `
    <div class="config-section">
      <div class="config-section-title">${t('pages.communication.msg_section_reply')}</div>
      <div class="form-group">
        <label class="form-label">${t('pages.communication.msg_prefix_label')}</label>
        <input class="form-input" id="msg-responsePrefix" value="${esc(m.responsePrefix || '')}" placeholder="如 [{model}] 或 auto">
        <div class="form-hint">${t('pages.communication.msg_prefix_hint')}</div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('pages.communication.msg_ack_label')}</label>
        <input class="form-input" id="msg-ackReaction" value="${esc(m.ackReaction || '')}" placeholder="如 👀 或留空禁用" style="max-width:200px">
        <div class="form-hint">${t('pages.communication.msg_ack_hint')}</div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('pages.communication.msg_ack_scope_label')}</label>
        <select class="form-input" id="msg-ackReactionScope" style="max-width:300px">
          <option value="group-mentions" ${(m.ackReactionScope || 'group-mentions') === 'group-mentions' ? 'selected' : ''}>${t('pages.communication.msg_ack_scope_group_mentions')}</option>
          <option value="group-all" ${m.ackReactionScope === 'group-all' ? 'selected' : ''}>${t('pages.communication.msg_ack_scope_group_all')}</option>
          <option value="direct" ${m.ackReactionScope === 'direct' ? 'selected' : ''}>${t('pages.communication.msg_ack_scope_direct')}</option>
          <option value="all" ${m.ackReactionScope === 'all' ? 'selected' : ''}>${t('pages.communication.msg_ack_scope_all')}</option>
          <option value="off" ${m.ackReactionScope === 'off' ? 'selected' : ''}>${t('pages.communication.msg_ack_scope_off')}</option>
        </select>
      </div>
      <div class="form-group" style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <label class="form-label" style="margin:0">${t('pages.communication.msg_remove_ack_label')}</label>
          <div class="form-hint" style="margin:0">${t('pages.communication.msg_remove_ack_hint')}</div>
        </div>
        <label class="toggle-switch"><input type="checkbox" id="msg-removeAckAfterReply" ${m.removeAckAfterReply ? 'checked' : ''}><span class="toggle-slider"></span></label>
      </div>
      <div class="form-group" style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <label class="form-label" style="margin:0">${t('pages.communication.msg_suppress_errors_label')}</label>
          <div class="form-hint" style="margin:0">${t('pages.communication.msg_suppress_errors_hint')}</div>
        </div>
        <label class="toggle-switch"><input type="checkbox" id="msg-suppressToolErrors" ${m.suppressToolErrors ? 'checked' : ''}><span class="toggle-slider"></span></label>
      </div>
    </div>

    <div class="config-section">
      <div class="config-section-title">${t('pages.communication.msg_section_status')}</div>
      <div class="form-group" style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <label class="form-label" style="margin:0">${t('pages.communication.msg_status_enabled_label')}</label>
          <div class="form-hint" style="margin:0">${t('pages.communication.msg_status_enabled_hint')}</div>
        </div>
        <label class="toggle-switch"><input type="checkbox" id="msg-sr-enabled" ${sr.enabled ? 'checked' : ''}><span class="toggle-slider"></span></label>
      </div>
    </div>

    <div class="config-section">
      <div class="config-section-title">${t('pages.communication.msg_section_queue')}</div>
      <div class="form-group">
        <label class="form-label">${t('pages.communication.msg_debounce_label')}</label>
        <input class="form-input" id="msg-debounceMs" type="number" value="${m.inbound?.debounceMs || m.queue?.debounceMs || ''}" placeholder="默认无延迟" style="max-width:200px">
        <div class="form-hint">${t('pages.communication.msg_debounce_hint')}</div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('pages.communication.msg_queue_cap_label')}</label>
        <input class="form-input" id="msg-queueCap" type="number" value="${m.queue?.cap || ''}" placeholder="默认无限制" style="max-width:200px">
        <div class="form-hint">${t('pages.communication.msg_queue_cap_hint')}</div>
      </div>
    </div>

    <div class="config-section">
      <div class="config-section-title">${t('pages.communication.msg_section_group')}</div>
      <div class="form-group">
        <label class="form-label">${t('pages.communication.msg_group_history_label')}</label>
        <input class="form-input" id="msg-groupHistoryLimit" type="number" value="${m.groupChat?.historyLimit || ''}" placeholder="默认自动" style="max-width:200px">
        <div class="form-hint">${t('pages.communication.msg_group_history_hint')}</div>
      </div>
    </div>
  `
  el.querySelectorAll('input, select').forEach(inp => {
    inp.addEventListener('change', markDirty)
    inp.addEventListener('input', markDirty)
  })
}

function collectMessages() {
  if (!_config) return
  const g = (id) => _page?.querySelector('#' + id)
  const v = (id) => g(id)?.value?.trim() || undefined
  const n = (id) => { const x = parseInt(g(id)?.value); return isNaN(x) ? undefined : x }
  const c = (id) => g(id)?.checked || false

  if (!_config.messages) _config.messages = {}
  const m = _config.messages
  m.responsePrefix = v('msg-responsePrefix')
  m.ackReaction = v('msg-ackReaction')
  m.ackReactionScope = v('msg-ackReactionScope') || undefined
  m.removeAckAfterReply = c('msg-removeAckAfterReply') || undefined
  m.suppressToolErrors = c('msg-suppressToolErrors') || undefined

  if (!m.statusReactions) m.statusReactions = {}
  m.statusReactions.enabled = c('msg-sr-enabled') || undefined

  const debounceMs = n('msg-debounceMs')
  if (debounceMs != null) {
    if (!m.inbound) m.inbound = {}
    m.inbound.debounceMs = debounceMs
  }
  const cap = n('msg-queueCap')
  if (cap != null) {
    if (!m.queue) m.queue = {}
    m.queue.cap = cap
  }
  const groupHistoryLimit = n('msg-groupHistoryLimit')
  if (groupHistoryLimit != null) {
    if (!m.groupChat) m.groupChat = {}
    m.groupChat.historyLimit = groupHistoryLimit
  }
}

// ── 广播设置 ──

function renderBroadcast(el) {
  const b = _config?.broadcast || {}
  el.innerHTML = `
    <div class="config-section">
      <div class="config-section-title">${t('pages.communication.bc_section_strategy')}</div>
      <div class="form-group">
        <label class="form-label">${t('pages.communication.bc_strategy_label')}</label>
        <select class="form-input" id="bc-strategy" style="max-width:300px">
          <option value="parallel" ${(b.strategy || 'parallel') === 'parallel' ? 'selected' : ''}>${t('pages.communication.bc_strategy_parallel')}</option>
          <option value="sequential" ${b.strategy === 'sequential' ? 'selected' : ''}>${t('pages.communication.bc_strategy_sequential')}</option>
        </select>
        <div class="form-hint">${t('pages.communication.bc_strategy_hint')}</div>
      </div>
    </div>
  `
  el.querySelectorAll('input, select').forEach(inp => {
    inp.addEventListener('change', markDirty)
  })
}

function collectBroadcast() {
  if (!_config) return
  const strategy = _page?.querySelector('#bc-strategy')?.value
  if (strategy) {
    if (!_config.broadcast) _config.broadcast = {}
    _config.broadcast.strategy = strategy
  }
}

// ── 命令配置 ──

function renderCommands(el) {
  const cmd = _config?.commands || {}
  el.innerHTML = `
    <div class="config-section">
      <div class="config-section-title">${t('pages.communication.cmd_section_slash')}</div>
      ${toggleRow('cmd-text', t('pages.communication.cmd_text_label'), t('pages.communication.cmd_text_hint'), cmd.text !== false)}
      ${toggleRow('cmd-bash', t('pages.communication.cmd_bash_label'), t('pages.communication.cmd_bash_hint'), !!cmd.bash)}
      ${toggleRow('cmd-config', t('pages.communication.cmd_config_label'), t('pages.communication.cmd_config_hint'), !!cmd.config)}
      ${toggleRow('cmd-debug', t('pages.communication.cmd_debug_label'), t('pages.communication.cmd_debug_hint'), !!cmd.debug)}
      ${toggleRow('cmd-restart', t('pages.communication.cmd_restart_label'), t('pages.communication.cmd_restart_hint'), cmd.restart !== false)}
    </div>
    <div class="config-section">
      <div class="config-section-title">${t('pages.communication.cmd_section_native')}</div>
      <div class="form-group">
        <label class="form-label">${t('pages.communication.cmd_native_label')}</label>
        <select class="form-input" id="cmd-native" style="max-width:200px">
          <option value="auto" ${(cmd.native === 'auto' || cmd.native === undefined) ? 'selected' : ''}>${t('pages.communication.cmd_native_auto')}</option>
          <option value="true" ${cmd.native === true ? 'selected' : ''}>${t('common.enable')}</option>
          <option value="false" ${cmd.native === false ? 'selected' : ''}>${t('common.disable')}</option>
        </select>
        <div class="form-hint">${t('pages.communication.cmd_native_hint')}</div>
      </div>
    </div>
  `
  el.querySelectorAll('input, select').forEach(inp => {
    inp.addEventListener('change', markDirty)
  })
}

function collectCommands() {
  if (!_config) return
  const c = (id) => _page?.querySelector('#' + id)?.checked
  if (!_config.commands) _config.commands = {}
  const cmd = _config.commands
  cmd.text = c('cmd-text') === false ? false : undefined
  cmd.bash = c('cmd-bash') || undefined
  cmd.config = c('cmd-config') || undefined
  cmd.debug = c('cmd-debug') || undefined
  cmd.restart = c('cmd-restart') === false ? false : undefined
  const native = _page?.querySelector('#cmd-native')?.value
  cmd.native = native === 'true' ? true : native === 'false' ? false : 'auto'
}

// ── Webhook ──

function renderHooks(el) {
  const h = _config?.hooks || {}
  el.innerHTML = `
    <div class="config-section">
      <div class="config-section-title">${t('pages.communication.hooks_section_title')}</div>
      ${toggleRow('hooks-enabled', t('pages.communication.hooks_enabled_label'), t('pages.communication.hooks_enabled_hint'), !!h.enabled)}
      <div class="form-group">
        <label class="form-label">${t('pages.communication.hooks_path_label')}</label>
        <input class="form-input" id="hooks-path" value="${esc(h.path || '')}" placeholder="/hooks" style="max-width:300px">
        <div class="form-hint">${t('pages.communication.hooks_path_hint')}</div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('pages.communication.hooks_token_label')}</label>
        <input class="form-input" id="hooks-token" type="password" value="${esc(h.token || '')}" placeholder="">
        <div class="form-hint">${t('pages.communication.hooks_token_hint')}</div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('pages.communication.hooks_session_label')}</label>
        <input class="form-input" id="hooks-defaultSessionKey" value="${esc(h.defaultSessionKey || '')}" placeholder="hook:<uuid>">
        <div class="form-hint">${t('pages.communication.hooks_session_hint')}</div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('pages.communication.hooks_max_body_label')}</label>
        <input class="form-input" id="hooks-maxBodyBytes" type="number" value="${h.maxBodyBytes || ''}" placeholder="" style="max-width:200px">
      </div>
    </div>
  `
  el.querySelectorAll('input, select').forEach(inp => {
    inp.addEventListener('change', markDirty)
    inp.addEventListener('input', markDirty)
  })
}

function collectHooks() {
  if (!_config) return
  const v = (id) => _page?.querySelector('#' + id)?.value?.trim() || undefined
  const n = (id) => { const x = parseInt(_page?.querySelector('#' + id)?.value); return isNaN(x) ? undefined : x }
  const c = (id) => _page?.querySelector('#' + id)?.checked
  if (!_config.hooks) _config.hooks = {}
  const h = _config.hooks
  h.enabled = c('hooks-enabled') || undefined
  h.path = v('hooks-path')
  h.token = v('hooks-token')
  h.defaultSessionKey = v('hooks-defaultSessionKey')
  h.maxBodyBytes = n('hooks-maxBodyBytes')
}

// ── 执行审批 ──

function renderApprovals(el) {
  const a = _config?.approvals?.exec || {}
  el.innerHTML = `
    <div class="config-section">
      <div class="config-section-title">${t('pages.communication.approvals_section_title')}</div>
      <div class="form-hint" style="margin-bottom:var(--space-md)">${t('pages.communication.approvals_section_hint')}</div>
      ${toggleRow('approvals-enabled', t('pages.communication.approvals_enabled_label'), t('pages.communication.approvals_enabled_hint'), !!a.enabled)}
      <div class="form-group">
        <label class="form-label">${t('pages.communication.approvals_mode_label')}</label>
        <select class="form-input" id="approvals-mode" style="max-width:300px">
          <option value="session" ${(a.mode || 'session') === 'session' ? 'selected' : ''}>${t('pages.communication.approvals_mode_session')}</option>
          <option value="targets" ${a.mode === 'targets' ? 'selected' : ''}>${t('pages.communication.approvals_mode_targets')}</option>
          <option value="both" ${a.mode === 'both' ? 'selected' : ''}>${t('pages.communication.approvals_mode_both')}</option>
        </select>
      </div>
      ${toggleRow('approvals-forwardExec', t('pages.communication.approvals_forward_label'), t('pages.communication.approvals_forward_hint'), !!a.enabled)}
    </div>
  `
  el.querySelectorAll('input, select').forEach(inp => {
    inp.addEventListener('change', markDirty)
  })
}

function collectApprovals() {
  if (!_config) return
  const c = (id) => _page?.querySelector('#' + id)?.checked
  const v = (id) => _page?.querySelector('#' + id)?.value
  if (!_config.approvals) _config.approvals = {}
  if (!_config.approvals.exec) _config.approvals.exec = {}
  const a = _config.approvals.exec
  a.enabled = c('approvals-enabled') || undefined
  a.mode = v('approvals-mode') || undefined
}

// ── 工具函数 ──

function toggleRow(id, label, hint, checked) {
  return `
    <div class="form-group" style="display:flex;align-items:center;justify-content:space-between">
      <div>
        <label class="form-label" style="margin:0">${label}</label>
        <div class="form-hint" style="margin:0">${hint}</div>
      </div>
      <label class="toggle-switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span class="toggle-slider"></span></label>
    </div>
  `
}

function esc(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

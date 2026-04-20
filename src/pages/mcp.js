/**
 * MCP 统一配置页面 (v1.5 Agent Studio)
 *
 * 背景:MCP (Model Context Protocol) 是跨 Agent 的工具共享协议,
 * 一次配置即可被所有接入的 CLI Agent(Claude Code、Codex、Qwen 等)共享。
 *
 * 能力:
 *   - 读取 ~/.openclaw/mcp.json(已有后端命令 read_mcp_config)
 *   - 增删改 mcpServers 条目
 *   - 支持内置模板快速添加(filesystem、github、fetch、memory 等)
 *   - JSON 编辑模式(进阶用户直接改整份配置)
 */
import '../style/mcp.css'
import { api, invalidate } from '../lib/tauri-api.js'
import { escapeHtml, escapeAttr, truncate } from '../lib/escape.js'
import { toast } from '../components/toast.js'
import { showContentModal, showConfirm } from '../components/modal.js'
import { t } from '../lib/i18n.js'

/** MCP Server 模板库 — 常见工具的开箱即用配置 */
const MCP_TEMPLATES = [
  {
    id: 'filesystem',
    label: 'Filesystem',
    desc: '读写指定目录下的文件(需给出 allowlist 路径)',
    server: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/dir'],
      env: {},
    },
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'github',
    label: 'GitHub',
    desc: '读写 GitHub issues、PR、仓库文件(需 Personal Access Token)',
    server: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    },
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
  },
  {
    id: 'fetch',
    label: 'Fetch',
    desc: '抓取 Web 页面内容并转 Markdown',
    server: {
      command: 'uvx',
      args: ['mcp-server-fetch'],
      env: {},
    },
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    id: 'memory',
    label: 'Memory (Knowledge Graph)',
    desc: '跨会话持久化知识图谱(长期记忆)',
    server: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      env: {},
    },
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    id: 'sqlite',
    label: 'SQLite',
    desc: '对指定 SQLite 数据库文件做查询/写入',
    server: {
      command: 'uvx',
      args: ['mcp-server-sqlite', '--db-path', '/path/to/database.db'],
      env: {},
    },
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
  },
  {
    id: 'puppeteer',
    label: 'Puppeteer',
    desc: '浏览器自动化(截图、点击、表单填写)',
    server: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
      env: {},
    },
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
  },
]

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="apple-section">${t('pages.mcp.title')}</h1>
        <p class="apple-body-secondary">${t('pages.mcp.page_desc')}</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" id="btn-mcp-from-template">${t('pages.mcp.btn_from_template')}</button>
        <button class="btn btn-pill-filled" id="btn-mcp-new">${t('pages.mcp.btn_new')}</button>
      </div>
    </div>
    <div class="page-content">
      <div class="mcp-info apple-card">
        <div class="mcp-info-icon">🔗</div>
        <div>
          <div class="mcp-info-title">${t('pages.mcp.info_title')}</div>
          <div class="apple-body-secondary">${t('pages.mcp.info_desc')}</div>
        </div>
      </div>
      <div id="mcp-list-container">
        <div class="mcp-loading">${t('common.loading')}</div>
      </div>
    </div>
  `

  const state = { config: { mcpServers: {} } }
  loadMcpConfig(page, state)

  page.querySelector('#btn-mcp-new').addEventListener('click', () => openServerEditor(page, state, null))
  page.querySelector('#btn-mcp-from-template').addEventListener('click', () => openTemplatePicker(page, state))

  return page
}

async function loadMcpConfig(page, state) {
  const container = page.querySelector('#mcp-list-container')
  container.innerHTML = `<div class="mcp-loading">${t('common.loading')}</div>`

  try {
    const raw = await api.readMcpConfig()
    const config = normalizeConfig(raw)
    state.config = config
    renderMcpList(page, state)
  } catch (e) {
    container.innerHTML = `<div class="mcp-empty">${t('pages.mcp.load_failed', { error: String(e) })}</div>`
    toast(t('pages.mcp.load_failed', { error: String(e) }), 'error')
  }
}

function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return { mcpServers: {} }
  if (!raw.mcpServers || typeof raw.mcpServers !== 'object') {
    return { ...raw, mcpServers: {} }
  }
  return raw
}

function renderMcpList(page, state) {
  const container = page.querySelector('#mcp-list-container')
  const servers = state.config.mcpServers || {}
  const names = Object.keys(servers)

  if (!names.length) {
    container.innerHTML = `
      <div class="mcp-empty-guide apple-card">
        <div class="mcp-empty-icon">🔌</div>
        <div class="mcp-empty-title">${t('pages.mcp.empty_title')}</div>
        <div class="mcp-empty-desc apple-body-secondary">${t('pages.mcp.empty_desc')}</div>
        <div class="mcp-empty-actions">
          <button class="btn btn-pill-filled btn-sm" id="btn-mcp-empty-template">${t('pages.mcp.btn_from_template')}</button>
        </div>
      </div>
    `
    container.querySelector('#btn-mcp-empty-template').addEventListener('click', () => openTemplatePicker(page, state))
    return
  }

  container.innerHTML = `
    <div class="mcp-grid">
      ${names.map(name => renderServerCard(name, servers[name])).join('')}
    </div>
  `

  container.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => openServerEditor(page, state, btn.dataset.name))
  })
  container.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => deleteServer(page, state, btn.dataset.name))
  })
  container.querySelectorAll('[data-action="toggle"]').forEach(cb => {
    cb.addEventListener('change', () => toggleServer(page, state, cb.dataset.name, cb.checked))
  })
}

function renderServerCard(name, server) {
  const disabled = server?.disabled === true
  const command = server?.command || ''
  const args = Array.isArray(server?.args) ? server.args : []
  const env = server?.env && typeof server.env === 'object' ? server.env : {}
  const envKeys = Object.keys(env)
  const envHtml = envKeys.length
    ? `<div class="mcp-server-env">${envKeys.map(k => `<code>${escapeHtml(k)}</code>`).join(' ')}</div>`
    : ''
  const cmdText = `${command} ${args.join(' ')}`.trim()

  return `
    <div class="mcp-server-card ${disabled ? 'is-disabled' : ''}" data-name="${escapeAttr(name)}">
      <div class="mcp-server-head">
        <strong class="mcp-server-name">${escapeHtml(name)}</strong>
        <label class="mcp-toggle" title="${t('pages.mcp.toggle_hint')}">
          <input type="checkbox" data-action="toggle" data-name="${escapeAttr(name)}" ${disabled ? '' : 'checked'}>
          <span class="mcp-toggle-label">${disabled ? t('common.disabled') : t('common.enabled')}</span>
        </label>
      </div>
      <div class="mcp-server-cmd" title="${escapeAttr(cmdText)}">${escapeHtml(truncate(cmdText, 180))}</div>
      ${envHtml}
      <div class="mcp-server-actions">
        <button class="btn btn-secondary btn-sm" data-action="edit" data-name="${escapeAttr(name)}">${t('common.edit')}</button>
        <button class="btn btn-danger btn-sm" data-action="delete" data-name="${escapeAttr(name)}">${t('common.delete')}</button>
      </div>
    </div>
  `
}

function openTemplatePicker(page, state) {
  const content = `
    <div class="mcp-template-grid">
      ${MCP_TEMPLATES.map(tpl => `
        <div class="mcp-template-card" data-tpl-id="${escapeAttr(tpl.id)}">
          <div class="mcp-template-name">${escapeHtml(tpl.label)}</div>
          <div class="mcp-template-desc">${escapeHtml(tpl.desc)}</div>
          <div class="mcp-template-cmd"><code>${escapeHtml(tpl.server.command)} ${escapeHtml(tpl.server.args.slice(0, 2).join(' '))}…</code></div>
          <button class="btn btn-pill-filled btn-sm" data-pick="${escapeAttr(tpl.id)}">${t('pages.mcp.btn_use_template')}</button>
        </div>
      `).join('')}
    </div>
  `
  const overlay = showContentModal({
    title: t('pages.mcp.template_picker_title'),
    content,
    buttons: [],
    width: 680,
  })
  overlay.querySelectorAll('[data-pick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tpl = MCP_TEMPLATES.find(x => x.id === btn.dataset.pick)
      overlay.close()
      if (tpl) openServerEditor(page, state, null, {
        name: tpl.id,
        server: JSON.parse(JSON.stringify(tpl.server)),
      })
    })
  })
}

function openServerEditor(page, state, existingName, prefill = null) {
  const isNew = !existingName
  const source = existingName
    ? { name: existingName, server: state.config.mcpServers[existingName] || {} }
    : (prefill || { name: '', server: { command: '', args: [], env: {} } })

  const serverJson = JSON.stringify(source.server || {}, null, 2)

  const content = `
    <div class="form-group">
      <label class="form-label">${t('pages.mcp.field_name')}</label>
      <input class="form-input" id="mcp-field-name" value="${escapeAttr(source.name)}" placeholder="${t('pages.mcp.field_name_placeholder')}" ${isNew ? '' : 'readonly style="opacity:0.6;cursor:not-allowed"'}>
      <div class="form-hint">${t('pages.mcp.field_name_hint')}</div>
    </div>
    <div class="form-group">
      <label class="form-label">${t('pages.mcp.field_json')}</label>
      <textarea class="form-input mcp-json-editor" id="mcp-field-json" spellcheck="false" rows="12">${escapeHtml(serverJson)}</textarea>
      <div class="form-hint">${t('pages.mcp.field_json_hint')}</div>
    </div>
  `

  const overlay = showContentModal({
    title: isNew ? t('pages.mcp.editor_title_new') : t('pages.mcp.editor_title_edit', { name: source.name }),
    content,
    buttons: [{
      label: t('common.save'),
      className: 'btn btn-primary btn-sm',
      id: 'btn-mcp-save',
    }],
    width: 640,
  })

  overlay.querySelector('#btn-mcp-save').addEventListener('click', async () => {
    const name = overlay.querySelector('#mcp-field-name').value.trim()
    const jsonText = overlay.querySelector('#mcp-field-json').value

    if (!name) {
      toast(t('pages.mcp.err_name_required'), 'warning')
      return
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      toast(t('pages.mcp.err_name_format'), 'warning')
      return
    }

    let parsed
    try {
      parsed = JSON.parse(jsonText)
    } catch (e) {
      toast(t('pages.mcp.err_json_parse', { error: String(e) }), 'error')
      return
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      toast(t('pages.mcp.err_json_shape'), 'error')
      return
    }
    if (typeof parsed.command !== 'string' || !parsed.command) {
      toast(t('pages.mcp.err_command_required'), 'error')
      return
    }

    // 写回配置
    const newConfig = {
      ...state.config,
      mcpServers: { ...(state.config.mcpServers || {}) },
    }
    if (!isNew && name !== source.name) {
      delete newConfig.mcpServers[source.name]
    }
    newConfig.mcpServers[name] = parsed

    try {
      await api.writeMcpConfig(newConfig)
      invalidate('read_mcp_config')
      state.config = newConfig
      renderMcpList(page, state)
      overlay.close()
      toast(t('pages.mcp.save_success'), 'success')
    } catch (e) {
      toast(t('pages.mcp.save_failed', { error: String(e) }), 'error')
    }
  })
}

async function toggleServer(page, state, name, enabled) {
  const server = state.config.mcpServers?.[name]
  if (!server) return
  const newServer = { ...server }
  if (enabled) {
    delete newServer.disabled
  } else {
    newServer.disabled = true
  }
  const newConfig = {
    ...state.config,
    mcpServers: { ...state.config.mcpServers, [name]: newServer },
  }
  try {
    await api.writeMcpConfig(newConfig)
    invalidate('read_mcp_config')
    state.config = newConfig
    renderMcpList(page, state)
    toast(enabled ? t('pages.mcp.toggle_enabled', { name }) : t('pages.mcp.toggle_disabled', { name }), 'success')
  } catch (e) {
    toast(t('pages.mcp.save_failed', { error: String(e) }), 'error')
    // 回滚 UI
    renderMcpList(page, state)
  }
}

async function deleteServer(page, state, name) {
  const yes = await showConfirm(t('pages.mcp.delete_confirm', { name }))
  if (!yes) return
  const newConfig = {
    ...state.config,
    mcpServers: { ...state.config.mcpServers },
  }
  delete newConfig.mcpServers[name]
  try {
    await api.writeMcpConfig(newConfig)
    invalidate('read_mcp_config')
    state.config = newConfig
    renderMcpList(page, state)
    toast(t('pages.mcp.delete_success', { name }), 'success')
  } catch (e) {
    toast(t('pages.mcp.save_failed', { error: String(e) }), 'error')
  }
}

// escapeHtml / escapeAttr / truncate 从 src/lib/escape.js 共享导入(顶部 import)

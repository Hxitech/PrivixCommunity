/**
 * Agent 管理页面
 * Agent 增删改查 + 身份编辑
 */
import { api, invalidate } from '../lib/tauri-api.js'
import { escapeHtml, escapeAttr } from '../lib/escape.js'
import { toast } from '../components/toast.js'
import { showModal, showConfirm } from '../components/modal.js'
import { openAgentConfigWizard } from '../components/agent-config-wizard.js'
import { openAgentConfigConversation, openAgentTemplateCreator } from '../components/agent-config-conversation.js'
import { emptyStateHTML, EMPTY_STATES } from '../components/empty-state-guide.js'
import { t } from '../lib/i18n.js'

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="apple-section">${t('pages.agents.title')}</h1>
        <p class="apple-body-secondary">${t('pages.agents.page_desc')}</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-pill-filled" id="btn-chat-add-agent">${t('pages.agents.btn_chat_add')}</button>
        <button class="btn btn-secondary" id="btn-template-add-agent">${t('pages.agents.btn_template_add')}</button>
        <button class="btn btn-secondary" id="btn-advanced-add-agent">${t('pages.agents.btn_advanced_add')}</button>
        <button class="btn btn-pill-filled" id="btn-add-agent">${t('pages.agents.btn_add')}</button>
      </div>
    </div>
    <div class="page-content">
      <section class="cli-agents-section" id="cli-agents-section">
        <div class="cli-agents-header">
          <div>
            <h2 class="apple-card-title">${t('pages.agents.cli_detect_title')}</h2>
            <p class="apple-body-secondary">${t('pages.agents.cli_detect_desc')}</p>
          </div>
          <button class="btn btn-pill-filled btn-sm" id="btn-scan-cli-agents">${t('pages.agents.cli_detect_scan_btn')}</button>
        </div>
        <div class="cli-agents-summary" id="cli-agents-summary"></div>
        <div class="cli-agents-grid" id="cli-agents-grid">
          <div class="cli-agents-loading">${t('pages.agents.cli_detect_loading')}</div>
        </div>
      </section>
      <div id="agents-list"></div>
    </div>
  `

  const state = { agents: [], cliAgents: [] }
  // 非阻塞：先返回 DOM，后台加载数据
  loadAgents(page, state)
  loadCliAgents(page, state)

  page.querySelector('#btn-chat-add-agent').addEventListener('click', () => openAgentConversation(page, state, null, 'create'))
  page.querySelector('#btn-template-add-agent').addEventListener('click', () => openTemplateCreator(page, state))
  page.querySelector('#btn-advanced-add-agent').addEventListener('click', () => openAdvancedWizard(page, state, null, 'create'))
  page.querySelector('#btn-add-agent').addEventListener('click', () => showAddAgentDialog(page, state))
  page.querySelector('#btn-scan-cli-agents').addEventListener('click', () => loadCliAgents(page, state, /*force*/ true))


  return page
}

/**
 * 加载 CLI Agent 检测结果(Agent Studio 入口)
 * 扫描本机安装的 Claude/Codex/Qwen/Gemini 等 CLI,展示版本与安装指引
 */
async function loadCliAgents(page, state, force = false) {
  const grid = page.querySelector('#cli-agents-grid')
  const summary = page.querySelector('#cli-agents-summary')
  const scanBtn = page.querySelector('#btn-scan-cli-agents')
  if (!grid) return

  if (force) {
    // 强制扫描时清空缓存
    invalidate('detect_agents')
  }

  grid.innerHTML = `<div class="cli-agents-loading">${t('pages.agents.cli_detect_loading')}</div>`
  if (summary) summary.textContent = ''
  if (scanBtn) {
    scanBtn.disabled = true
    scanBtn.textContent = t('pages.agents.cli_detect_scanning')
  }

  try {
    const list = await api.detectAgents()
    state.cliAgents = Array.isArray(list) ? list : []
    renderCliAgents(page, state)
  } catch (e) {
    grid.innerHTML = `<div class="cli-agents-empty">${t('pages.agents.cli_detect_failed', { error: String(e) })}</div>`
    toast(t('pages.agents.cli_detect_failed', { error: String(e) }), 'error')
  } finally {
    if (scanBtn) {
      scanBtn.disabled = false
      scanBtn.textContent = t('pages.agents.cli_detect_scan_btn')
    }
  }
}

function renderCliAgents(page, state) {
  const grid = page.querySelector('#cli-agents-grid')
  const summary = page.querySelector('#cli-agents-summary')
  if (!grid) return

  const list = state.cliAgents || []
  if (!list.length) {
    grid.innerHTML = `<div class="cli-agents-empty">${t('pages.agents.cli_detect_empty')}</div>`
    if (summary) summary.textContent = ''
    return
  }

  const installedCount = list.filter(a => a.installed).length
  if (summary) {
    summary.textContent = t('pages.agents.cli_detect_summary', {
      installed: installedCount,
      total: list.length,
    })
  }

  grid.innerHTML = list.map(agent => {
    const statusClass = agent.installed ? 'installed' : 'not-installed'
    const badgeClass = agent.installed ? 'ok' : 'missing'
    const badgeText = agent.installed
      ? t('pages.agents.cli_detect_status_installed')
      : t('pages.agents.cli_detect_status_missing')
    const versionHtml = agent.installed
      ? `<div class="cli-agent-version">${escapeHtml(agent.version || t('pages.agents.cli_detect_version_unknown'))}</div>`
      : ''
    const pathHtml = agent.installed && agent.path
      ? `<div class="cli-agent-path" title="${escapeHtml(agent.path)}">${escapeHtml(agent.path)}</div>`
      : ''
    const installHtml = !agent.installed && agent.installUrl
      ? `<a href="${escapeAttr(agent.installUrl)}" target="_blank" rel="noopener" class="apple-link cli-agent-install">${t('pages.agents.cli_detect_install_guide')} →</a>`
      : ''
    return `
      <div class="cli-agent-card ${statusClass}" data-id="${escapeAttr(agent.id)}">
        <div class="cli-agent-head">
          <span class="cli-agent-name">${escapeHtml(agent.label)}</span>
          <span class="cli-agent-badge ${badgeClass}">${badgeText}</span>
        </div>
        <div class="cli-agent-desc">${escapeHtml(agent.description || '')}</div>
        ${versionHtml}
        ${pathHtml}
        ${installHtml}
      </div>
    `
  }).join('')
}

// escapeHtml / escapeAttr 从 src/lib/escape.js 共享导入(顶部 import)

function renderSkeleton(container) {
  const item = () => `
    <div class="agent-card" style="pointer-events:none">
      <div class="agent-card-header">
        <div class="skeleton" style="width:40px;height:40px;border-radius:50%"></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px">
          <div class="skeleton" style="width:45%;height:16px;border-radius:4px"></div>
          <div class="skeleton" style="width:60%;height:12px;border-radius:4px"></div>
        </div>
      </div>
    </div>`
  container.innerHTML = [item(), item(), item()].join('')
}

async function loadAgents(page, state) {
  const container = page.querySelector('#agents-list')
  renderSkeleton(container)
  try {
    state.agents = await api.listAgents()
    renderAgents(page, state)

    // 只在第一次加载时绑定事件（避免重复绑定）
    if (!state.eventsAttached) {
      attachAgentEvents(page, state)
      state.eventsAttached = true
    }
  } catch (e) {
    container.innerHTML = '<div style="color:var(--error);padding:20px">' + t('pages.agents.load_failed', { error: String(e) }) + '</div>'
    toast(t('pages.agents.list_load_failed', { error: String(e) }), 'error')
  }
}

function renderAgents(page, state) {
  const container = page.querySelector('#agents-list')
  if (!state.agents.length) {
    container.innerHTML = emptyStateHTML({
      ...EMPTY_STATES.agentsEmpty,
      compact: true,
    })
    container.querySelector('.empty-state-guide-cta')?.addEventListener('click', () => openAgentConversation(page, state, null, 'create'))
    container.querySelector('.empty-state-guide-secondary')?.addEventListener('click', () => openAdvancedWizard(page, state, null, 'create'))
    return
  }

  container.innerHTML = state.agents.map(a => {
    const isDefault = a.isDefault || a.id === 'main'
    const name = a.identityName ? a.identityName.split(',')[0].trim() : '无描述'
    return `
      <div class="agent-card" data-id="${a.id}">
        <div class="agent-card-header">
          <div class="agent-card-title">
            <span class="agent-id">${a.id}</span>
            ${isDefault ? `<span class="badge badge-success">${t('common.default')}</span>` : ''}
          </div>
          <div class="agent-card-actions">
            <button class="btn btn-sm btn-secondary" data-action="chat-config" data-id="${a.id}">聊天调整</button>
            <button class="btn btn-sm btn-secondary" data-action="advanced-config" data-id="${a.id}">高级向导</button>
            <button class="btn btn-sm btn-secondary" data-action="backup" data-id="${a.id}">备份</button>
            <button class="btn btn-sm btn-secondary" data-action="edit" data-id="${a.id}">${t('common.edit')}</button>
            ${!isDefault ? `<button class="btn btn-sm btn-danger" data-action="delete" data-id="${a.id}">${t('common.delete')}</button>` : ''}
          </div>
        </div>
        <div class="agent-card-body">
          <div class="agent-info-row">
            <span class="agent-info-label">名称:</span>
            <span class="agent-info-value">${name}</span>
          </div>
          <div class="agent-info-row">
            <span class="agent-info-label">${t('pages.agents.card_model')}:</span>
            <span class="agent-info-value">${a.model || '未设置'}</span>
          </div>
          <div class="agent-info-row">
            <span class="agent-info-label">工作区:</span>
            <span class="agent-info-value" style="font-family:var(--font-mono);font-size:var(--font-size-xs)">${a.workspace || '未设置'}</span>
          </div>
        </div>
      </div>
    `
  }).join('')
}

function attachAgentEvents(page, state) {
  const container = page.querySelector('#agents-list')
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    const id = btn.dataset.id

    if (action === 'edit') showEditAgentDialog(page, state, id)
    else if (action === 'chat-config') openAgentConversation(page, state, id, 'configure')
    else if (action === 'advanced-config') openAdvancedWizard(page, state, id, 'configure')
    else if (action === 'delete') await deleteAgent(page, state, id)
    else if (action === 'backup') await backupAgent(id)
  })
}

async function openAgentConversation(page, state, id, mode) {
  const agent = id ? state.agents.find(item => item.id === id) : null
  if (mode === 'configure' && agent) {
    const proceed = await showConfirm(
      `该功能会读取 Agent「${agent.id}」的现有 workspace 规则，并在聊天里整理新的写入摘要。\n\n建议你先手动点击右侧「备份」按钮保存当前状态。\n\n确认后再进入聊天调整。是否继续？`
    )
    if (!proceed) return
  }
  await openAgentConfigConversation({
    mode,
    agent,
    availableAgents: state.agents,
    onApplied: async () => {
      invalidate('list_agents')
      await loadAgents(page, state)
    },
  })
}

async function openAdvancedWizard(page, state, id, mode) {
  const agent = id ? state.agents.find(item => item.id === id) : null
  if (mode === 'configure' && agent) {
    const proceed = await showConfirm(
      `高级向导会读取 Agent「${agent.id}」的现有规则并生成一版写入摘要。\n\n建议你先手动点击右侧「备份」按钮保存当前状态。\n\n确认后才会进入高级向导。是否继续？`
    )
    if (!proceed) return
  }
  await openAgentConfigWizard({
    mode,
    allowedModes: [mode],
    agent,
    availableAgents: state.agents,
    onApplied: async () => {
      invalidate('list_agents')
      await loadAgents(page, state)
    },
  })
}

async function openTemplateCreator(page, state) {
  await openAgentTemplateCreator({
    availableAgents: state.agents,
    onApplied: async () => {
      invalidate('list_agents')
      await loadAgents(page, state)
    },
  })
}

async function showAddAgentDialog(page, state) {
  // 获取模型列表
  let models = []
  try {
    const config = await api.readOpenclawConfig()
    const providers = config?.models?.providers || {}
    for (const [pk, pv] of Object.entries(providers)) {
      for (const m of (pv.models || [])) {
        const id = typeof m === 'string' ? m : m.id
        if (id) models.push({ value: `${pk}/${id}`, label: `${pk}/${id}` })
      }
    }
  } catch { models = [{ value: 'newapi/claude-opus-4-6', label: 'newapi/claude-opus-4-6' }] }

  if (!models.length) {
    toast('请先在模型配置页面添加模型', 'warning')
    return
  }

  showModal({
    title: '新建 Agent',
    fields: [
      { name: 'id', label: 'Agent ID', value: '', placeholder: '例如：translator（小写字母、数字、下划线、连字符）' },
      { name: 'name', label: '名称', value: '', placeholder: '例如：翻译助手' },
      { name: 'emoji', label: 'Emoji', value: '', placeholder: '例如：🌐（可选）' },
      { name: 'model', label: t('pages.agents.card_model'), type: 'select', value: models[0]?.value || '', options: models },
      { name: 'workspace', label: '工作区路径', value: '', placeholder: '留空则自动创建（可选，绝对路径）' },
    ],
    onConfirm: async (result) => {
      const id = (result.id || '').trim()
      if (!id) { toast('请输入 Agent ID', 'warning'); return }
      if (!/^[a-z0-9_-]+$/.test(id)) { toast('Agent ID 只能包含小写字母、数字、下划线和连字符', 'warning'); return }

      const name = (result.name || '').trim()
      const emoji = (result.emoji || '').trim()
      const model = result.model || models[0]?.value || ''
      const workspace = (result.workspace || '').trim()

      try {
        await api.addAgent(id, model, workspace || null)
        if (name || emoji) {
          await api.updateAgentIdentity(id, name || null, emoji || null)
        }
        toast('Agent 已创建', 'success')

        // 强制清除缓存并重新加载
        invalidate('list_agents')
        await loadAgents(page, state)
      } catch (e) {
        toast('创建失败: ' + e, 'error')
      }
    }
  })
}

async function showEditAgentDialog(page, state, id) {
  const agent = state.agents.find(a => a.id === id)
  if (!agent) return

  const name = agent.identityName ? agent.identityName.split(',')[0].trim() : ''

  // 获取模型列表
  let models = []
  try {
    const config = await api.readOpenclawConfig()
    const providers = config?.models?.providers || {}
    for (const [pk, pv] of Object.entries(providers)) {
      for (const m of (pv.models || [])) {
        const mid = typeof m === 'string' ? m : m.id
        if (mid) models.push({ value: `${pk}/${mid}`, label: `${pk}/${mid}` })
      }
    }
    console.log('[Agent编辑] 获取到模型列表:', models.length, '个')
  } catch (e) {
    console.error('[Agent编辑] 获取模型列表失败:', e)
  }

  const fields = [
    { name: 'name', label: '名称', value: name, placeholder: '例如：翻译助手' },
    { name: 'emoji', label: 'Emoji', value: agent.identityEmoji || '', placeholder: '例如：🌐' },
  ]

  if (models.length) {
    const modelField = {
      name: 'model', label: t('pages.agents.card_model'), type: 'select',
      value: agent.model || models[0]?.value || '',
      options: models,
    }
    fields.push(modelField)
    console.log('[Agent编辑] 当前模型:', agent.model)
    console.log('[Agent编辑] 模型选项:', models)
  } else {
    console.warn('[Agent编辑] 模型列表为空，不显示模型选择器')
  }

  fields.push({
    name: 'workspace', label: '工作区',
    value: agent.workspace || '未设置',
    placeholder: '创建时指定，不可修改',
    readonly: true,
  })

  showModal({
    title: `编辑 Agent — ${id}`,
    fields,
    onConfirm: async (result) => {
      console.log('[Agent编辑] 保存数据:', result)
      const newName = (result.name || '').trim()
      const emoji = (result.emoji || '').trim()
      const model = (result.model || '').trim()

      try {
        if (newName || emoji) {
          console.log('[Agent编辑] 更新身份信息...')
          await api.updateAgentIdentity(id, newName || null, emoji || null)
        }
        if (model && model !== agent.model) {
          console.log('[Agent编辑] 更新模型:', agent.model, '->', model)
          await api.updateAgentModel(id, model)
        }

        // 手动更新 state 并重新渲染，确保立即生效
        if (newName) agent.identityName = newName
        if (emoji) agent.identityEmoji = emoji
        if (model) agent.model = model
        renderAgents(page, state)

        toast('已更新', 'success')
      } catch (e) {
        console.error('[Agent编辑] 保存失败:', e)
        toast('更新失败: ' + e, 'error')
      }
    }
  })
}

async function deleteAgent(page, state, id) {
  const yes = await showConfirm(t('pages.agents.delete_confirm', { name: id }))
  if (!yes) return

  try {
    await api.deleteAgent(id)
    toast(t('pages.agents.delete_success'), 'success')
    await loadAgents(page, state)
  } catch (e) {
    toast(t('pages.agents.delete_failed', { error: String(e) }), 'error')
  }
}

async function backupAgent(id) {
  toast(`正在备份 Agent「${id}」...`, 'info')
  try {
    const zipPath = await api.backupAgent(id)
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      const dir = zipPath.substring(0, zipPath.lastIndexOf('/')) || zipPath
      await open(dir)
    } catch { /* fallback */ }
    toast(`备份完成: ${zipPath.split('/').pop()}`, 'success')
  } catch (e) {
    toast('备份失败: ' + e, 'error')
  }
}

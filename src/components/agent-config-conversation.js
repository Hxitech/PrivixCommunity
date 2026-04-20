import { api } from '../lib/tauri-api.js'
import { t } from '../lib/i18n.js'
import { toast } from './toast.js'
import {
  AGENT_CONFIG_PANEL_KEY,
  SOURCE_SCOPE_OPTIONS,
  createDefaultCreateSpec,
  buildCreateSpecPayload,
  resolveCreateWorkspaceDisplayPath,
  mergeCreateDraftIntoState,
  mergeQuestionnaireAnswers,
  buildAnalysisPrompts,
  buildDraftPromptPrefillPrompts,
  buildConfigureConversationPrompts,
  buildGenerationPrompts,
  compactQuestionnairePatchForMerge,
  normalizeAdaptiveQuestions,
  buildPreviewTargetsFromGeneration,
  buildCreateModePreviewTargets,
  buildWriteSummaryFromPreviewTargets,
  normalizeGenerationOutput,
  resolveScenarioLabel,
} from '../lib/agent-config.js'
import {
  listAgentTemplates,
  buildAgentTemplateTargets,
  buildTemplateSkillStatus,
  buildTemplateWriteSummary,
} from '../lib/agent-templates.js'
import {
  loadAssistantProviderConfig,
  assessAssistantModelQuality,
  runStructuredAssistantTask,
} from '../lib/assistant-provider.js'
import {
  createSession as createRuntimeSession,
  attachView as attachRuntimeView,
  detachView as detachRuntimeView,
  setSessionHandlers,
  updateSessionSnapshot,
  send as sendRuntimeMessage,
} from '../lib/assistant-runtime.js'

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatTime(ts) {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

async function readPrefs() {
  try {
    const cfg = await api.readPanelConfig()
    return cfg?.assistant?.[AGENT_CONFIG_PANEL_KEY] || {}
  } catch {
    return {}
  }
}

async function writePrefs(patch) {
  try {
    const cfg = await api.readPanelConfig().catch(() => ({}))
    if (!cfg.assistant) cfg.assistant = {}
    const current = cfg.assistant[AGENT_CONFIG_PANEL_KEY] || {}
    cfg.assistant[AGENT_CONFIG_PANEL_KEY] = { ...current, ...patch }
    await api.writePanelConfig(cfg)
  } catch (error) {
    console.warn('[agent-config-conversation] persist prefs failed', error)
  }
}

async function loadModelOptions() {
  try {
    const config = await api.readOpenclawConfig()
    const providers = config?.models?.providers || {}
    const models = []
    for (const [providerId, providerValue] of Object.entries(providers)) {
      for (const model of providerValue?.models || []) {
        const id = typeof model === 'string' ? model : model?.id
        if (!id) continue
        models.push(`${providerId}/${id}`)
      }
    }
    return models
  } catch {
    return []
  }
}

function sourceScopeLabel(value) {
  return SOURCE_SCOPE_OPTIONS.find(item => item.value === value)?.label || value
}

function buildMessageId(prefix = 'agent-config-msg') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function buildRunId(prefix = 'agent-config-run') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function createActivityEntry({ phase, title, summary = '', detail = '', status = 'running' }) {
  return {
    id: buildMessageId('agent-config-activity'),
    phase,
    title,
    summary,
    detail,
    status,
    timestamp: Date.now(),
  }
}

function wantsSubAgent(value) {
  return String(value || '').includes('需要一个专职子 Agent')
}

function validateCreateSpec(state) {
  const payload = buildCreateSpecPayload(state.createSpec)
  if (!payload.agentId) return t('comp_agent_conversation.validate_missing_id')
  if (!/^[a-z0-9_-]+$/.test(payload.agentId)) return t('comp_agent_conversation.validate_invalid_id')
  if (!payload.name) return t('comp_agent_conversation.validate_missing_name')
  if (payload.workspaceMode === 'custom' && !payload.workspace) return t('comp_agent_conversation.validate_custom_workspace')
  if (Array.isArray(state.availableAgents) && state.availableAgents.some(item => item.id === payload.agentId)) {
    return `Agent ID「${payload.agentId}」已存在，请换一个新的 ID。`
  }
  if (payload.agentId && state.parentAgentId && payload.agentId === state.parentAgentId) {
    return '父 Agent 不能和新 Agent 使用同一个 ID。'
  }
  return ''
}

function mergeConversationNotes(state) {
  const notes = [...(state.userNotes || [])].filter(Boolean)
  const base = String(state.answers?.customNotes || '').trim()
  if (!notes.length) return base
  const joined = notes.map((item, index) => `${index + 1}. ${item}`).join('\n')
  return base
    ? `${base}\n\n聊天补充要求：\n${joined}`
    : `聊天补充要求：\n${joined}`
}

function buildWriteSummaryMarkup(summary = {}) {
  if (!summary?.targets?.length) return '<div class="agent-config-chat-empty">生成完成后会在这里显示写入摘要。</div>'
  return `
    <div class="agent-config-chat-summary-grid">
      <div class="agent-config-chat-stat-card">
        <span>涉及文件</span>
        <strong>${summary.totalFiles || 0}</strong>
      </div>
      <div class="agent-config-chat-stat-card">
        <span>新建</span>
        <strong>${summary.createdFiles || 0}</strong>
      </div>
      <div class="agent-config-chat-stat-card">
        <span>更新</span>
        <strong>${summary.updatedFiles || 0}</strong>
      </div>
    </div>
    ${summary.targets.map(target => `
      <div class="agent-config-chat-target-card">
        <div class="agent-config-chat-target-head">
          <div>
            <div class="agent-config-chat-target-title">${escapeHtml(target.label || 'Agent')}</div>
            <div class="agent-config-chat-target-path">${escapeHtml(target.workspace || '')}</div>
          </div>
          <div class="agent-config-chat-target-badge">${target.exists ? t('comp_agent_conversation.summary_overwrite') : t('comp_agent_conversation.summary_create_new')}</div>
        </div>
        <div class="agent-config-chat-file-list">
          ${target.fileChanges.map(file => `
            <div class="agent-config-chat-file-row">
              <span>${escapeHtml(file.name)}</span>
              <span class="agent-config-chat-file-status status-${escapeHtml(file.status)}">${escapeHtml(file.status)}</span>
              <small>${escapeHtml(file.summary || t('comp_agent_conversation.summary_file_default'))}</small>
            </div>
          `).join('')}
        </div>
        ${target.backupFiles?.length ? `<div class="agent-config-chat-note">写入前会先备份：${escapeHtml(target.backupFiles.join(', '))}</div>` : ''}
      </div>
    `).join('')}
    ${summary.backupRoot ? `<div class="agent-config-chat-note">备份目录：${escapeHtml(summary.backupRoot)}</div>` : ''}
  `
}

function renderMessages(messages = []) {
  if (!messages.length) {
    return '<div class="agent-config-chat-empty">这里会按对话方式记录你的需求、AI 的理解以及生成进度。</div>'
  }
  return messages.map(message => `
    <div class="agent-config-chat-bubble role-${escapeHtml(message.role)}">
      <div class="agent-config-chat-bubble-meta">
        <span>${message.role === 'assistant' ? t('comp_agent_conversation.role_assistant') : t('comp_agent_conversation.role_user')}</span>
        <span>${escapeHtml(formatTime(message.timestamp))}</span>
      </div>
      <div class="agent-config-chat-bubble-body">${escapeHtml(message.text || '')}</div>
    </div>
  `).join('')
}

function ensureStyles() {
  if (document.getElementById('agent-config-conversation-styles')) return
  const style = document.createElement('style')
  style.id = 'agent-config-conversation-styles'
  style.textContent = `
    .agent-config-chat { position:fixed; inset:0; z-index:1400; }
    .agent-config-chat-backdrop { position:absolute; inset:0; background:rgba(15,23,42,0.46); backdrop-filter:blur(2px); }
    .agent-config-chat-panel { position:absolute; top:0; right:0; width:min(720px, calc(100vw - 24px)); height:100%; background:var(--bg-primary); border-left:1px solid var(--border-primary); box-shadow:var(--shadow-lg); display:flex; flex-direction:column; }
    .agent-config-chat-header { padding:18px 20px 12px; border-bottom:1px solid var(--border-primary); display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
    .agent-config-chat-title { font-size:18px; font-weight:700; color:var(--text-primary); }
    .agent-config-chat-subtitle { font-size:12px; color:var(--text-tertiary); line-height:1.6; margin-top:4px; }
    .agent-config-chat-body { flex:1; min-height:0; overflow:auto; padding:16px 20px 20px; display:flex; flex-direction:column; gap:14px; }
    .agent-config-chat-card { background:var(--bg-secondary); border:1px solid var(--border-primary); border-radius:14px; padding:14px; }
    .agent-config-chat-card-title { font-size:13px; font-weight:700; color:var(--text-primary); margin-bottom:10px; }
    .agent-config-chat-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:12px; }
    .agent-config-chat-grid.three { grid-template-columns:repeat(3, minmax(0, 1fr)); }
    .agent-config-chat-field label { display:block; font-size:12px; color:var(--text-tertiary); margin-bottom:6px; }
    .agent-config-chat-field .form-input { width:100%; }
    .agent-config-chat-note { font-size:12px; color:var(--text-tertiary); line-height:1.6; margin-top:8px; }
    .agent-config-chat-analysis { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; }
    .agent-config-chat-analysis-item { display:flex; flex-direction:column; gap:4px; }
    .agent-config-chat-analysis-item span { font-size:12px; color:var(--text-tertiary); }
    .agent-config-chat-analysis-item strong { color:var(--text-primary); line-height:1.5; }
    .agent-config-chat-activity { display:flex; flex-direction:column; gap:10px; }
    .agent-config-chat-activity-item { border:1px solid var(--border-primary); border-radius:12px; padding:12px; background:var(--bg-primary); }
    .agent-config-chat-activity-item.status-running { border-color:color-mix(in srgb, var(--accent) 24%, var(--border-primary)); }
    .agent-config-chat-activity-item.status-done { border-color:color-mix(in srgb, var(--success) 24%, var(--border-primary)); }
    .agent-config-chat-activity-item.status-error { border-color:color-mix(in srgb, var(--error) 28%, var(--border-primary)); }
    .agent-config-chat-activity-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
    .agent-config-chat-activity-title { font-weight:600; color:var(--text-primary); }
    .agent-config-chat-activity-meta { font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.04em; }
    .agent-config-chat-activity-summary { margin-top:6px; color:var(--text-secondary); line-height:1.6; }
    .agent-config-chat-activity-item pre { margin:8px 0 0; white-space:pre-wrap; word-break:break-word; background:var(--bg-secondary); border-radius:10px; padding:10px; font-size:12px; line-height:1.6; }
    .agent-config-chat-empty { padding:20px; border:1px dashed var(--border-primary); border-radius:12px; color:var(--text-tertiary); text-align:center; }
    .agent-config-chat-messages { display:flex; flex-direction:column; gap:12px; }
    .agent-config-chat-bubble { border-radius:14px; padding:12px 14px; border:1px solid var(--border-primary); max-width:92%; }
    .agent-config-chat-bubble.role-assistant { align-self:flex-start; background:var(--bg-secondary); }
    .agent-config-chat-bubble.role-user { align-self:flex-end; background:color-mix(in srgb, var(--accent) 10%, var(--bg-secondary)); }
    .agent-config-chat-bubble-meta { display:flex; justify-content:space-between; gap:12px; font-size:11px; color:var(--text-tertiary); margin-bottom:6px; }
    .agent-config-chat-bubble-body { white-space:pre-wrap; word-break:break-word; color:var(--text-primary); line-height:1.7; }
    .agent-config-chat-error { background:color-mix(in srgb, var(--error) 10%, var(--bg-secondary)); border-color:color-mix(in srgb, var(--error) 30%, var(--border-primary)); }
    .agent-config-chat-summary-grid { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:10px; margin-bottom:12px; }
    .agent-config-chat-stat-card { border:1px solid var(--border-primary); border-radius:12px; padding:12px; background:var(--bg-primary); display:flex; flex-direction:column; gap:6px; }
    .agent-config-chat-stat-card span { font-size:11px; color:var(--text-tertiary); text-transform:uppercase; }
    .agent-config-chat-stat-card strong { font-size:20px; color:var(--text-primary); }
    .agent-config-chat-target-card { border:1px solid var(--border-primary); border-radius:12px; padding:12px; background:var(--bg-primary); margin-top:10px; }
    .agent-config-chat-target-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
    .agent-config-chat-target-title { font-weight:700; color:var(--text-primary); }
    .agent-config-chat-target-path { font-size:12px; color:var(--text-tertiary); line-height:1.6; margin-top:4px; word-break:break-all; }
    .agent-config-chat-target-badge { font-size:11px; color:var(--text-secondary); background:var(--bg-secondary); border-radius:999px; padding:4px 10px; }
    .agent-config-chat-file-list { display:flex; flex-direction:column; gap:8px; margin-top:12px; }
    .agent-config-chat-file-row { display:grid; grid-template-columns:minmax(0, 1fr) auto; gap:6px 10px; align-items:center; }
    .agent-config-chat-file-row small { grid-column:1 / -1; font-size:12px; color:var(--text-secondary); line-height:1.6; }
    .agent-config-chat-file-status { font-size:11px; border-radius:999px; padding:3px 8px; background:var(--bg-secondary); color:var(--text-secondary); }
    .agent-config-chat-file-status.status-created { background:color-mix(in srgb, var(--success) 16%, transparent); color:var(--success); }
    .agent-config-chat-file-status.status-updated { background:color-mix(in srgb, var(--accent) 16%, transparent); color:var(--accent); }
    .agent-config-chat-input { padding:16px 20px 20px; border-top:1px solid var(--border-primary); display:flex; flex-direction:column; gap:10px; }
    .agent-config-chat-actions { display:flex; gap:8px; flex-wrap:wrap; justify-content:space-between; align-items:center; }
    .agent-config-chat-actions-left, .agent-config-chat-actions-right { display:flex; gap:8px; flex-wrap:wrap; }
    .agent-config-chat-runtime { font-size:12px; color:var(--text-tertiary); }
    .agent-config-template-modal .modal { max-width:860px; width:min(860px, calc(100vw - 24px)); }
    @media (max-width: 820px) {
      .agent-config-chat-panel { width:100%; }
      .agent-config-chat-grid, .agent-config-chat-grid.three, .agent-config-chat-analysis, .agent-config-chat-summary-grid { grid-template-columns:1fr; }
      .agent-config-chat-bubble { max-width:100%; }
    }
  `
  document.head.appendChild(style)
}

function closeOverlay(overlay) {
  if (!overlay || overlay.dataset.closing === '1') return
  overlay.dataset.closing = '1'
  overlay.remove()
}

function buildWelcomeMessage(mode, agent) {
  if (mode === 'create') {
    return t('comp_agent_conversation.welcome_create')
  }
  return `我会先读取并分析 Agent「${agent?.id || ''}」的现有设定，然后你告诉我想怎么调整，我来整理成可写入的规则摘要。`
}

export async function openAgentConfigConversation({
  mode = 'create',
  agent = null,
  availableAgents = [],
  onApplied = null,
  initialPrompt = '',
} = {}) {
  ensureStyles()
  const overlay = document.createElement('div')
  overlay.className = 'agent-config-chat'
  document.body.appendChild(overlay)

  const assistantConfig = loadAssistantProviderConfig()
  const [prefs, modelOptions] = await Promise.all([readPrefs(), loadModelOptions()])
  const sessionId = createRuntimeSession('agent-config-conversation')
  const state = {
    sessionId,
    viewId: null,
    mode,
    targetAgent: agent,
    availableAgents,
    assistantConfig,
    modelOptions,
    runtimeSnapshot: null,
    busy: false,
    inputText: '',
    sourceScope: prefs.lastSourceScope || 'core_and_common',
    createSpec: createDefaultCreateSpec(modelOptions[0] || ''),
    parentAgentId: '',
    answers: mergeQuestionnaireAnswers(prefs.questionnaireDefaults || {}),
    adaptiveQuestions: [],
    analysis: null,
    sources: [],
    generatedTargets: [],
    previewTargets: [],
    writeSummary: null,
    writeResult: null,
    activity: [],
    messages: [
      {
        id: buildMessageId(),
        role: 'assistant',
        text: buildWelcomeMessage(mode, agent),
        timestamp: Date.now(),
      },
    ],
    userNotes: [],
    error: '',
    qualityHint: assessAssistantModelQuality(assistantConfig, {
      scenarioTemplate: '通用办公',
      customScenario: '',
    }),
    currentRunId: null,
  }

  state.viewId = attachRuntimeView(sessionId, {
    onSnapshot(snapshot) {
      state.runtimeSnapshot = snapshot
      rerender()
    },
  })
  setSessionHandlers(sessionId, {
    send(payload = {}) {
      return handleUserInput(String(payload.text || ''))
    },
    abort() {
      return false
    },
  })
  updateSessionSnapshot(sessionId, {
    title: mode === 'create' ? t('comp_agent_conversation.session_title_create') : `聊天调整 ${agent?.id || 'Agent'}`,
    status: 'idle',
    streaming: false,
  })

  async function runWithActivity({ phase, title, runningSummary, detail, timeoutLabel = '', task }) {
    const entry = createActivityEntry({
      phase,
      title,
      summary: runningSummary,
      detail,
      status: 'running',
    })
    state.activity = [entry, ...state.activity]
    state.busy = true
    state.currentRunId = buildRunId()
    state.error = ''
    updateSessionSnapshot(sessionId, {
      status: 'streaming',
      streaming: true,
      title,
    })
    rerender()
    try {
      const result = await task()
      entry.status = 'done'
      entry.summary = timeoutLabel ? `${runningSummary}（${timeoutLabel}）` : runningSummary
      updateSessionSnapshot(sessionId, {
        status: 'idle',
        streaming: false,
        title: mode === 'create' ? t('comp_agent_conversation.session_title_create') : `聊天调整 ${agent?.id || 'Agent'}`,
      })
      return result
    } catch (error) {
      entry.status = 'error'
      entry.summary = error?.message || String(error)
      entry.detail = `${detail ? `${detail}\n\n` : ''}${error?.stack || error?.message || error}`
      state.error = error?.message || String(error)
      updateSessionSnapshot(sessionId, {
        status: 'error',
        streaming: false,
        title: t('comp_agent_conversation.session_status_failed'),
      })
      throw error
    } finally {
      state.busy = false
      state.currentRunId = null
      rerender()
    }
  }

  function invalidateGeneratedSummary() {
    state.generatedTargets = []
    state.previewTargets = []
    state.writeSummary = null
    state.writeResult = null
  }

  function addAssistantMessage(text) {
    state.messages.push({
      id: buildMessageId(),
      role: 'assistant',
      text,
      timestamp: Date.now(),
    })
  }

  function addUserMessage(text) {
    state.messages.push({
      id: buildMessageId(),
      role: 'user',
      text,
      timestamp: Date.now(),
    })
  }

  async function loadCreateReferenceSources() {
    const parentAgentId = String(state.parentAgentId || '').trim()
    if (!parentAgentId) {
      state.sources = []
      return []
    }
    const payload = {
      mode: 'create',
      agentId: null,
      parentAgentId,
      sourceScope: state.sourceScope,
      readTargetSources: false,
      readParentSources: true,
      createSpec: buildCreateSpecPayload(state.createSpec),
    }
    const preview = await api.previewAgentWorkspaceGeneration(payload)
    state.sources = preview.sources || []
    return state.sources
  }

  async function bootstrapConfigureContext() {
    if (state.mode !== 'configure' || !state.targetAgent?.id || state.analysis) return
    try {
      const preview = await runWithActivity({
        phase: 'analyze',
        title: t('comp_agent_conversation.activity_read_rules'),
        runningSummary: `正在读取 ${state.targetAgent.id} 的 workspace 文档`,
        detail: `读取范围：${sourceScopeLabel(state.sourceScope)}`,
        task: () => api.previewAgentWorkspaceGeneration({
          mode: 'configure',
          agentId: state.targetAgent?.id || null,
          sourceScope: state.sourceScope,
        }),
      })
      state.sources = preview.sources || []

      const prompts = buildAnalysisPrompts({
        mode: 'configure',
        targetLabel: state.targetAgent.id,
        sourceScope: sourceScopeLabel(state.sourceScope),
        sources: state.sources,
      })
      const result = await runWithActivity({
        phase: 'analyze',
        title: '调用外部模型分析当前设定',
        runningSummary: '正在总结当前 Agent 的角色、风格、SOP 和 skills 使用方式',
        detail: `模型：${assistantConfig?.model || t('comp_agent_conversation.model_not_configured')}\n文档数：${state.sources.length}`,
        timeoutLabel: '45 秒超时',
        task: () => runStructuredAssistantTask({
          config: assistantConfig,
          systemPrompt: prompts.systemPrompt,
          userPrompt: prompts.userPrompt,
          timeoutMs: 45000,
        }),
      })
      state.analysis = result.json
      state.adaptiveQuestions = normalizeAdaptiveQuestions(result.json?.adaptiveQuestions || [])
      state.answers = mergeQuestionnaireAnswers(
        prefs.questionnaireDefaults || {},
        result.json?.recommendedDefaults || {},
      )
      addAssistantMessage(`我已经读完 ${state.targetAgent.id} 的现有设定。\n\n当前角色：${state.analysis?.summary?.role || t('comp_agent_conversation.analysis_unrecognized')}\n当前对象：${state.analysis?.summary?.audience || t('comp_agent_conversation.analysis_unrecognized')}\n主要风格：${state.analysis?.summary?.thinkingStyle || state.analysis?.summary?.skillsStyle || t('comp_agent_conversation.analysis_unrecognized')}\n\n现在告诉我，你想把它调整成什么样。`)
    } catch (error) {
      addAssistantMessage(`读取或分析现有 Agent 失败：${error?.message || error}\n\n你可以先调整模型配置，或稍后点击“重新分析”。`)
    }
  }

  async function handleCreateInstruction(text) {
    await runWithActivity({
      phase: 'draft',
      title: '根据对话起草新 Agent 设定',
      runningSummary: '正在把你的自然语言要求整理成 Agent 草案',
      detail: `模型：${assistantConfig?.model || t('comp_agent_conversation.model_not_configured')}\n父 Agent：${state.parentAgentId || '无'}`,
      timeoutLabel: '30 秒超时',
      task: async () => {
        await loadCreateReferenceSources()
        const prompts = buildDraftPromptPrefillPrompts({
          draftPrompt: text,
          parentAgentId: state.parentAgentId || '',
          sources: state.sources,
          availableModels: state.modelOptions,
        })
        const result = await runStructuredAssistantTask({
          config: assistantConfig,
          systemPrompt: prompts.systemPrompt,
          userPrompt: prompts.userPrompt,
          timeoutMs: 30000,
        })
        const merged = mergeCreateDraftIntoState({
          createSpec: state.createSpec,
          answers: state.answers,
          parentAgentId: state.parentAgentId,
          draft: result.json,
          availableModels: state.modelOptions,
          availableAgentIds: state.availableAgents.map(item => item.id),
        })
        state.createSpec = { ...state.createSpec, ...merged.createSpec }
        state.answers = merged.answers
        state.parentAgentId = merged.parentAgentId || state.parentAgentId
        state.qualityHint = assessAssistantModelQuality(state.assistantConfig, {
          scenarioTemplate: state.answers?.scenarioTemplate,
          customScenario: state.answers?.customScenario,
        })
      },
    })

    const missing = []
    if (!state.createSpec.agentId) missing.push(t('comp_agent_conversation.label_agent_id'))
    if (!state.createSpec.name) missing.push(t('comp_agent_conversation.label_display_name'))
    addAssistantMessage(
      `我已经整理出一版草案：\n\nAgent ID：${state.createSpec.agentId || '待补充'}\n展示名：${state.createSpec.name || '待补充'}\n场景：${resolveScenarioLabel(state.answers)}\n职责：${state.answers.primaryRole || '待补充'}\n风格：${state.answers.responseStyle || '待补充'}\n\n${missing.length ? `还缺：${missing.join('、')}。你可以继续补充，也可以直接手动改上面的字段。` : '如果方向没问题，下一步可以直接生成写入摘要。'}`
    )
  }

  async function handleConfigureInstruction(text) {
    await bootstrapConfigureContext()
    if (!state.analysis) return
    await runWithActivity({
      phase: 'draft',
      title: '理解这次调整意图',
      runningSummary: '正在把你的调整要求整理成新的配置答案',
      detail: `模型：${assistantConfig?.model || t('comp_agent_conversation.model_not_configured')}\n目标 Agent：${state.targetAgent?.id || ''}`,
      timeoutLabel: '30 秒超时',
      task: async () => {
        const prompts = buildConfigureConversationPrompts({
          targetLabel: state.targetAgent?.id || 'Agent',
          analysis: state.analysis,
          currentAnswers: state.answers,
          request: text,
          availableModels: state.modelOptions,
        })
        const result = await runStructuredAssistantTask({
          config: assistantConfig,
          systemPrompt: prompts.systemPrompt,
          userPrompt: prompts.userPrompt,
          timeoutMs: 30000,
        })
        const patch = compactQuestionnairePatchForMerge(result.json || {})
        const nextModel = String(patch.model || '').trim()
        if (nextModel && state.modelOptions.includes(nextModel)) {
          state.targetAgent = { ...state.targetAgent, model: nextModel }
        }
        delete patch.model
        state.answers = mergeQuestionnaireAnswers(state.answers, patch)
        state.qualityHint = assessAssistantModelQuality(state.assistantConfig, {
          scenarioTemplate: state.answers?.scenarioTemplate,
          customScenario: state.answers?.customScenario,
        })
      },
    })

    addAssistantMessage(
      `我已经把这次调整整理成可写入的设定方向：\n\n场景：${resolveScenarioLabel(state.answers)}\n职责：${state.answers.primaryRole || '未变化'}\n对象：${state.answers.targetAudience || '未变化'}\n风格：${state.answers.responseStyle || '未变化'}\nSOP：${state.answers.sopPreference || '未变化'}\n\n如果还想再细化，继续告诉我；如果方向已经对，就可以生成写入摘要。`
    )
  }

  async function handleUserInput(text) {
    const normalized = String(text || '').trim()
    if (!normalized || state.busy) return false
    addUserMessage(normalized)
    state.userNotes.push(normalized)
    state.inputText = ''
    invalidateGeneratedSummary()
    rerender()
    try {
      if (state.mode === 'create') {
        await handleCreateInstruction(normalized)
      } else {
        await handleConfigureInstruction(normalized)
      }
      return true
    } catch (error) {
      addAssistantMessage(`这次整理失败了：${error?.message || error}\n\n你可以调整说法后再发一次，也可以先看上面的运行详情。`)
      return false
    }
  }

  async function generateWriteSummary() {
    if (state.busy) return
    if (state.mode === 'create') {
      const validationError = validateCreateSpec(state)
      if (validationError) {
        state.error = validationError
        addAssistantMessage(validationError)
        rerender()
        return
      }
      await loadCreateReferenceSources()
    } else {
      await bootstrapConfigureContext()
      if (!state.targetAgent?.id) {
        state.error = '当前没有可调整的目标 Agent。'
        rerender()
        return
      }
    }

    try {
      const createPayload = state.mode === 'create' ? buildCreateSpecPayload(state.createSpec) : null
      const generationAnswers = {
        ...state.answers,
        customNotes: mergeConversationNotes(state),
      }
      const prompts = buildGenerationPrompts({
        mode: state.mode,
        targetLabel: state.mode === 'create'
          ? (createPayload?.name || createPayload?.agentId)
          : (state.targetAgent?.id || 'Agent'),
        targetAgentId: state.mode === 'create'
          ? createPayload?.agentId
          : state.targetAgent?.id,
        parentAgentId: state.mode === 'configure'
          ? state.targetAgent?.id
          : (state.parentAgentId || null),
        sources: state.sources,
        analysis: state.analysis,
        answers: generationAnswers,
        availableModels: state.modelOptions,
      })

      const result = await runWithActivity({
        phase: 'generate',
        title: '生成设定草案',
        runningSummary: '正在根据对话与现有规则生成新的 Agent 文件',
        detail: `模型：${assistantConfig?.model || t('comp_agent_conversation.model_not_configured')}\n文档数：${state.sources.length}\n场景：${resolveScenarioLabel(generationAnswers)}`,
        timeoutLabel: '90 秒超时',
        task: () => runStructuredAssistantTask({
          config: assistantConfig,
          systemPrompt: prompts.systemPrompt,
          userPrompt: prompts.userPrompt,
          timeoutMs: 90000,
        }),
      })

      const normalizedGeneration = normalizeGenerationOutput({
        createSpec: state.createSpec,
        agent: state.targetAgent,
        answers: generationAnswers,
      }, result.json)

      state.generatedTargets = buildPreviewTargetsFromGeneration({
        mode: state.mode,
        targetAgentId: state.mode === 'create'
          ? createPayload?.agentId
          : state.targetAgent?.id,
        createSpec: state.mode === 'create' ? createPayload : null,
        generation: normalizedGeneration,
        currentAgentId: state.mode === 'configure' ? (state.targetAgent?.id || null) : null,
      })

      await runWithActivity({
        phase: 'preview',
        title: '整理写入摘要',
        runningSummary: '正在整理将要写入哪些文件，以及哪些文件会被覆盖备份',
        detail: `目标文件数：${state.generatedTargets.reduce((sum, item) => sum + Object.keys(item.files || {}).length, 0)}`,
        task: async () => {
          if (state.mode === 'create') {
            state.previewTargets = buildCreateModePreviewTargets(state.generatedTargets)
            state.writeSummary = buildWriteSummaryFromPreviewTargets(state.previewTargets, state.generatedTargets)
            return
          }
          const preview = await api.previewAgentWorkspaceGeneration({
            mode: state.mode,
            agentId: state.targetAgent?.id || null,
            createSpec: null,
            parentAgentId: null,
            sourceScope: state.sourceScope,
            readTargetSources: false,
            readParentSources: false,
            generatedTargets: state.generatedTargets,
          })
          state.previewTargets = preview?.previewTargets || []
          state.writeSummary = buildWriteSummaryFromPreviewTargets(state.previewTargets, state.generatedTargets)
        },
      })

      addAssistantMessage(`摘要已经整理好了：将写入 ${state.writeSummary?.totalFiles || 0} 个文件，其中新建 ${state.writeSummary?.createdFiles || 0} 个、更新 ${state.writeSummary?.updatedFiles || 0} 个。确认无误后可以直接写入 workspace。`)
    } catch (error) {
      addAssistantMessage(`生成写入摘要失败：${error?.message || error}\n\n你可以继续补充要求，或者调整模型后再试一次。`)
    }
  }

  async function applyWriteSummary() {
    if (state.busy || !state.generatedTargets.length || !state.writeSummary) return
    try {
      const result = await runWithActivity({
        phase: 'apply',
        title: '写入 workspace 并生成备份',
        runningSummary: '正在把已确认的 Agent 设定写入 OpenClaw workspace',
        detail: `目标数：${state.generatedTargets.length}`,
        task: () => api.applyAgentWorkspaceGeneration({
          generatedTargets: state.generatedTargets,
        }),
      })
      state.writeResult = result
      await writePrefs({
        lastSourceScope: state.sourceScope,
        questionnaireDefaults: state.answers,
      })
      addAssistantMessage(`写入完成。\n\n已更新 ${result?.writtenFiles?.length || 0} 个文件，备份目录：${result?.backupRoot || '未知'}。你现在可以继续让我微调，或让我给你一组验证这个 Agent 的测试消息。`)
      toast(`Agent 设定已写入，共 ${result?.writtenFiles?.length || 0} 个文件`, 'success')
      await onApplied?.(result)
    } catch (error) {
      addAssistantMessage(`写入失败：${error?.message || error}\n\n你可以先看上面的运行详情，再决定是否重试。`)
    }
  }

  function rerender() {
    const analysisSummary = state.analysis?.summary || {}
    overlay.innerHTML = `
      <div class="agent-config-chat-backdrop" data-action="close"></div>
      <aside class="agent-config-chat-panel">
        <div class="agent-config-chat-header">
          <div>
            <div class="agent-config-chat-title">${state.mode === 'create' ? t('comp_agent_conversation.session_title_create') : `聊天调整 ${escapeHtml(state.targetAgent?.id || 'Agent')}`}</div>
            <div class="agent-config-chat-subtitle">默认不再展示差异预览，只给你最终会写入哪些文件、会不会覆盖、备份放哪。</div>
          </div>
          <button class="btn btn-secondary btn-sm" data-action="close">关闭</button>
        </div>
        <div class="agent-config-chat-body">
          <section class="agent-config-chat-card">
            <div class="agent-config-chat-card-title">当前上下文</div>
            ${state.mode === 'create' ? `
              <div class="agent-config-chat-grid">
                <div class="agent-config-chat-field">
                  <label>Agent ID</label>
                  <input class="form-input" id="agent-config-create-id" value="${escapeHtml(state.createSpec.agentId || '')}" placeholder="例如：travel_planner">
                </div>
                <div class="agent-config-chat-field">
                  <label>展示名</label>
                  <input class="form-input" id="agent-config-create-name" value="${escapeHtml(state.createSpec.name || '')}" placeholder="例如：旅行规划助手">
                </div>
                <div class="agent-config-chat-field">
                  <label>主模型</label>
                  <select class="form-input" id="agent-config-create-model">
                    <option value="">稍后再设</option>
                    ${state.modelOptions.map(option => `<option value="${escapeHtml(option)}" ${state.createSpec.model === option ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
                  </select>
                </div>
                <div class="agent-config-chat-field">
                  <label>父 Agent（可选）</label>
                  <select class="form-input" id="agent-config-parent-agent">
                    <option value="">独立 Agent</option>
                    ${state.availableAgents
                      .filter(item => item.id !== state.createSpec.agentId)
                      .map(item => `<option value="${escapeHtml(item.id)}" ${state.parentAgentId === item.id ? 'selected' : ''}>${escapeHtml(item.id)}</option>`).join('')}
                  </select>
                </div>
              </div>
              <div class="agent-config-chat-note">目标工作区：${escapeHtml(resolveCreateWorkspaceDisplayPath(state.createSpec))}</div>
            ` : `
              <div class="agent-config-chat-grid">
                <div class="agent-config-chat-field">
                  <label>目标 Agent</label>
                  <div class="agent-config-chat-note" style="margin-top:0">${escapeHtml(state.targetAgent?.id || t('comp_agent_conversation.target_not_selected'))}</div>
                </div>
                <div class="agent-config-chat-field">
                  <label>当前模型</label>
                  <div class="agent-config-chat-note" style="margin-top:0">${escapeHtml(state.targetAgent?.model || '未设置')}</div>
                </div>
              </div>
              ${state.analysis ? `
                <div class="agent-config-chat-analysis" style="margin-top:12px">
                  <div class="agent-config-chat-analysis-item"><span>角色</span><strong>${escapeHtml(analysisSummary.role || t('comp_agent_conversation.analysis_unrecognized'))}</strong></div>
                  <div class="agent-config-chat-analysis-item"><span>对象</span><strong>${escapeHtml(analysisSummary.audience || t('comp_agent_conversation.analysis_unrecognized'))}</strong></div>
                  <div class="agent-config-chat-analysis-item"><span>思维习惯</span><strong>${escapeHtml(analysisSummary.thinkingStyle || t('comp_agent_conversation.analysis_unrecognized'))}</strong></div>
                  <div class="agent-config-chat-analysis-item"><span>Skills / SOP</span><strong>${escapeHtml(analysisSummary.skillsStyle || analysisSummary.sopStyle || t('comp_agent_conversation.analysis_unrecognized'))}</strong></div>
                </div>
              ` : '<div class="agent-config-chat-note">打开后会自动读取并分析现有规则。</div>'}
            `}
            <div class="agent-config-chat-note">参考范围：${escapeHtml(sourceScopeLabel(state.sourceScope))}</div>
          </section>

          <section class="agent-config-chat-card">
            <div class="agent-config-chat-card-title">运行详情</div>
            ${state.activity.length ? `
              <div class="agent-config-chat-activity">
                ${state.activity.map(item => `
                  <div class="agent-config-chat-activity-item status-${escapeHtml(item.status)}">
                    <div class="agent-config-chat-activity-head">
                      <div>
                        <div class="agent-config-chat-activity-title">${escapeHtml(item.title)}</div>
                        <div class="agent-config-chat-activity-summary">${escapeHtml(item.summary || '')}</div>
                      </div>
                      <div class="agent-config-chat-activity-meta">${escapeHtml(item.status)} · ${escapeHtml(formatTime(item.timestamp))}</div>
                    </div>
                    ${item.detail ? `<pre>${escapeHtml(item.detail)}</pre>` : ''}
                  </div>
                `).join('')}
              </div>
            ` : '<div class="agent-config-chat-empty">开始对话后，这里会记录每个阶段在做什么、用了什么模型、失败时具体报什么错。</div>'}
          </section>

          ${state.error ? `
            <section class="agent-config-chat-card agent-config-chat-error">
              <div class="agent-config-chat-card-title">当前错误</div>
              <div class="agent-config-chat-bubble-body">${escapeHtml(state.error)}</div>
            </section>
          ` : ''}

          <section class="agent-config-chat-card">
            <div class="agent-config-chat-card-title">对话记录</div>
            <div class="agent-config-chat-messages">${renderMessages(state.messages)}</div>
          </section>

          <section class="agent-config-chat-card">
            <div class="agent-config-chat-card-title">写入摘要确认</div>
            ${buildWriteSummaryMarkup(state.writeSummary)}
          </section>

          ${state.writeResult ? `
            <section class="agent-config-chat-card">
              <div class="agent-config-chat-card-title">写入完成</div>
              <div class="agent-config-chat-note">已写入 ${state.writeResult?.writtenFiles?.length || 0} 个文件，备份目录：${escapeHtml(state.writeResult?.backupRoot || '')}</div>
              <div class="agent-config-chat-actions" style="margin-top:12px">
                <div class="agent-config-chat-actions-left">
                  <button class="btn btn-secondary btn-sm" data-action="followup-tune">立即去聊天微调</button>
                  <button class="btn btn-secondary btn-sm" data-action="followup-verify">立即去聊天验证</button>
                </div>
              </div>
            </section>
          ` : ''}
        </div>
        <div class="agent-config-chat-input">
          <textarea class="form-input" id="agent-config-chat-input" rows="4" placeholder="${state.mode === 'create' ? '例如：帮我做招聘初筛，口吻专业直接，能输出推荐等级和面试建议。' : '例如：保留现在的严谨风格，但把它改成更适合给外部客户回复，并补一套明确的确认节点。'}">${escapeHtml(state.inputText)}</textarea>
          <div class="agent-config-chat-actions">
            <div class="agent-config-chat-actions-left">
              ${state.mode === 'configure' ? '<button class="btn btn-secondary btn-sm" data-action="reanalyze">重新分析</button>' : ''}
              <button class="btn btn-secondary btn-sm" data-action="generate-summary" ${state.busy ? 'disabled' : ''}>生成写入摘要</button>
              <button class="btn btn-primary btn-sm" data-action="apply-summary" ${state.busy || !state.writeSummary ? 'disabled' : ''}>确认写入</button>
            </div>
            <div class="agent-config-chat-actions-right">
              <span class="agent-config-chat-runtime">${escapeHtml(state.runtimeSnapshot?.status || (state.busy ? 'streaming' : 'idle'))}</span>
              <button class="btn btn-primary btn-sm" data-action="send" ${state.busy ? 'disabled' : ''}>发送</button>
            </div>
          </div>
        </div>
      </aside>
    `

    overlay.querySelectorAll('[data-action="close"]').forEach(node => {
      node.addEventListener('click', () => {
        detachRuntimeView(sessionId, state.viewId)
        closeOverlay(overlay)
      })
    })
    overlay.querySelector('#agent-config-chat-input')?.addEventListener('input', (event) => {
      state.inputText = event.target.value
    })
    overlay.querySelector('#agent-config-chat-input')?.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        await sendRuntimeMessage(sessionId, { text: state.inputText })
      }
    })
    overlay.querySelector('[data-action="send"]')?.addEventListener('click', async () => {
      await sendRuntimeMessage(sessionId, { text: state.inputText })
    })
    overlay.querySelector('[data-action="generate-summary"]')?.addEventListener('click', generateWriteSummary)
    overlay.querySelector('[data-action="apply-summary"]')?.addEventListener('click', applyWriteSummary)
    overlay.querySelector('[data-action="reanalyze"]')?.addEventListener('click', async () => {
      state.analysis = null
      state.sources = []
      invalidateGeneratedSummary()
      await bootstrapConfigureContext()
      rerender()
    })
    overlay.querySelector('[data-action="followup-tune"]')?.addEventListener('click', () => {
      state.inputText = '请继续帮我微调这个 Agent，重点优化 SOP、确认节点和技能使用边界。'
      rerender()
    })
    overlay.querySelector('[data-action="followup-verify"]')?.addEventListener('click', () => {
      state.inputText = '请给我 5 条验证这个 Agent 是否配置到位的测试消息，并说明每条消息的预期表现。'
      rerender()
    })
    overlay.querySelector('#agent-config-create-id')?.addEventListener('input', (event) => {
      state.createSpec.agentId = event.target.value.trim()
      invalidateGeneratedSummary()
    })
    overlay.querySelector('#agent-config-create-name')?.addEventListener('input', (event) => {
      state.createSpec.name = event.target.value
      invalidateGeneratedSummary()
    })
    overlay.querySelector('#agent-config-create-model')?.addEventListener('change', (event) => {
      state.createSpec.model = event.target.value
      invalidateGeneratedSummary()
    })
    overlay.querySelector('#agent-config-parent-agent')?.addEventListener('change', (event) => {
      state.parentAgentId = event.target.value || ''
      invalidateGeneratedSummary()
    })
  }

  rerender()
  if (state.mode === 'configure') {
    bootstrapConfigureContext().then(() => {
      if (initialPrompt) {
        state.inputText = initialPrompt
        rerender()
      }
    })
  } else if (initialPrompt) {
    state.inputText = initialPrompt
    rerender()
  }

  return {
    close() {
      detachRuntimeView(sessionId, state.viewId)
      closeOverlay(overlay)
    },
  }
}

export async function openAgentTemplateCreator({
  availableAgents = [],
  onApplied = null,
} = {}) {
  ensureStyles()
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay agent-config-template-modal'
  document.body.appendChild(overlay)

  const [modelOptions, skillsData] = await Promise.all([
    loadModelOptions(),
    api.skillsList().catch(() => ({ skills: [] })),
  ])

  const templates = listAgentTemplates()
  const state = {
    busy: false,
    step: 'setup',
    templateId: templates[0]?.id || '',
    createSpec: {
      ...createDefaultCreateSpec(modelOptions[0] || ''),
      name: templates[0]?.label || '',
    },
    templateBuild: null,
    skillStatus: null,
    writeSummary: null,
    error: '',
    skillsData,
    nameCustomized: false,
  }

  async function preparePreview() {
    const payload = buildCreateSpecPayload(state.createSpec)
    if (!payload.agentId) {
      state.error = '请先填写 Agent ID。'
      return
    }
    if (!/^[a-z0-9_-]+$/.test(payload.agentId)) {
      state.error = t('comp_agent_conversation.validate_invalid_id')
      return
    }
    if (availableAgents.some(item => item.id === payload.agentId)) {
      state.error = `Agent ID「${payload.agentId}」已存在，请换一个新的。`
      return
    }
    if (!payload.name) {
      state.error = '请先填写展示名。'
      return
    }
    state.error = ''
    state.templateBuild = buildAgentTemplateTargets({
      templateId: state.templateId,
      createSpec: payload,
    })
    state.skillStatus = buildTemplateSkillStatus(state.templateBuild.template, state.skillsData)
    state.writeSummary = buildTemplateWriteSummary(state.templateBuild)
    state.step = 'preview'
  }

  async function applyTemplate() {
    if (!state.templateBuild?.generatedTargets?.length) return
    state.busy = true
    rerender()
    try {
      const result = await api.applyAgentWorkspaceGeneration({
        generatedTargets: state.templateBuild.generatedTargets,
      })
      state.busy = false
      state.step = 'done'
      toast(`模板已写入，共 ${result?.writtenFiles?.length || 0} 个文件`, 'success')
      await onApplied?.(result)
      rerender()
    } catch (error) {
      state.busy = false
      state.error = error?.message || String(error)
      rerender()
    }
  }

  function close() {
    closeOverlay(overlay)
  }

  function rerender() {
    const template = templates.find(item => item.id === state.templateId) || templates[0]
    overlay.innerHTML = `
      <div class="modal" style="max-width:860px;width:min(860px,calc(100vw - 24px))">
        <div class="modal-title" style="display:flex;justify-content:space-between;gap:12px;align-items:center">
          <span>场景模板创建</span>
          <span class="agent-ai-step-badge">${state.step === 'setup' ? '填写信息' : state.step === 'preview' ? '确认写入' : '创建完成'}</span>
        </div>
        <div class="agent-config-chat-body" style="padding:0;margin-top:16px">
          ${state.error ? `<section class="agent-config-chat-card agent-config-chat-error"><div class="agent-config-chat-bubble-body">${escapeHtml(state.error)}</div></section>` : ''}
          ${state.step === 'setup' ? `
            <section class="agent-config-chat-card">
              <div class="agent-config-chat-card-title">选择模板</div>
              <div class="agent-config-chat-grid">
                ${templates.map(item => `
                  <label class="agent-config-chat-target-card" style="cursor:pointer">
                    <input type="radio" name="agent-template" value="${escapeHtml(item.id)}" ${state.templateId === item.id ? 'checked' : ''} style="margin-right:8px">
                    <strong>${escapeHtml(item.label)}</strong>
                    <div class="agent-config-chat-note">${escapeHtml(item.description)}</div>
                    <div class="agent-config-chat-note">${escapeHtml(item.recommendedModelHint)}</div>
                  </label>
                `).join('')}
              </div>
            </section>
            <section class="agent-config-chat-card">
              <div class="agent-config-chat-card-title">模板参数</div>
              <div class="agent-config-chat-grid">
                <div class="agent-config-chat-field">
                  <label>Agent ID</label>
                  <input class="form-input" id="template-agent-id" value="${escapeHtml(state.createSpec.agentId || '')}" placeholder="例如：travel_planner">
                </div>
                <div class="agent-config-chat-field">
                  <label>展示名</label>
                  <input class="form-input" id="template-agent-name" value="${escapeHtml(state.createSpec.name || template?.label || '')}" placeholder="例如：旅行规划助手">
                </div>
                <div class="agent-config-chat-field">
                  <label>主模型</label>
                  <select class="form-input" id="template-agent-model">
                    <option value="">稍后再设</option>
                    ${modelOptions.map(option => `<option value="${escapeHtml(option)}" ${state.createSpec.model === option ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
                  </select>
                </div>
                <div class="agent-config-chat-field">
                  <label>工作区</label>
                  <div class="agent-config-chat-note" style="margin-top:0">${escapeHtml(resolveCreateWorkspaceDisplayPath(state.createSpec))}</div>
                </div>
              </div>
            </section>
          ` : ''}
          ${state.step === 'preview' ? `
            <section class="agent-config-chat-card">
              <div class="agent-config-chat-card-title">模板摘要</div>
              <div class="agent-config-chat-note">${escapeHtml(template?.description || '')}</div>
              <div class="agent-config-chat-note">${escapeHtml(template?.recommendedModelHint || '')}</div>
              ${state.skillStatus?.requiredMissing?.length || state.skillStatus?.recommendedMissing?.length ? `
                <div class="agent-config-chat-note" style="margin-top:10px;color:var(--warning)">
                  ${state.skillStatus.requiredMissing?.length ? `缺少必需 skills：${escapeHtml(state.skillStatus.requiredMissing.join(', '))}。` : ''}
                  ${state.skillStatus.recommendedMissing?.length ? `建议安装的 skills：${escapeHtml(state.skillStatus.recommendedMissing.join(', '))}。` : ''}
                  不会阻止创建，但 TOOLS/AGENTS 中引用这些 skills 时会按降级策略工作。
                </div>
              ` : '<div class="agent-config-chat-note" style="margin-top:10px">当前模板引用的推荐 skills 都已安装，创建后可以直接使用。</div>'}
            </section>
            <section class="agent-config-chat-card">
              <div class="agent-config-chat-card-title">写入摘要</div>
              ${buildWriteSummaryMarkup(state.writeSummary)}
            </section>
          ` : ''}
          ${state.step === 'done' ? `
            <section class="agent-config-chat-card">
              <div class="agent-config-chat-card-title">模板已创建</div>
              <div class="agent-config-chat-note">新 Agent 已写入默认工作区。下一步你可以直接进入聊天式配置，继续微调或生成验证消息。</div>
              <div class="agent-config-chat-actions" style="margin-top:12px">
                <div class="agent-config-chat-actions-left">
                  <button class="btn btn-secondary btn-sm" data-action="template-tune">立即去聊天微调</button>
                  <button class="btn btn-secondary btn-sm" data-action="template-verify">立即去聊天验证</button>
                </div>
              </div>
            </section>
          ` : ''}
        </div>
        <div class="modal-actions" style="margin-top:18px">
          <button class="btn btn-secondary btn-sm" data-action="close">关闭</button>
          ${state.step === 'setup' ? '<button class="btn btn-primary btn-sm" data-action="template-preview">生成写入摘要</button>' : ''}
          ${state.step === 'preview' ? `<button class="btn btn-primary btn-sm" data-action="template-apply" ${state.busy ? 'disabled' : ''}>确认创建</button>` : ''}
        </div>
      </div>
    `

    overlay.querySelector('[data-action="close"]')?.addEventListener('click', close)
    overlay.querySelector('[data-action="template-preview"]')?.addEventListener('click', async () => {
      await preparePreview()
      rerender()
    })
    overlay.querySelector('[data-action="template-apply"]')?.addEventListener('click', applyTemplate)
    overlay.querySelector('[data-action="template-tune"]')?.addEventListener('click', () => {
      const createdAgent = {
        id: state.createSpec.agentId,
        model: state.createSpec.model,
        workspace: resolveCreateWorkspaceDisplayPath(state.createSpec),
      }
      close()
      openAgentConfigConversation({
        mode: 'configure',
        agent: createdAgent,
        availableAgents: [...availableAgents, createdAgent],
        onApplied,
        initialPrompt: '请继续帮我微调这个 Agent，重点优化 SOP、确认节点和 skills 使用边界。',
      })
    })
    overlay.querySelector('[data-action="template-verify"]')?.addEventListener('click', () => {
      const createdAgent = {
        id: state.createSpec.agentId,
        model: state.createSpec.model,
        workspace: resolveCreateWorkspaceDisplayPath(state.createSpec),
      }
      close()
      openAgentConfigConversation({
        mode: 'configure',
        agent: createdAgent,
        availableAgents: [...availableAgents, createdAgent],
        onApplied,
        initialPrompt: '请给我 5 条验证这个 Agent 是否配置到位的测试消息，并说明每条消息的预期表现。',
      })
    })
    overlay.querySelectorAll('input[name="agent-template"]').forEach(input => {
      input.addEventListener('change', (event) => {
        state.templateId = event.target.value
        const selected = templates.find(item => item.id === state.templateId)
        if (!state.nameCustomized) state.createSpec.name = selected?.label || ''
        rerender()
      })
    })
    overlay.querySelector('#template-agent-id')?.addEventListener('input', (event) => {
      state.createSpec.agentId = event.target.value.trim()
    })
    overlay.querySelector('#template-agent-name')?.addEventListener('input', (event) => {
      state.createSpec.name = event.target.value
      state.nameCustomized = String(event.target.value || '').trim() !== String(template?.label || '').trim()
    })
    overlay.querySelector('#template-agent-model')?.addEventListener('change', (event) => {
      state.createSpec.model = event.target.value
    })
  }

  rerender()
  return { close }
}

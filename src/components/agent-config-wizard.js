import { api } from '../lib/tauri-api.js'
import { t } from '../lib/i18n.js'
import { toast } from './toast.js'
import { showConfirm } from './modal.js'
import {
  AGENT_CONFIG_PANEL_KEY,
  CREATE_WORKSPACE_MODE_OPTIONS,
  SOURCE_SCOPE_OPTIONS,
  buildQuestionnaireSections,
  flattenQuestionnaireSections,
  resolveScenarioLabel,
  resolveWizardModeState,
  getWizardStepLabels,
  createDefaultCreateSpec,
  buildCreateSpecPayload,
  resolveCreateWorkspaceDisplayPath,
  mergeCreateDraftIntoState,
  mergeQuestionnaireAnswers,
  buildAnalysisPrompts,
  buildDraftPromptPrefillPrompts,
  buildGenerationPrompts,
  normalizeAdaptiveQuestions,
  buildPreviewTargetsFromGeneration,
  buildCreateModePreviewTargets,
  buildWriteSummaryFromPreviewTargets,
  normalizeGenerationOutput,
} from '../lib/agent-config.js'
import {
  loadAssistantProviderConfig,
  assessAssistantModelQuality,
  runStructuredAssistantTask,
} from '../lib/assistant-provider.js'

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function readWizardPrefs() {
  try {
    const cfg = await api.readPanelConfig()
    return cfg?.assistant?.[AGENT_CONFIG_PANEL_KEY] || {}
  } catch {
    return {}
  }
}

async function writeWizardPrefs(patch) {
  try {
    const cfg = await api.readPanelConfig().catch(() => ({}))
    if (!cfg.assistant) cfg.assistant = {}
    const current = cfg.assistant[AGENT_CONFIG_PANEL_KEY] || {}
    cfg.assistant[AGENT_CONFIG_PANEL_KEY] = { ...current, ...patch }
    await api.writePanelConfig(cfg)
  } catch (error) {
    console.warn('[agent-config] persist prefs failed', error)
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

function ensureWizardStyles() {
  if (document.getElementById('agent-ai-wizard-styles')) return
  const style = document.createElement('style')
  style.id = 'agent-ai-wizard-styles'
  style.textContent = `
    .agent-ai-modal { max-width: 980px; width: min(980px, calc(100vw - 48px)); }
    .agent-ai-steps { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; color:var(--text-tertiary); font-size:12px; }
    .agent-ai-steps span { padding:4px 10px; border-radius:999px; background:var(--bg-tertiary); }
    .agent-ai-steps span.active { color:var(--accent); background:color-mix(in srgb, var(--accent) 14%, transparent); }
    .agent-ai-step-badge { font-size:12px; color:var(--text-tertiary); }
    .agent-ai-body { max-height:70vh; overflow:auto; }
    .agent-ai-grid.two { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:12px; }
    .agent-ai-banner, .agent-ai-target-card, .agent-ai-analysis-card, .agent-ai-summary-card, .agent-ai-question-card, .agent-ai-preview-target, .agent-ai-question-section { background:var(--bg-secondary); border:1px solid var(--border-primary); border-radius:12px; padding:14px; box-shadow:var(--shadow-sm); }
    .agent-ai-banner { margin-bottom:14px; }
    .agent-ai-banner.level-strong { border-color:color-mix(in srgb, var(--success) 35%, var(--border-primary)); }
    .agent-ai-banner.level-weak, .agent-ai-banner.level-missing { border-color:color-mix(in srgb, var(--warning) 45%, var(--border-primary)); }
    .agent-ai-banner.level-warning { border-color:color-mix(in srgb, var(--warning) 55%, var(--border-primary)); }
    .agent-ai-banner-title, .agent-ai-target-title, .agent-ai-analysis-title, .agent-ai-summary-title, .agent-ai-preview-title, .agent-ai-question-title { font-weight:600; margin-bottom:6px; }
    .agent-ai-banner-text, .agent-ai-target-body, .agent-ai-preview-meta, .agent-ai-question-reason, .agent-ai-summary-body span { color:var(--text-secondary); line-height:1.6; }
    .agent-ai-banner-note { margin-top:8px; font-size:12px; color:var(--text-tertiary); }
    .agent-ai-analysis-grid, .agent-ai-summary-body { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; margin:10px 0; }
    .agent-ai-analysis-grid div, .agent-ai-summary-body div { display:flex; flex-direction:column; gap:4px; }
    .agent-ai-analysis-list { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px; }
    .agent-ai-analysis-list ul, .agent-ai-summary-card ul { margin:8px 0 0 18px; }
    .agent-ai-mode-lock { padding:14px; border:1px solid var(--border-primary); border-radius:12px; background:linear-gradient(135deg, color-mix(in srgb, var(--accent) 7%, var(--bg-secondary)), var(--bg-secondary)); }
    .agent-ai-mode-lock-title { font-weight:600; color:var(--text-primary); margin-bottom:4px; }
    .agent-ai-mode-lock-desc { font-size:12px; color:var(--text-secondary); line-height:1.6; }
    .agent-ai-target-card.is-missing { background:color-mix(in srgb, var(--warning-muted) 32%, var(--bg-secondary)); border-style:dashed; }
    .agent-ai-question-intro { margin-bottom:12px; color:var(--text-secondary); }
    .agent-ai-question-summary { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:10px; margin:12px 0 16px; }
    .agent-ai-question-summary-chip { border:1px solid var(--border-primary); border-radius:12px; padding:12px; background:linear-gradient(180deg, var(--bg-secondary), var(--bg-tertiary)); }
    .agent-ai-question-summary-chip span { display:block; font-size:11px; color:var(--text-tertiary); margin-bottom:6px; }
    .agent-ai-question-summary-chip strong { display:block; color:var(--text-primary); line-height:1.5; }
    .agent-ai-section-stack { display:flex; flex-direction:column; gap:14px; }
    .agent-ai-question-section { padding:0; overflow:hidden; }
    .agent-ai-question-section summary { list-style:none; }
    .agent-ai-question-section summary::-webkit-details-marker { display:none; }
    .agent-ai-section-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
    .agent-ai-question-section.is-collapsible .agent-ai-section-head { padding:0; }
    .agent-ai-section-title { font-weight:600; color:var(--text-primary); margin-bottom:4px; }
    .agent-ai-section-desc { font-size:12px; color:var(--text-secondary); line-height:1.6; }
    .agent-ai-section-body { padding:16px 18px 18px; display:flex; flex-direction:column; gap:14px; }
    .agent-ai-section-head.static { padding:16px 18px 0; }
    .agent-ai-section-toggle { cursor:pointer; padding:16px 18px; display:block; user-select:none; }
    .agent-ai-section-toggle-icon { font-size:12px; color:var(--text-tertiary); transition:transform var(--transition-fast); }
    .agent-ai-question-section.is-collapsible[open] .agent-ai-section-toggle-icon { transform:rotate(180deg); }
    .agent-ai-question-card { padding:16px; background:var(--bg-primary); }
    .agent-ai-question-options { display:flex; flex-direction:column; gap:10px; }
    .agent-ai-option-grid { display:grid; gap:10px; }
    .agent-ai-option-grid.variant-feature, .agent-ai-option-grid.variant-compact { grid-template-columns:repeat(2, minmax(0, 1fr)); }
    .agent-ai-option-grid.variant-chip { grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); }
    .agent-ai-choice-input { position:absolute; opacity:0; pointer-events:none; }
    .agent-ai-choice-card, .agent-ai-choice-chip { position:relative; display:flex; align-items:flex-start; gap:12px; cursor:pointer; transition:all var(--transition-fast); user-select:none; }
    .agent-ai-choice-card { min-height:84px; padding:14px; border:2px solid var(--border-primary); border-radius:12px; background:var(--bg-secondary); }
    .agent-ai-choice-card.compact { min-height:64px; }
    .agent-ai-choice-card:hover, .agent-ai-choice-chip:hover { border-color:var(--border-focus); background:var(--bg-card-hover); }
    .agent-ai-choice-card.selected { border-color:var(--accent); background:color-mix(in srgb, var(--accent) 8%, var(--bg-secondary)); box-shadow:0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent); }
    .agent-ai-choice-chip { min-height:48px; padding:10px 12px; border:1px solid var(--border-primary); border-radius:999px; background:var(--bg-secondary); }
    .agent-ai-choice-chip.selected { border-color:var(--accent); background:var(--accent-muted); color:var(--accent); }
    .agent-ai-choice-marker { width:18px; height:18px; border-radius:999px; border:2px solid var(--border-primary); flex-shrink:0; margin-top:2px; background:var(--bg-secondary); }
    .agent-ai-choice-card.selected .agent-ai-choice-marker, .agent-ai-choice-chip.selected .agent-ai-choice-marker { border-color:var(--accent); background:var(--accent); box-shadow:inset 0 0 0 4px var(--bg-secondary); }
    .agent-ai-choice-copy { min-width:0; display:flex; flex-direction:column; gap:4px; }
    .agent-ai-choice-title { color:var(--text-primary); font-weight:600; line-height:1.45; }
    .agent-ai-choice-desc { font-size:12px; color:var(--text-secondary); line-height:1.6; }
    .agent-ai-choice-chip .agent-ai-choice-title { font-size:12px; font-weight:500; }
    .agent-ai-text-stack { display:flex; flex-direction:column; gap:8px; }
    .agent-ai-preview-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:10px; }
    .agent-ai-preview-badge { font-size:11px; color:var(--text-secondary); background:var(--bg-secondary); border-radius:999px; padding:4px 10px; }
    .agent-ai-preview-file { margin-top:10px; border-top:1px solid var(--border-primary); padding-top:10px; }
    .agent-ai-preview-file summary { cursor:pointer; display:flex; justify-content:space-between; gap:10px; align-items:center; }
    .agent-ai-diff-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:12px; margin-top:10px; }
    .agent-ai-diff-grid pre { white-space:pre-wrap; word-break:break-word; background:var(--bg-secondary); border-radius:10px; padding:10px; font-size:12px; line-height:1.5; min-height:84px; }
    .agent-ai-diff-label { font-size:12px; color:var(--text-tertiary); margin-bottom:6px; }
    .agent-ai-diff-status { font-size:11px; border-radius:999px; padding:3px 9px; }
    .agent-ai-diff-status.status-created { background:color-mix(in srgb, var(--success) 16%, transparent); color:var(--success); }
    .agent-ai-diff-status.status-updated { background:color-mix(in srgb, var(--accent) 16%, transparent); color:var(--accent); }
    .agent-ai-diff-status.status-unchanged { background:var(--bg-secondary); color:var(--text-secondary); }
    .agent-ai-setup-stack { display:flex; flex-direction:column; gap:14px; }
    .agent-ai-readonly { border:1px solid var(--border-primary); border-radius:12px; padding:12px 14px; background:linear-gradient(180deg, var(--bg-secondary), var(--bg-tertiary)); }
    .agent-ai-readonly strong { display:block; margin-bottom:6px; color:var(--text-primary); }
    .agent-ai-readonly code { display:block; white-space:pre-wrap; word-break:break-all; font-size:12px; color:var(--text-secondary); }
    .agent-ai-inline-actions { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:10px; }
    .agent-ai-inline-note { font-size:12px; color:var(--text-tertiary); line-height:1.6; }
    .agent-ai-error-card { background:color-mix(in srgb, var(--warning-muted) 22%, var(--bg-secondary)); border:1px solid color-mix(in srgb, var(--warning) 45%, var(--border-primary)); border-radius:12px; padding:14px; margin-bottom:14px; }
    .agent-ai-error-card strong { display:block; margin-bottom:6px; color:var(--text-primary); }
    .agent-ai-error-card p { margin:0; color:var(--text-secondary); line-height:1.6; }
    .agent-ai-loading, .agent-ai-empty { padding:28px 16px; text-align:center; color:var(--text-secondary); }
    @media (max-width: 820px) {
      .agent-ai-grid.two, .agent-ai-analysis-grid, .agent-ai-analysis-list, .agent-ai-summary-body, .agent-ai-diff-grid, .agent-ai-question-summary, .agent-ai-option-grid.variant-feature, .agent-ai-option-grid.variant-compact { grid-template-columns:1fr; }
      .agent-ai-modal { width: min(980px, calc(100vw - 20px)); }
      .agent-ai-section-head { flex-direction:column; }
    }
  `
  document.head.appendChild(style)
}

function closeOverlay(overlay) {
  if (!overlay || overlay.dataset.closing === '1') return
  overlay.dataset.closing = '1'
  overlay.remove()
}

function sourceScopeLabel(value) {
  return SOURCE_SCOPE_OPTIONS.find(item => item.value === value)?.label || value
}

function questionStepIndex(mode) {
  return mode === 'create' ? 1 : 2
}

function previewStepIndex(mode) {
  return mode === 'create' ? 2 : 3
}

function previewTargetsForState(state) {
  return state.preview?.previewTargets || []
}

function hasReadyPreview(state) {
  return !state.previewError && previewTargetsForState(state).length > 0
}

function draftPromptNeedsRefresh(state) {
  const prompt = String(state.createSpec?.draftPrompt || '').trim()
  return !!prompt && prompt !== state.draftAppliedPrompt
}

function resolveValidParentAgentId(state, candidate = state?.parentAgentId) {
  const value = String(candidate || '').trim()
  if (!value) return ''
  return Array.isArray(state?.availableAgents) && state.availableAgents.some(item => item?.id === value)
    ? value
    : ''
}

function getModeMeta() {
  return {
    configure: {
      label: t('comp_agent_wizard.mode_configure_label'),
      description: t('comp_agent_wizard.mode_configure_desc'),
    },
    create: {
      label: t('comp_agent_wizard.mode_create_label'),
      description: t('comp_agent_wizard.mode_create_desc'),
    },
  }
}

function getQuestionOptionDescriptions() {
  return {
  agentType: {
    '研究型 Agent': t('comp_agent_wizard.opt_agent_type_research'),
    '执行型 Agent': t('comp_agent_wizard.opt_agent_type_execute'),
    '规划型 Agent': t('comp_agent_wizard.opt_agent_type_plan'),
    '写作型 Agent': t('comp_agent_wizard.opt_agent_type_write'),
    '视觉设计型 Agent': t('comp_agent_wizard.opt_agent_type_visual'),
    '客服型 Agent': t('comp_agent_wizard.opt_agent_type_support'),
    '排障型 Agent': t('comp_agent_wizard.opt_agent_type_debug'),
    '内容整理型 Agent': t('comp_agent_wizard.opt_agent_type_organize'),
  },
  identityAdjustment: {
    '保持当前身份不动': t('comp_agent_wizard.opt_identity_keep'),
    '轻微调整职责描述': t('comp_agent_wizard.opt_identity_minor'),
    '明显重写身份定位': t('comp_agent_wizard.opt_identity_major'),
  },
  scenarioTemplate: {
    '投资研究': t('comp_agent_wizard.opt_scenario_invest'),
    '简历筛选': t('comp_agent_wizard.opt_scenario_resume'),
    '旅行规划': t('comp_agent_wizard.opt_scenario_travel'),
    '祝福文案': t('comp_agent_wizard.opt_scenario_greeting'),
    'PPT/海报设计': t('comp_agent_wizard.opt_scenario_ppt'),
    '通用办公': t('comp_agent_wizard.opt_scenario_office'),
    '自定义': t('comp_agent_wizard.opt_scenario_custom'),
  },
  primaryRole: {
    '通用执行助手': t('comp_agent_wizard.opt_role_general'),
    '投研分析助手': t('comp_agent_wizard.opt_role_research'),
    '规划协调助手': t('comp_agent_wizard.opt_role_planning'),
    '写作与文案助手': t('comp_agent_wizard.opt_role_writing'),
    '招聘筛选助手': t('comp_agent_wizard.opt_role_recruit'),
    '视觉创意助手': t('comp_agent_wizard.opt_role_creative'),
    '客户支持助手': t('comp_agent_wizard.opt_role_customer'),
    '技术排障助手': t('comp_agent_wizard.opt_role_tech'),
    '内容整理助手': t('comp_agent_wizard.opt_role_content'),
  },
  targetAudience: {
    '只服务操作者本人': t('comp_agent_wizard.opt_audience_self'),
    '服务团队内部成员': t('comp_agent_wizard.opt_audience_team'),
    '服务外部客户': t('comp_agent_wizard.opt_audience_external'),
    '同时服务内部与外部': t('comp_agent_wizard.opt_audience_both'),
  },
  responseStyle: {
    '专业直接，默认简洁': t('comp_agent_wizard.opt_style_direct'),
    '温和耐心，解释充分': t('comp_agent_wizard.opt_style_patient'),
    '执行导向，偏短句步骤': t('comp_agent_wizard.opt_style_action'),
    '顾问型，结论和依据并重': t('comp_agent_wizard.opt_style_consultant'),
  },
  needsSubAgent: {
    '不需要，单 Agent 即可': t('comp_agent_wizard.opt_sub_agent_no'),
    '需要一个专职子 Agent': t('comp_agent_wizard.opt_sub_agent_yes'),
    '可能需要，先生成可扩展规则': t('comp_agent_wizard.opt_sub_agent_maybe'),
  },
  collaborationMode: {
    '主 Agent 分派，子 Agent 完成后回交': t('comp_agent_wizard.opt_collab_dispatch'),
    '子 Agent 先草拟，主 Agent 统一把关': t('comp_agent_wizard.opt_collab_draft'),
    '子 Agent 只处理固定子流程': t('comp_agent_wizard.opt_collab_fixed'),
  },
  inheritStrategy: {
    '继承整体世界观和协作规则': t('comp_agent_wizard.opt_inherit_all'),
    '只继承语气和价值观': t('comp_agent_wizard.opt_inherit_tone'),
    '只继承工作流，不继承语气': t('comp_agent_wizard.opt_inherit_workflow'),
    '完全独立生成': t('comp_agent_wizard.opt_inherit_none'),
  },
  }
}

function wantsSubAgent(value) {
  const text = String(value || '').trim()
  return text.includes('需要一个专职子 Agent')
}

function isConfigureModeMissingTarget(state) {
  return state.mode === 'configure' && !state.agent?.id
}

function modeLabel(mode) {
  return getModeMeta()[mode]?.label || mode
}

function modeDescription(mode) {
  return getModeMeta()[mode]?.description || ''
}

function questionnaireSectionsForState(state) {
  return buildQuestionnaireSections(state.mode, state.answers, state.adaptiveQuestions || [])
}

function questionListForState(state) {
  return flattenQuestionnaireSections(questionnaireSectionsForState(state))
}

function questionById(state, id) {
  return questionListForState(state).find(item => item.id === id) || null
}

function describeQuestionOption(questionId, option) {
  return getQuestionOptionDescriptions()[questionId]?.[option] || ''
}

function summarizeSubAgentChoice(value) {
  if (String(value || '').includes('不需要')) return '不需要'
  if (String(value || '').includes('可能需要')) return '预留扩展'
  if (wantsSubAgent(value)) return '需要'
  return t('comp_agent_wizard.unset')
}

function isSectionExpanded(state, section) {
  return state.expandedSections?.[section.id] ?? section.defaultExpanded ?? true
}

function renderScenarioHintCard(state, { includeRecommendedLabel = false } = {}) {
  const hint = state.qualityHint || {}
  if (!hint.scenarioTitle && !hint.scenarioDetail) return ''
  const scenarioLabel = resolveScenarioLabel(state.answers)
  return `
    <div class="agent-ai-banner level-${escapeHtml(hint.scenarioLevel || 'okay')}">
      <div class="agent-ai-banner-title">${escapeHtml(hint.scenarioTitle || '当前场景推荐模型能力')}</div>
      <div class="agent-ai-banner-text">${escapeHtml(hint.scenarioDetail || '')}</div>
      <div class="agent-ai-banner-note">
        当前场景：${escapeHtml(scenarioLabel)}
        ${includeRecommendedLabel ? ` · 推荐模型能力：${escapeHtml((hint.scenarioCapabilities || []).join(' / ') || 'strong_text')}` : ''}
      </div>
    </div>
  `
}

function refreshQualityHint(state) {
  state.qualityHint = assessAssistantModelQuality(state.assistantConfig, {
    scenarioTemplate: state.answers?.scenarioTemplate,
    customScenario: state.answers?.customScenario,
  })
}

function renderModeField(state) {
  if (state.modeLocked) {
    return `
      <div class="form-group">
        <label class="form-label">工作模式</label>
        <div class="agent-ai-mode-lock">
          <div class="agent-ai-mode-lock-title">${escapeHtml(modeLabel(state.mode))}</div>
          <div class="agent-ai-mode-lock-desc">${escapeHtml(modeDescription(state.mode))}</div>
        </div>
      </div>
    `
  }
  return `
    <div class="form-group">
      <label class="form-label">工作模式</label>
      <select class="form-input" id="agent-ai-mode">
        ${state.availableModes.map(mode => `<option value="${escapeHtml(mode)}" ${state.mode === mode ? 'selected' : ''}>${escapeHtml(modeLabel(mode))}</option>`).join('')}
      </select>
    </div>
  `
}

function renderQuestionnaireSummary(state) {
  const items = [
    [t('comp_agent_wizard.summary_label_scenario'), resolveScenarioLabel(state.answers)],
    [t('comp_agent_wizard.summary_label_role'), state.answers.primaryRole || t('comp_agent_wizard.unset')],
    [t('comp_agent_wizard.summary_label_style'), state.answers.responseStyle || t('comp_agent_wizard.unset')],
    [t('comp_agent_wizard.summary_label_sub_agent'), summarizeSubAgentChoice(state.answers.needsSubAgent)],
  ]
  return `
    <div class="agent-ai-question-summary">
      ${items.map(([label, value]) => `
        <div class="agent-ai-question-summary-chip">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value || t('comp_agent_wizard.unset'))}</strong>
        </div>
      `).join('')}
    </div>
  `
}

function resolveQuestionVariant(section, question) {
  if (question.type === 'text') return 'text'
  if (section.id === 'advanced' && question.type === 'multiple') return 'chip'
  if (section.id === 'advanced' || section.id === 'adaptive') return 'compact'
  return 'feature'
}

function renderOptionInputs(question, state, modelOptions, variant = 'feature') {
  const answer = state.answers[question.id]
  if (question.type === 'text') {
    const tag = question.id === 'customNotes' ? 'textarea' : 'input'
    if (tag === 'textarea') {
      return `<textarea class="form-input" data-answer-text="${question.id}" rows="3" placeholder="${escapeHtml(question.placeholder || '')}" style="resize:vertical">${escapeHtml(answer || '')}</textarea>`
    }
    if (question.id === 'subAgentModel' && modelOptions.length) {
      return `
        <div class="agent-ai-text-stack">
          <select class="form-input" data-answer-text="${question.id}">
            <option value="">请选择模型</option>
            ${modelOptions.map(option => `<option value="${escapeHtml(option)}" ${answer === option ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
          </select>
          <input class="form-input" data-answer-text="${question.id}" value="${escapeHtml(answer || '')}" placeholder="或输入自定义模型，例如 openai/gpt-5-mini">
        </div>
      `
    }
    return `<input class="form-input" data-answer-text="${question.id}" value="${escapeHtml(answer || '')}" placeholder="${escapeHtml(question.placeholder || '')}">`
  }

  const options = Array.isArray(question.options) ? question.options : []
  const selected = question.type === 'multiple' ? new Set(Array.isArray(answer) ? answer : []) : answer
  const gridClass = variant === 'chip'
    ? 'variant-chip'
    : variant === 'compact'
      ? 'variant-compact'
      : 'variant-feature'
  return `
    <div class="agent-ai-option-grid ${gridClass}">
      ${options.map(option => {
    const checked = question.type === 'multiple'
      ? selected.has(option)
      : selected === option
    const inputType = question.type === 'multiple' ? 'checkbox' : 'radio'
    const desc = variant === 'chip' ? '' : describeQuestionOption(question.id, option)
    const choiceClass = variant === 'chip'
      ? 'agent-ai-choice-chip'
      : `agent-ai-choice-card${variant === 'compact' ? ' compact' : ''}`
    return `
      <label class="${choiceClass} ${checked ? 'selected' : ''}">
        <input class="agent-ai-choice-input" type="${inputType}" name="agent-ai-${question.id}" data-answer-option="${question.id}" value="${escapeHtml(option)}" ${checked ? 'checked' : ''}>
        <span class="agent-ai-choice-marker"></span>
        <span class="agent-ai-choice-copy">
          <span class="agent-ai-choice-title">${escapeHtml(option)}</span>
          ${desc ? `<span class="agent-ai-choice-desc">${escapeHtml(desc)}</span>` : ''}
        </span>
      </label>
    `
      }).join('')}
    </div>
  `
}

function renderQuestionCard(section, question, state, modelOptions) {
  const variant = resolveQuestionVariant(section, question)
  return `
    <div class="agent-ai-question-card">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
        <div>
          <div class="agent-ai-question-title">${escapeHtml(question.label)}</div>
          ${question.reason ? `<div class="agent-ai-question-reason">${escapeHtml(question.reason)}</div>` : ''}
        </div>
      </div>
      <div class="agent-ai-question-options">
        ${renderOptionInputs(question, state, modelOptions, variant)}
      </div>
    </div>
  `
}

function renderQuestionSections(state, modelOptions) {
  return `
    <div class="agent-ai-section-stack">
      ${questionnaireSectionsForState(state).map(section => {
        const header = `
          <div class="agent-ai-section-head${section.collapsible ? '' : ' static'}">
            <div>
              <div class="agent-ai-section-title">${escapeHtml(section.title)}</div>
              ${section.description ? `<div class="agent-ai-section-desc">${escapeHtml(section.description)}</div>` : ''}
            </div>
            ${section.collapsible ? `<div class="agent-ai-section-toggle-icon">${isSectionExpanded(state, section) ? '▾' : '▸'}</div>` : ''}
          </div>
        `
        const body = `
          <div class="agent-ai-section-body">
            ${section.questions.map(question => renderQuestionCard(section, question, state, modelOptions)).join('')}
          </div>
        `
        if (section.collapsible) {
          return `
            <details class="agent-ai-question-section is-collapsible" data-section-toggle="${escapeHtml(section.id)}" ${isSectionExpanded(state, section) ? 'open' : ''}>
              <summary class="agent-ai-section-toggle">${header}</summary>
              ${body}
            </details>
          `
        }
        return `
          <section class="agent-ai-question-section">
            ${header}
            ${body}
          </section>
        `
      }).join('')}
    </div>
  `
}

function renderPreviewTargets(previewTargets = []) {
  const summary = buildWriteSummaryFromPreviewTargets(previewTargets)
  if (!summary.targets.length) {
    return `<div class="agent-ai-empty">还没有可确认的写入摘要。</div>`
  }
  return `
    <div class="agent-ai-summary-card">
      <div class="agent-ai-summary-title">写入摘要</div>
      <div class="agent-ai-summary-body">
        <div><strong>涉及文件</strong><span>${summary.totalFiles || 0}</span></div>
        <div><strong>新建</strong><span>${summary.createdFiles || 0}</span></div>
        <div><strong>更新</strong><span>${summary.updatedFiles || 0}</span></div>
      </div>
      ${summary.targets.map(target => `
        <div class="agent-ai-preview-target" style="margin-top:12px">
          <div class="agent-ai-preview-head">
            <div>
              <div class="agent-ai-preview-title">${escapeHtml(target.label || 'Agent')}</div>
              <div class="agent-ai-preview-meta">${escapeHtml(target.workspace || '')}</div>
            </div>
            <div class="agent-ai-preview-badge">${target.exists ? '覆盖并备份' : '新建写入'}</div>
          </div>
          ${target.fileChanges.map(file => `
            <div class="agent-ai-preview-file">
              <div style="display:flex;justify-content:space-between;gap:12px;align-items:center">
                <strong>${escapeHtml(file.name)}</strong>
                <span class="agent-ai-diff-status status-${escapeHtml(file.status || 'updated')}">${escapeHtml(file.status || 'updated')}</span>
              </div>
              <div class="agent-ai-preview-meta" style="margin-top:6px">${escapeHtml(file.summary || '将写入新的 Agent 规则')}</div>
            </div>
          `).join('')}
          ${target.backupFiles?.length ? `<div class="agent-ai-banner-note">写入前会先备份：${escapeHtml(target.backupFiles.join(', '))}</div>` : ''}
        </div>
      `).join('')}
      ${summary.backupRoot ? `<div class="agent-ai-banner-note" style="margin-top:12px">备份目录：${escapeHtml(summary.backupRoot)}</div>` : ''}
    </div>
  `
}

function renderWizardContent(state, modelOptions) {
  const providerHint = state.qualityHint || { title: '未检测模型', detail: '' }
  const missingConfigureTarget = isConfigureModeMissingTarget(state)
  const questionStep = questionStepIndex(state.mode)
  const previewStep = previewStepIndex(state.mode)
  const steps = getWizardStepLabels(state.mode)
  const createWorkspacePath = resolveCreateWorkspaceDisplayPath(state.createSpec)
  const selectedParentAgentId = resolveValidParentAgentId(state)
  const setupBody = state.mode === 'configure'
    ? `
      <div class="agent-ai-banner level-${escapeHtml(providerHint.level || 'okay')}">
        <div class="agent-ai-banner-title">${escapeHtml(providerHint.title || '')}</div>
        <div class="agent-ai-banner-text">${escapeHtml(providerHint.detail || '')}</div>
        ${providerHint.recommended ? '<div class="agent-ai-banner-note">推荐使用 OpenAI / Anthropic 等更强模型来生成首版 Agent 设定。</div>' : ''}
      </div>
      ${renderScenarioHintCard(state, { includeRecommendedLabel: true })}
      <div class="agent-ai-grid two">
        ${renderModeField(state)}
        <div class="form-group">
          <label class="form-label">读取范围</label>
          <select class="form-input" id="agent-ai-source-scope">
            ${SOURCE_SCOPE_OPTIONS.map(option => `<option value="${option.value}" ${state.sourceScope === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-hint" style="margin-top:-4px">${escapeHtml(sourceScopeLabel(state.sourceScope))}。会先读 workspace 文档，再由外部模型总结成新的设定草案。</div>
      <div class="agent-ai-target-card ${missingConfigureTarget ? 'is-missing' : ''}">
        <div class="agent-ai-target-title">当前目标</div>
        <div class="agent-ai-target-body">
          ${missingConfigureTarget
            ? '当前没有可配置的目标 Agent。请从 Agent 列表中选中一个现有 Agent 后再进入 AI 配置。'
            : `${escapeHtml(state.agent?.id || '')}${state.agent?.workspace ? ` · ${escapeHtml(state.agent.workspace)}` : ''}`}
        </div>
        ${missingConfigureTarget ? '<div class="agent-ai-banner-note">“AI 新建 Agent”入口现在只负责创建新 Agent，不再允许切到无目标的配置模式。</div>' : ''}
      </div>
    `
    : `
      <div class="agent-ai-banner level-${escapeHtml(providerHint.level || 'okay')}">
        <div class="agent-ai-banner-title">${escapeHtml(providerHint.title || '')}</div>
        <div class="agent-ai-banner-text">${escapeHtml(providerHint.detail || '')}</div>
        ${providerHint.recommended ? '<div class="agent-ai-banner-note">推荐使用 OpenAI / Anthropic 等更强模型来生成首版 Agent 设定。</div>' : ''}
      </div>
      ${renderScenarioHintCard(state, { includeRecommendedLabel: true })}
      <div class="agent-ai-setup-stack">
        <div class="agent-ai-target-card">
          <div class="agent-ai-target-title">一句话定义这个 Agent 要做什么</div>
          <div class="agent-ai-target-body">可以直接写业务目标、服务对象、语气风格，以及是否需要拆成子 Agent。留空也可以，下一步手动填写。</div>
          <textarea class="form-input" id="agent-ai-draft-prompt" rows="4" placeholder="例如：帮我做招聘初筛，阅读简历后总结候选人亮点、风险和推荐等级，默认口吻专业直接，必要时可拆出一个背调子 Agent。">${escapeHtml(state.createSpec.draftPrompt || '')}</textarea>
          <div class="agent-ai-inline-actions">
            <button class="btn btn-secondary btn-sm" data-action="apply-draft" ${String(state.createSpec.draftPrompt || '').trim() ? '' : 'disabled'}>AI 帮我起草</button>
            <span class="agent-ai-inline-note">只会预填表单，不会直接写入 workspace。</span>
          </div>
          ${state.draftAppliedPrompt ? `<div class="agent-ai-banner-note">${draftPromptNeedsRefresh(state) ? 'prompt 已更新，继续下一步时会重新起草。' : '已根据当前 prompt 预填一版草案，后面仍可手动调整。'}</div>` : ''}
          ${state.draftError ? `
            <div class="agent-ai-error-card" style="margin-top:12px;margin-bottom:0">
              <strong>草案起草失败</strong>
              <p>${escapeHtml(state.draftError)}</p>
            </div>
          ` : ''}
        </div>
        <div class="agent-ai-grid two">
          <div class="form-group">
            <label class="form-label">新 Agent ID</label>
            <input class="form-input" id="agent-ai-create-id" value="${escapeHtml(state.createSpec.agentId || '')}" placeholder="例如：researcher">
            <div class="form-hint" style="margin-top:6px">支持小写字母、数字、下划线和连字符。</div>
          </div>
          <div class="form-group">
            <label class="form-label">展示名</label>
            <input class="form-input" id="agent-ai-create-name" value="${escapeHtml(state.createSpec.name || '')}" placeholder="例如：研究助手">
          </div>
        </div>
        <div class="agent-ai-grid two">
          <div class="form-group">
            <label class="form-label">主模型</label>
            <select class="form-input" id="agent-ai-create-model">
              <option value="">稍后再设</option>
              ${modelOptions.map(option => `<option value="${escapeHtml(option)}" ${state.createSpec.model === option ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
            </select>
            <div class="form-hint" style="margin-top:6px">当前场景推荐的模型能力：${escapeHtml((state.qualityHint?.scenarioCapabilities || []).join(' / ') || 'strong_text')}</div>
          </div>
          <div class="form-group">
            <label class="form-label">父 Agent（可选）</label>
            <select class="form-input" id="agent-ai-parent-agent">
              <option value="">独立 Agent</option>
              ${state.availableAgents
                .filter(item => item.id !== state.createSpec.agentId)
                .map(item => `<option value="${escapeHtml(item.id)}" ${selectedParentAgentId === item.id ? 'selected' : ''}>${escapeHtml(item.id)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="agent-ai-readonly">
          <strong>目标工作区</strong>
          <code>${escapeHtml(createWorkspacePath)}</code>
        </div>
        <details class="agent-ai-target-card" ${state.createSpec.workspaceMode === 'custom' ? 'open' : ''}>
          <summary style="cursor:pointer;font-weight:600;color:var(--text-primary)">高级项</summary>
          <div style="margin-top:12px;display:flex;flex-direction:column;gap:12px">
            <div class="agent-ai-grid two">
              <div class="form-group">
                <label class="form-label">工作区方式</label>
                <select class="form-input" id="agent-ai-create-workspace-mode">
                  ${CREATE_WORKSPACE_MODE_OPTIONS.map(option => `<option value="${escapeHtml(option.value)}" ${state.createSpec.workspaceMode === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
                </select>
                <div class="form-hint" style="margin-top:6px">${escapeHtml(CREATE_WORKSPACE_MODE_OPTIONS.find(item => item.value === state.createSpec.workspaceMode)?.description || '')}</div>
              </div>
              <div class="form-group">
                <label class="form-label">参考范围</label>
                <select class="form-input" id="agent-ai-source-scope">
                  ${SOURCE_SCOPE_OPTIONS.map(option => `<option value="${option.value}" ${state.sourceScope === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
                </select>
                <div class="form-hint" style="margin-top:6px">只有选择父 Agent 时才会读取这里定义的参考文件。</div>
              </div>
            </div>
            ${state.createSpec.workspaceMode === 'custom' ? `
              <div class="form-group">
                <label class="form-label">自定义工作区路径</label>
                <input class="form-input" id="agent-ai-create-workspace" value="${escapeHtml(state.createSpec.workspace || '')}" placeholder="例如：/data/openclaw/agents/researcher/workspace">
                <div class="form-hint" style="margin-top:6px">留空将无法继续；只有明确要写入非默认路径时才建议使用。</div>
              </div>
            ` : ''}
          </div>
        </details>
      </div>
    `

  const analysisBody = `
    <div class="agent-ai-analysis-card">
      <div class="agent-ai-analysis-title">已识别设定摘要</div>
      <div class="agent-ai-analysis-grid">
        <div><strong>角色</strong><span>${escapeHtml(state.analysis?.summary?.role || '未识别')}</span></div>
        <div><strong>对象</strong><span>${escapeHtml(state.analysis?.summary?.audience || '未识别')}</span></div>
        <div><strong>思维习惯</strong><span>${escapeHtml(state.analysis?.summary?.thinkingStyle || '未识别')}</span></div>
        <div><strong>Skills / SOP</strong><span>${escapeHtml(state.analysis?.summary?.skillsStyle || state.analysis?.summary?.sopStyle || '未识别')}</span></div>
      </div>
      <div class="agent-ai-analysis-list">
        <div>
          <strong>优势</strong>
          <ul>${(state.analysis?.summary?.strengths || []).map(item => `<li>${escapeHtml(item)}</li>`).join('') || '<li>暂无</li>'}</ul>
        </div>
        <div>
          <strong>缺口</strong>
          <ul>${(state.analysis?.gaps || []).map(item => `<li>${escapeHtml(item)}</li>`).join('') || '<li>暂无</li>'}</ul>
        </div>
        <div>
          <strong>冲突</strong>
          <ul>${(state.analysis?.conflicts || []).map(item => `<li>${escapeHtml(item)}</li>`).join('') || '<li>暂无</li>'}</ul>
        </div>
      </div>
      <div class="form-hint">下一步会用固定题库补齐关键设定；如果文档里有冲突或信息缺失，也会追加少量追问。</div>
    </div>
  `

  const questionnaireBody = `
    <div class="agent-ai-question-intro">
      <div>优先用选择题完成设定。只有需要补充时再填写文字。</div>
      <div class="form-hint">${state.mode === 'create' ? '新建模式默认只展示核心题；高级设定会折叠收起。选择“需要一个专职子 Agent”后，系统会单独展开子 Agent 区块。' : '优先保留现有身份，再用固定题库和少量追问补足关键设定。'}</div>
    </div>
    ${renderScenarioHintCard(state)}
    ${renderQuestionnaireSummary(state)}
    ${renderQuestionSections(state, modelOptions)}
  `

  const previewBody = `
    ${state.previewError ? `
      <div class="agent-ai-error-card">
        <strong>预览生成失败</strong>
        <p>${escapeHtml(state.previewError)}</p>
      </div>
    ` : ''}
    ${state.generation ? `
      <div class="agent-ai-summary-card">
        <div class="agent-ai-summary-title">生成摘要</div>
        <div class="agent-ai-summary-body">
          <div><strong>使命</strong><span>${escapeHtml(state.generation?.summary?.mission || '未生成')}</span></div>
          <div><strong>人格</strong><span>${escapeHtml(state.generation?.summary?.persona || '未生成')}</span></div>
          <div><strong>流程</strong><span>${escapeHtml(state.generation?.summary?.workflow || state.generation?.summary?.notes?.[0] || '未生成')}</span></div>
        </div>
        ${(state.generation?.summary?.notes || []).length ? `<ul>${state.generation.summary.notes.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
      </div>
    ` : ''}
    ${!state.previewError && !previewTargetsForState(state).length && !state.generation ? '<div class="agent-ai-empty">生成完成后会在这里展示写入摘要。</div>' : ''}
    ${previewTargetsForState(state).length ? renderPreviewTargets(previewTargetsForState(state)) : ''}
  `

  const body = state.step === 0
    ? setupBody
    : state.mode === 'configure' && state.step === 1
      ? analysisBody
      : state.step === questionStep
        ? questionnaireBody
        : previewBody

  return `
    <div class="modal agent-ai-modal">
      <div class="modal-title" style="display:flex;justify-content:space-between;gap:12px;align-items:center">
        <span>Agent 高级向导</span>
        <span class="agent-ai-step-badge">步骤 ${Math.min(state.step + 1, steps.length)} / ${steps.length}</span>
      </div>
      <div class="agent-ai-steps">
        ${steps.map((label, index) => `<span class="${state.step === index ? 'active' : ''}">${escapeHtml(label)}</span>`).join('')}
      </div>
      <div class="agent-ai-body">
        ${state.busy ? `<div class="agent-ai-loading">${escapeHtml(state.busyText || t('comp_agent_wizard.busy_default'))}</div>` : body}
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" data-action="cancel">取消</button>
        ${state.step > 0 && !state.busy ? '<button class="btn btn-secondary btn-sm" data-action="back">上一步</button>' : ''}
        ${state.mode === 'configure' && state.step === 0 && !state.busy ? `<button class="btn btn-primary btn-sm" data-action="analyze" ${missingConfigureTarget ? 'disabled' : ''}>读取并分析</button>` : ''}
        ${state.mode === 'create' && state.step === 0 && !state.busy ? '<button class="btn btn-primary btn-sm" data-action="continue-create">继续设定</button>' : ''}
        ${state.mode === 'configure' && state.step === 1 && !state.busy ? '<button class="btn btn-primary btn-sm" data-action="to-questions">继续设定</button>' : ''}
        ${state.step === questionStep && !state.busy ? '<button class="btn btn-primary btn-sm" data-action="generate">生成预览</button>' : ''}
        ${state.step === previewStep && !state.busy && !hasReadyPreview(state) ? '<button class="btn btn-primary btn-sm" data-action="retry-generate">重试生成预览</button>' : ''}
        ${state.step === previewStep && !state.busy && hasReadyPreview(state) ? '<button class="btn btn-primary btn-sm" data-action="apply">确认写入</button>' : ''}
      </div>
    </div>
  `
}

function attachAnswerBindings(overlay, state, rerender) {
  overlay.querySelectorAll('[data-answer-option]').forEach(input => {
    input.addEventListener('change', () => {
      const qid = input.dataset.answerOption
      const question = questionById(state, qid)
      if (question?.type === 'multiple') {
        const checked = [...overlay.querySelectorAll(`[data-answer-option="${qid}"]:checked`)].map(item => item.value)
        state.answers[qid] = checked
      } else {
        state.answers[qid] = input.value
      }
      refreshQualityHint(state)
      rerender({ preserveScroll: true })
    })
  })

  overlay.querySelectorAll('[data-answer-text]').forEach(input => {
    const update = () => {
      state.answers[input.dataset.answerText] = input.value
      refreshQualityHint(state)
    }
    input.addEventListener('input', update)
    input.addEventListener('change', () => {
      update()
      rerender({ preserveScroll: true })
    })
  })
}

export async function openAgentConfigWizard({ mode = 'configure', allowedModes = [], agent = null, availableAgents = [], onApplied = null }) {
  ensureWizardStyles()
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  document.body.appendChild(overlay)

  const assistantConfig = loadAssistantProviderConfig()
  const prefs = await readWizardPrefs()
  const modelOptions = await loadModelOptions()
  const modeState = resolveWizardModeState(mode, allowedModes)
  const state = {
    step: 0,
    busy: false,
    busyText: '',
    mode: modeState.currentMode,
    availableModes: modeState.availableModes,
    modeLocked: modeState.modeLocked,
    agent,
    availableAgents,
    assistantConfig,
    qualityHint: null,
    sourceScope: prefs.lastSourceScope || 'core_and_common',
    answers: mergeQuestionnaireAnswers(prefs.questionnaireDefaults || {}),
    adaptiveQuestions: [],
    analysis: null,
    sources: [],
    preview: null,
    previewError: '',
    generation: null,
    generatedTargets: [],
    createSpec: createDefaultCreateSpec(modelOptions[0] || ''),
    draftAppliedPrompt: '',
    draftError: '',
    parentAgentId: agent?.id || '',
    expandedSections: {
      advanced: false,
    },
  }
  refreshQualityHint(state)

  const rerender = ({ preserveScroll = false } = {}) => {
    const scrollTop = preserveScroll ? (overlay.querySelector('.agent-ai-body')?.scrollTop || 0) : 0
    overlay.innerHTML = renderWizardContent(state, modelOptions)
    if (preserveScroll) {
      const body = overlay.querySelector('.agent-ai-body')
      if (body) body.scrollTop = scrollTop
    }
    overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', () => closeOverlay(overlay))
    overlay.querySelector('[data-action="back"]')?.addEventListener('click', () => {
      state.step = Math.max(0, state.step - 1)
      rerender()
    })
    overlay.querySelector('[data-action="to-questions"]')?.addEventListener('click', () => {
      state.step = questionStepIndex(state.mode)
      rerender()
    })
    overlay.querySelector('[data-action="continue-create"]')?.addEventListener('click', continueCreateSetup)
    overlay.querySelector('[data-action="apply-draft"]')?.addEventListener('click', () => applyDraftPrompt())
    overlay.querySelector('[data-action="analyze"]')?.addEventListener('click', analyzeCurrentState)
    overlay.querySelector('[data-action="generate"]')?.addEventListener('click', generatePreview)
    overlay.querySelector('[data-action="retry-generate"]')?.addEventListener('click', generatePreview)
    overlay.querySelector('[data-action="apply"]')?.addEventListener('click', applyPreview)
    overlay.querySelector('#agent-ai-mode')?.addEventListener('change', (event) => {
      state.mode = event.target.value
      if (state.mode === 'create') {
        state.parentAgentId = agent?.id || ''
      }
      refreshQualityHint(state)
      rerender()
    })
    overlay.querySelector('#agent-ai-source-scope')?.addEventListener('change', (event) => {
      state.sourceScope = event.target.value
    })
    overlay.querySelector('#agent-ai-create-id')?.addEventListener('input', (event) => {
      state.createSpec.agentId = event.target.value.trim()
      if (state.parentAgentId && state.parentAgentId === state.createSpec.agentId) state.parentAgentId = ''
    })
    overlay.querySelector('#agent-ai-create-id')?.addEventListener('change', () => {
      rerender({ preserveScroll: true })
    })
    overlay.querySelector('#agent-ai-create-name')?.addEventListener('input', (event) => {
      state.createSpec.name = event.target.value
    })
    overlay.querySelector('#agent-ai-create-model')?.addEventListener('change', (event) => {
      state.createSpec.model = event.target.value
    })
    overlay.querySelector('#agent-ai-draft-prompt')?.addEventListener('input', (event) => {
      state.createSpec.draftPrompt = event.target.value
      overlay.querySelector('[data-action="apply-draft"]')?.toggleAttribute('disabled', !String(event.target.value || '').trim())
    })
    overlay.querySelector('#agent-ai-draft-prompt')?.addEventListener('change', () => {
      rerender({ preserveScroll: true })
    })
    overlay.querySelector('#agent-ai-create-workspace-mode')?.addEventListener('change', (event) => {
      state.createSpec.workspaceMode = event.target.value
      rerender({ preserveScroll: true })
    })
    overlay.querySelector('#agent-ai-create-workspace')?.addEventListener('input', (event) => {
      state.createSpec.workspace = event.target.value
    })
    overlay.querySelector('#agent-ai-create-workspace')?.addEventListener('change', () => {
      rerender({ preserveScroll: true })
    })
    overlay.querySelector('#agent-ai-parent-agent')?.addEventListener('change', (event) => {
      state.parentAgentId = event.target.value || ''
    })
    overlay.querySelectorAll('[data-section-toggle]').forEach(section => {
      section.addEventListener('toggle', () => {
        state.expandedSections[section.dataset.sectionToggle] = section.open
      })
    })
    attachAnswerBindings(overlay, state, rerender)
  }

  function handleOverlayClick(event) {
    if (event.target === overlay) closeOverlay(overlay)
  }

  function getCreatePayload({ requireId = true } = {}) {
    const payload = buildCreateSpecPayload(state.createSpec)
    const parentAgentId = resolveValidParentAgentId(state)
    if (requireId && !payload.agentId) {
      toast('请先填写新 Agent ID，或用 prompt 让 AI 帮你起草', 'warning')
      return null
    }
    if (payload.agentId && !/^[a-z0-9_-]+$/.test(payload.agentId)) {
      toast('Agent ID 只能包含小写字母、数字、下划线和连字符', 'warning')
      return null
    }
    if (payload.workspaceMode === 'custom' && !payload.workspace) {
      toast('已切换为自定义工作区，请先填写工作区路径', 'warning')
      return null
    }
    if (payload.agentId && parentAgentId && payload.agentId === parentAgentId) {
      toast('父 Agent 不能与新 Agent ID 相同', 'warning')
      return null
    }
    return payload
  }

  async function loadCreateReferenceSources() {
    const parentAgentId = resolveValidParentAgentId(state)
    const readParentSources = Boolean(parentAgentId)
    state.parentAgentId = parentAgentId
    if (!readParentSources) {
      state.sources = []
      return []
    }

    const payload = {
      mode: 'create',
      agentId: null,
      parentAgentId: parentAgentId || null,
      sourceScope: state.sourceScope,
      readTargetSources: false,
      readParentSources: true,
    }
    const createPayload = buildCreateSpecPayload(state.createSpec)
    if (createPayload?.agentId) payload.createSpec = createPayload
    const preview = await api.previewAgentWorkspaceGeneration(payload)
    state.sources = preview.sources || []
    return state.sources
  }

  async function applyDraftPrompt() {
    const draftPrompt = String(state.createSpec.draftPrompt || '').trim()
    if (!draftPrompt) {
      toast('先写一句你想让 Agent 做什么，我再帮你起草。', 'warning')
      return false
    }

    try {
      state.busy = true
      state.busyText = '正在根据文字 prompt 起草 Agent 设定...'
      state.draftError = ''
      rerender()

      await loadCreateReferenceSources()
      const prompts = buildDraftPromptPrefillPrompts({
        draftPrompt,
        parentAgentId: resolveValidParentAgentId(state),
        sources: state.sources,
        availableModels: modelOptions,
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
        parentAgentId: resolveValidParentAgentId(state),
        draft: result.json,
        availableModels: modelOptions,
        availableAgentIds: state.availableAgents.map(item => item.id),
      })
      state.createSpec = {
        ...state.createSpec,
        ...merged.createSpec,
      }
      state.answers = merged.answers
      state.parentAgentId = resolveValidParentAgentId(state, merged.parentAgentId)
      state.draftAppliedPrompt = draftPrompt
      state.draftError = ''
      refreshQualityHint(state)
      return true
    } catch (error) {
      state.draftError = error?.message || String(error)
      toast(`草案起草失败: ${state.draftError}`, 'error')
      return false
    } finally {
      state.busy = false
      state.busyText = ''
      rerender()
    }
  }

  async function continueCreateSetup() {
    if (draftPromptNeedsRefresh(state)) {
      const drafted = await applyDraftPrompt()
      if (!drafted) return
    }

    const createPayload = getCreatePayload({ requireId: true })
    if (!createPayload) return
    state.previewError = ''
    state.step = questionStepIndex(state.mode)
    rerender()
  }

  async function analyzeCurrentState() {
    try {
      if (isConfigureModeMissingTarget(state)) {
        toast('请先从 Agent 列表中选择一个现有 Agent，再进入 AI 配置。', 'warning')
        return
      }
      state.busy = true
      state.busyText = '正在读取 workspace 并调用外部模型分析当前设定...'
      state.previewError = ''
      rerender()

      const preview = await api.previewAgentWorkspaceGeneration({
        mode: 'configure',
        agentId: state.agent?.id || null,
        sourceScope: state.sourceScope,
      })
      state.sources = preview.sources || []

      const prompts = buildAnalysisPrompts({
        mode: 'configure',
        targetLabel: state.agent?.id || 'Agent',
        sourceScope: sourceScopeLabel(state.sourceScope),
        sources: state.sources,
      })

      const result = await runStructuredAssistantTask({
        config: assistantConfig,
        systemPrompt: prompts.systemPrompt,
        userPrompt: prompts.userPrompt,
        timeoutMs: 45000,
      })

      state.analysis = result.json
      state.adaptiveQuestions = normalizeAdaptiveQuestions(result.json?.adaptiveQuestions || [])
      state.answers = mergeQuestionnaireAnswers(
        prefs.questionnaireDefaults || {},
        result.json?.recommendedDefaults || {},
      )
      refreshQualityHint(state)
      await writeWizardPrefs({
        lastSourceScope: state.sourceScope,
        lastModelQualityHint: state.qualityHint?.level || 'unknown',
      })
      state.step = questionStepIndex(state.mode)
    } catch (error) {
      toast(`分析失败: ${error?.message || error}`, 'error')
    } finally {
      state.busy = false
      state.busyText = ''
      rerender()
    }
  }

  async function generatePreview() {
    try {
      const questionStep = questionStepIndex(state.mode)
      const previewStep = previewStepIndex(state.mode)
      const createPayload = state.mode === 'create' ? getCreatePayload({ requireId: true }) : null
      if (state.mode === 'configure' && isConfigureModeMissingTarget(state)) {
        toast('当前没有可生成预览的目标 Agent，请返回 Agent 列表重新进入。', 'warning')
        return
      }
      if (state.mode === 'create' && !createPayload) return
      if (wantsSubAgent(state.answers.needsSubAgent)) {
        if (!state.answers.subAgentId || !state.answers.subAgentName) {
          toast('已选择创建子 Agent，请先补全子 Agent ID 和展示名', 'warning')
          return
        }
        const primaryAgentId = state.mode === 'create' ? createPayload?.agentId : state.agent?.id
        if (primaryAgentId && state.answers.subAgentId === primaryAgentId) {
          toast('子 Agent ID 不能与当前主 Agent ID 相同', 'warning')
          return
        }
      }
      if (state.step !== questionStep && state.step !== previewStep) {
        state.step = questionStep
      }

      state.step = previewStep
      state.busy = true
      state.busyText = '正在生成设定草案...'
      state.previewError = ''
      state.preview = null
      rerender()

      if (state.mode === 'create') {
        await loadCreateReferenceSources()
      }

      const prompts = buildGenerationPrompts({
        mode: state.mode,
        targetLabel: state.mode === 'create'
          ? (createPayload?.name || createPayload?.agentId)
          : (state.agent?.id || 'Agent'),
        targetAgentId: state.mode === 'create' ? createPayload?.agentId : state.agent?.id,
        parentAgentId: state.mode === 'configure' ? state.agent?.id : (resolveValidParentAgentId(state) || null),
        sources: state.sources,
        analysis: state.analysis,
        answers: state.answers,
        availableModels: modelOptions,
      })

      const result = await runStructuredAssistantTask({
        config: assistantConfig,
        systemPrompt: prompts.systemPrompt,
        userPrompt: prompts.userPrompt,
        timeoutMs: 90000,
      })

      state.generation = normalizeGenerationOutput({
        createSpec: state.createSpec,
        agent: state.agent,
        answers: state.answers,
      }, result.json)
      state.generatedTargets = buildPreviewTargetsFromGeneration({
        mode: state.mode,
        targetAgentId: state.mode === 'create' ? createPayload?.agentId : state.agent?.id,
        createSpec: state.mode === 'create'
          ? createPayload
          : null,
        generation: state.generation,
        currentAgentId: state.mode === 'configure' ? (state.agent?.id || null) : null,
      })

      state.busyText = '正在整理写入摘要...'
      rerender()

      if (state.mode === 'create') {
        state.preview = {
          previewTargets: buildCreateModePreviewTargets(state.generatedTargets),
        }
      } else {
        state.preview = await api.previewAgentWorkspaceGeneration({
          mode: state.mode,
          agentId: state.agent?.id || null,
          createSpec: null,
          parentAgentId: null,
          sourceScope: state.sourceScope,
          // Final preview only needs diff summaries; re-sending source docs makes the
          // Tauri IPC payload much larger and can stall the modal on release builds.
          readTargetSources: false,
          readParentSources: false,
          generatedTargets: state.generatedTargets,
        })
      }
      if (!previewTargetsForState(state).length) {
        throw new Error('未生成可预览的目标文件，请调整设定后重试。')
      }
    } catch (error) {
      state.previewError = error?.message || String(error)
      toast(`生成预览失败: ${state.previewError}`, 'error')
    } finally {
      state.busy = false
      state.busyText = ''
      rerender()
    }
  }

  async function applyPreview() {
    try {
      if (!hasReadyPreview(state)) {
        toast('当前还没有可写入的预览，请先生成成功后再确认写入。', 'warning')
        return
      }
      const confirmed = await showConfirm('确认将预览内容写入 OpenClaw workspace 吗？系统会先自动备份旧文件。')
      if (!confirmed) return

      state.busy = true
      state.busyText = '正在写入 workspace 并生成备份...'
      rerender()

      const result = await api.applyAgentWorkspaceGeneration({
        generatedTargets: state.generatedTargets,
      })

      await writeWizardPrefs({
        lastSourceScope: state.sourceScope,
        lastModelQualityHint: state.qualityHint?.level || 'unknown',
        questionnaireDefaults: state.answers,
      })
      toast(`写入完成，已更新 ${result?.writtenFiles?.length || 0} 个文件`, 'success')
      closeOverlay(overlay)
      await onApplied?.(result)
    } catch (error) {
      toast(`写入失败: ${error?.message || error}`, 'error')
    }
  }

  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !state.busy) closeOverlay(overlay)
  })
  overlay.addEventListener('click', handleOverlayClick)

  rerender()
}

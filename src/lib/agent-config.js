export const AGENT_CONFIG_PANEL_KEY = 'agentConfigWizard'

export const SOURCE_SCOPE_OPTIONS = [
  { value: 'core_and_common', label: '核心文件 + 常见说明', description: '读取 IDENTITY/SOUL/AGENTS/TOOLS 等核心文件，并补充 agent.md、CLAUDE.md、README.md。' },
  { value: 'core_only', label: '只读核心文件', description: '只读取 OpenClaw 标准核心文件，范围最稳。' },
]

export const SCENARIO_TEMPLATE_OPTIONS = [
  '投资研究',
  '简历筛选',
  '旅行规划',
  '祝福文案',
  'PPT/海报设计',
  '通用办公',
  '自定义',
]

export const ROLE_OPTIONS = [
  '通用执行助手',
  '投研分析助手',
  '规划协调助手',
  '写作与文案助手',
  '招聘筛选助手',
  '视觉创意助手',
  '客户支持助手',
  '技术排障助手',
  '内容整理助手',
]

export const IDENTITY_ADJUSTMENT_OPTIONS = [
  '保持当前身份不动',
  '轻微调整职责描述',
  '明显重写身份定位',
]

export const AUDIENCE_OPTIONS = [
  '只服务操作者本人',
  '服务团队内部成员',
  '服务外部客户',
  '同时服务内部与外部',
]

export const THINKING_STYLE_OPTIONS = [
  '先给结论，再补证据',
  '先核对事实，再下结论',
  '先拆解任务，再逐步推进',
  '先问清边界，再开始执行',
  '先自检风险，再给方案',
]

export const RESPONSE_STYLE_OPTIONS = [
  '专业直接，默认简洁',
  '温和耐心，解释充分',
  '执行导向，偏短句步骤',
  '顾问型，结论和依据并重',
]

export const DETAIL_LEVEL_OPTIONS = [
  '默认简洁，必要时展开',
  '中等详细，步骤清楚',
  '尽量详细，像顾问一样',
]

export const FORBIDDEN_OPTIONS = [
  '不要擅自承诺结果',
  '不要编造未知事实',
  '不要越权执行危险操作',
  '不要跳过确认直接改关键文件',
  '不要输出与职责无关的长篇闲聊',
]

export const SKILL_USAGE_OPTIONS = [
  '优先用现有 skills，不重复手写流程',
  '先读相关文件，再决定是否用 skills',
  '缺 skill 时先降级为手动分析',
  '高风险 skills 先提醒再执行',
  '优先输出结构化建议，少给散乱信息',
]

export const SOP_OPTIONS = [
  '严格按 SOP 分步骤推进',
  '关键节点必须停下来确认',
  '遇到信息缺口先列待确认项',
  '失败后按回退步骤处理',
  '适合多轮协作和交接',
]

export const SUBAGENT_OPTIONS = [
  '不需要，单 Agent 即可',
  '需要一个专职子 Agent',
  '可能需要，先生成可扩展规则',
]

export const CREATE_WORKSPACE_MODE_OPTIONS = [
  { value: 'auto_new', label: '自动新建独立工作区', description: '按 Agent ID 自动创建默认工作区路径。' },
  { value: 'custom', label: '自定义路径（高级）', description: '仅在明确要写入非默认路径时使用。' },
]

export const AGENT_TYPE_OPTIONS = [
  '研究型 Agent',
  '执行型 Agent',
  '规划型 Agent',
  '写作型 Agent',
  '视觉设计型 Agent',
  '客服型 Agent',
  '排障型 Agent',
  '内容整理型 Agent',
]

export const SUBAGENT_TYPE_OPTIONS = [
  '研究型子 Agent',
  '执行型子 Agent',
  '规划型子 Agent',
  '写作型子 Agent',
  '视觉设计型子 Agent',
  '客服型子 Agent',
  '排障型子 Agent',
  '内容整理型子 Agent',
]

export const COLLABORATION_OPTIONS = [
  '主 Agent 分派，子 Agent 完成后回交',
  '子 Agent 先草拟，主 Agent 统一把关',
  '子 Agent 只处理固定子流程',
]

export const INHERIT_OPTIONS = [
  '继承整体世界观和协作规则',
  '只继承语气和价值观',
  '只继承工作流，不继承语气',
  '完全独立生成',
]

export const REQUIRED_AGENT_OUTPUT_FILES = ['IDENTITY.md', 'SOUL.md', 'AGENTS.md', 'TOOLS.md']

const SOURCE_DOC_FILE_CHAR_LIMIT = 6000
const SOURCE_DOC_TOTAL_CHAR_LIMIT = 24000
const SOURCE_DOC_TRUNCATION_NOTICE = '\n\n[内容已截断，仅保留前文以控制预览和提示词体积。]'

export function getWizardStepLabels(mode = 'configure') {
  return mode === 'create'
    ? ['创建信息', '问答', '预览']
    : ['准备', '分析', '问答', '预览']
}

export function createDefaultCreateSpec(model = '') {
  return {
    agentId: '',
    name: '',
    model: model || '',
    workspaceMode: 'auto_new',
    workspace: '',
    draftPrompt: '',
  }
}

export function sanitizeAgentIdSuggestion(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 64)
}

export function buildCreateSpecPayload(createSpec = {}) {
  const workspaceMode = createSpec?.workspaceMode === 'custom' ? 'custom' : 'auto_new'
  const payload = {
    agentId: String(createSpec?.agentId || '').trim(),
    name: String(createSpec?.name || '').trim(),
    model: String(createSpec?.model || '').trim(),
    workspaceMode,
    draftPrompt: String(createSpec?.draftPrompt || '').trim(),
  }
  if (workspaceMode === 'custom') {
    const workspace = String(createSpec?.workspace || '').trim()
    if (workspace) payload.workspace = workspace
  }
  return payload
}

export function resolveCreateWorkspaceDisplayPath(createSpec = {}) {
  const payload = buildCreateSpecPayload(createSpec)
  if (payload.workspaceMode === 'custom' && payload.workspace) return payload.workspace
  return `~/.openclaw/agents/${payload.agentId || '<agentId>'}/workspace`
}

export function defaultQuestionnaireAnswers() {
  return {
    scenarioTemplate: '通用办公',
    customScenario: '',
    agentType: AGENT_TYPE_OPTIONS[0],
    identityAdjustment: IDENTITY_ADJUSTMENT_OPTIONS[0],
    primaryRole: ROLE_OPTIONS[0],
    targetAudience: AUDIENCE_OPTIONS[0],
    thinkingStyle: THINKING_STYLE_OPTIONS[0],
    responseStyle: RESPONSE_STYLE_OPTIONS[0],
    detailLevel: DETAIL_LEVEL_OPTIONS[0],
    forbidden: [...FORBIDDEN_OPTIONS.slice(0, 3)],
    skillPreferences: [...SKILL_USAGE_OPTIONS.slice(0, 3)],
    sopPreference: SOP_OPTIONS[0],
    needsSubAgent: SUBAGENT_OPTIONS[0],
    customNotes: '',
    subAgentType: SUBAGENT_TYPE_OPTIONS[0],
    subAgentName: '',
    subAgentId: '',
    subAgentModel: '',
    collaborationMode: COLLABORATION_OPTIONS[0],
    inheritStrategy: INHERIT_OPTIONS[0],
  }
}

export function resolveScenarioLabel(answers = {}) {
  const scenarioTemplate = String(answers?.scenarioTemplate || '').trim()
  if (scenarioTemplate === '自定义') {
    return String(answers?.customScenario || '').trim() || '自定义业务场景'
  }
  return scenarioTemplate || '通用办公'
}

export function wantsSubAgent(value) {
  const text = String(value || '').trim()
  return text.includes('需要一个专职子 Agent')
}

function normalizeLegacyAgentType(value = '') {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (AGENT_TYPE_OPTIONS.includes(raw)) return raw
  const legacyMapped = raw.replace('子 Agent', ' Agent').replace('子Agent', ' Agent')
  return AGENT_TYPE_OPTIONS.includes(legacyMapped) ? legacyMapped : ''
}

function pickQuestionsById(questions = [], ids = []) {
  return ids
    .map(id => questions.find(item => item.id === id))
    .filter(Boolean)
}

export function buildFixedQuestionnaire(mode = 'configure', answers = {}) {
  const questions = mode === 'create'
    ? [
        { id: 'agentType', label: '新 Agent 类型', type: 'single', options: AGENT_TYPE_OPTIONS },
        { id: 'scenarioTemplate', label: '业务场景模板', type: 'single', options: SCENARIO_TEMPLATE_OPTIONS },
        { id: 'primaryRole', label: 'Agent 主职责', type: 'single', options: ROLE_OPTIONS },
        { id: 'targetAudience', label: '主要服务对象', type: 'single', options: AUDIENCE_OPTIONS },
        { id: 'responseStyle', label: '回答风格', type: 'single', options: RESPONSE_STYLE_OPTIONS },
        { id: 'needsSubAgent', label: '是否需要子 Agent', type: 'single', options: SUBAGENT_OPTIONS },
        { id: 'thinkingStyle', label: '思维习惯', type: 'single', options: THINKING_STYLE_OPTIONS },
        { id: 'detailLevel', label: '详细度', type: 'single', options: DETAIL_LEVEL_OPTIONS },
        { id: 'forbidden', label: '禁止事项 / 边界', type: 'multiple', options: FORBIDDEN_OPTIONS },
        { id: 'skillPreferences', label: 'skills 使用方式', type: 'multiple', options: SKILL_USAGE_OPTIONS },
        { id: 'sopPreference', label: 'SOP 约束', type: 'single', options: SOP_OPTIONS },
        { id: 'customNotes', label: '补充说明', type: 'text', placeholder: '只在上面覆盖不到时补充，留空也可以。' },
      ]
    : [
        { id: 'identityAdjustment', label: '是否调整当前身份', type: 'single', options: IDENTITY_ADJUSTMENT_OPTIONS },
        { id: 'scenarioTemplate', label: '业务场景模板', type: 'single', options: SCENARIO_TEMPLATE_OPTIONS },
        { id: 'primaryRole', label: 'Agent 主职责', type: 'single', options: ROLE_OPTIONS },
        { id: 'targetAudience', label: '主要服务对象', type: 'single', options: AUDIENCE_OPTIONS },
        { id: 'responseStyle', label: '回答风格', type: 'single', options: RESPONSE_STYLE_OPTIONS },
        { id: 'detailLevel', label: '详细度', type: 'single', options: DETAIL_LEVEL_OPTIONS },
        { id: 'needsSubAgent', label: '是否需要子 Agent', type: 'single', options: SUBAGENT_OPTIONS },
        { id: 'thinkingStyle', label: '思维习惯', type: 'single', options: THINKING_STYLE_OPTIONS },
        { id: 'forbidden', label: '禁止事项 / 边界', type: 'multiple', options: FORBIDDEN_OPTIONS },
        { id: 'skillPreferences', label: 'skills 使用方式', type: 'multiple', options: SKILL_USAGE_OPTIONS },
        { id: 'sopPreference', label: 'SOP 约束', type: 'single', options: SOP_OPTIONS },
        { id: 'customNotes', label: '补充说明', type: 'text', placeholder: '只在上面覆盖不到时补充，留空也可以。' },
      ]
  if (answers?.scenarioTemplate === '自定义') {
    const scenarioIndex = questions.findIndex(item => item.id === 'scenarioTemplate')
    questions.splice(scenarioIndex + 1, 0, {
      id: 'customScenario',
      label: '自定义业务场景',
      type: 'text',
      placeholder: '例如：会议纪要整理、签证材料准备、活动海报创意等',
    })
  }
  return questions
}

export function buildSubAgentQuestions() {
  return [
    { id: 'subAgentType', label: '子 Agent 类型', type: 'single', options: SUBAGENT_TYPE_OPTIONS },
    { id: 'collaborationMode', label: '协作方式', type: 'single', options: COLLABORATION_OPTIONS },
    { id: 'inheritStrategy', label: '继承策略', type: 'single', options: INHERIT_OPTIONS },
    { id: 'subAgentName', label: '子 Agent 展示名', type: 'text', placeholder: '例如：尽调研究助手' },
    { id: 'subAgentId', label: '子 Agent ID', type: 'text', placeholder: '例如：dd_researcher' },
    { id: 'subAgentModel', label: '子 Agent 主模型', type: 'text', placeholder: '例如：openai/gpt-5-mini' },
  ]
}

export function buildQuestionnaireSections(mode = 'configure', answers = {}, adaptiveQuestions = []) {
  const fixed = buildFixedQuestionnaire(mode, answers)
  const scenarioIds = fixed.some(item => item.id === 'customScenario')
    ? ['scenarioTemplate', 'customScenario']
    : ['scenarioTemplate']
  const wantsSubAgent = String(answers?.needsSubAgent || '').includes('需要一个专职子 Agent')
  const sections = []

  if (mode === 'create') {
    sections.push({
      id: 'core',
      title: '核心设定',
      description: '先决定 Agent 的定位、服务对象和默认输出方式。',
      questions: pickQuestionsById(fixed, ['agentType', ...scenarioIds, 'primaryRole', 'targetAudience', 'responseStyle', 'needsSubAgent']),
    })
  } else {
    sections.push({
      id: 'core',
      title: '基础调整',
      description: '先明确要保留什么，再补充新的角色和场景。',
      questions: pickQuestionsById(fixed, ['identityAdjustment', ...scenarioIds, 'primaryRole', 'targetAudience', 'responseStyle', 'detailLevel', 'needsSubAgent']),
    })
  }

  if (adaptiveQuestions.length) {
    sections.push({
      id: 'adaptive',
      title: '补充确认',
      description: '这些问题来自文档分析结果，用来补足缺口或消除冲突。',
      questions: adaptiveQuestions,
    })
  }

  if (wantsSubAgent) {
    sections.push({
      id: 'subagent',
      title: '子 Agent 设定',
      description: '只在确实需要拆分职责时填写，主 Agent 会在预览中同步更新协作规则。',
      questions: buildSubAgentQuestions(),
    })
  }

  sections.push({
    id: 'advanced',
    title: '高级设定',
    description: '想细化思维方式、边界和 SOP 时再展开。',
    collapsible: true,
    defaultExpanded: false,
    questions: pickQuestionsById(
      fixed,
      mode === 'create'
        ? ['thinkingStyle', 'detailLevel', 'forbidden', 'skillPreferences', 'sopPreference', 'customNotes']
        : ['thinkingStyle', 'forbidden', 'skillPreferences', 'sopPreference', 'customNotes'],
    ),
  })

  return sections.filter(section => Array.isArray(section.questions) && section.questions.length)
}

export function flattenQuestionnaireSections(sections = []) {
  return sections.flatMap(section => Array.isArray(section?.questions) ? section.questions : [])
}

function truncateSourceDocumentContent(value = '', limit = SOURCE_DOC_FILE_CHAR_LIMIT) {
  const text = String(value || '')
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : SOURCE_DOC_FILE_CHAR_LIMIT
  if (text.length <= safeLimit) return text
  if (safeLimit <= SOURCE_DOC_TRUNCATION_NOTICE.length) {
    return text.slice(0, safeLimit)
  }
  return `${text.slice(0, safeLimit - SOURCE_DOC_TRUNCATION_NOTICE.length)}${SOURCE_DOC_TRUNCATION_NOTICE}`
}

export function formatSourceDocuments(sources = [], options = {}) {
  const perFileCharLimit = Number.isFinite(options?.perFileCharLimit) && options.perFileCharLimit > 0
    ? Math.floor(options.perFileCharLimit)
    : SOURCE_DOC_FILE_CHAR_LIMIT
  const totalCharLimit = Number.isFinite(options?.totalCharLimit) && options.totalCharLimit > 0
    ? Math.floor(options.totalCharLimit)
    : SOURCE_DOC_TOTAL_CHAR_LIMIT

  let remainingChars = totalCharLimit
  let omittedCount = 0
  const sections = []

  for (const item of sources) {
    if (!item || !item.exists || !item.content) continue
    if (remainingChars <= 0) {
      omittedCount += 1
      continue
    }
    const allowedChars = Math.max(1, Math.min(perFileCharLimit, remainingChars))
    const content = truncateSourceDocumentContent(item.content, allowedChars)
    sections.push(`## ${item.name}\n${content}`)
    remainingChars -= content.length
  }

  if (omittedCount > 0) {
    sections.push(`（其余 ${omittedCount} 份文档已省略，以避免提示词过长。）`)
  }

  return sections.join('\n\n').trim()
}

export function mergeQuestionnaireAnswers(base = {}, overrides = {}) {
  const defaults = defaultQuestionnaireAnswers()
  const normalizedBase = { ...base }
  const normalizedOverrides = { ...overrides }
  if (!normalizedBase.agentType && typeof normalizedBase.subAgentType === 'string') {
    normalizedBase.agentType = normalizeLegacyAgentType(normalizedBase.subAgentType)
  }
  if (!normalizedOverrides.agentType && typeof normalizedOverrides.subAgentType === 'string') {
    normalizedOverrides.agentType = normalizeLegacyAgentType(normalizedOverrides.subAgentType)
  }
  if (!normalizedBase.skillPreferences && Array.isArray(normalizedBase.toolPreferences)) {
    normalizedBase.skillPreferences = normalizedBase.toolPreferences
  }
  if (!normalizedOverrides.skillPreferences && Array.isArray(normalizedOverrides.toolPreferences)) {
    normalizedOverrides.skillPreferences = normalizedOverrides.toolPreferences
  }
  if (!normalizedBase.sopPreference && normalizedBase.workflowPreference) {
    normalizedBase.sopPreference = normalizedBase.workflowPreference
  }
  if (!normalizedOverrides.sopPreference && normalizedOverrides.workflowPreference) {
    normalizedOverrides.sopPreference = normalizedOverrides.workflowPreference
  }
  if (!normalizedBase.responseStyle && normalizedBase.tone) {
    normalizedBase.responseStyle = normalizedBase.tone
  }
  if (!normalizedOverrides.responseStyle && normalizedOverrides.tone) {
    normalizedOverrides.responseStyle = normalizedOverrides.tone
  }
  const merged = { ...defaults, ...normalizedBase, ...normalizedOverrides }
  if (!Array.isArray(merged.forbidden)) merged.forbidden = [...defaults.forbidden]
  if (!Array.isArray(merged.skillPreferences)) merged.skillPreferences = [...defaults.skillPreferences]
  if (!SCENARIO_TEMPLATE_OPTIONS.includes(merged.scenarioTemplate)) merged.scenarioTemplate = defaults.scenarioTemplate
  if (typeof merged.customScenario !== 'string') merged.customScenario = defaults.customScenario
  if (!AGENT_TYPE_OPTIONS.includes(merged.agentType)) merged.agentType = defaults.agentType
  return merged
}

export function compactQuestionnairePatchForMerge(patch = {}) {
  const compacted = {}
  for (const [key, value] of Object.entries(patch || {})) {
    if (value == null) continue
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) compacted[key] = trimmed
      continue
    }
    if (Array.isArray(value)) {
      const cleaned = value
        .map(item => String(item ?? '').trim())
        .filter(Boolean)
      if (cleaned.length) compacted[key] = cleaned
      continue
    }
    compacted[key] = value
  }
  return compacted
}

export function mergeCreateDraftIntoState({
  createSpec = {},
  answers = {},
  parentAgentId = '',
  draft = {},
  availableModels = [],
  availableAgentIds = [],
} = {}) {
  const nextCreateSpec = {
    ...createDefaultCreateSpec(),
    ...createSpec,
  }
  const currentParentAgentId = String(parentAgentId || '').trim()
  const allowedParentAgentIds = new Set(
    (Array.isArray(availableAgentIds) ? availableAgentIds : [])
      .map(item => String(item || '').trim())
      .filter(Boolean),
  )
  const draftParentAgentId = String(draft?.parentAgentId || '').trim()
  const nextParentAgentId = currentParentAgentId || (
    draftParentAgentId && allowedParentAgentIds.has(draftParentAgentId)
      ? draftParentAgentId
      : ''
  )
  const draftAgentId = sanitizeAgentIdSuggestion(draft?.agentId || '')
  const draftName = String(draft?.name || '').trim()
  const draftModel = String(draft?.model || '').trim()

  if (!String(nextCreateSpec.agentId || '').trim() && draftAgentId) {
    nextCreateSpec.agentId = draftAgentId
  }
  if (!String(nextCreateSpec.name || '').trim() && draftName) {
    nextCreateSpec.name = draftName
  }
  if (
    !String(nextCreateSpec.model || '').trim()
    && draftModel
    && (!availableModels.length || availableModels.includes(draftModel))
  ) {
    nextCreateSpec.model = draftModel
  }

  const answerPatch = {}
  const textFields = [
    'scenarioTemplate',
    'customScenario',
    'agentType',
    'primaryRole',
    'targetAudience',
    'thinkingStyle',
    'responseStyle',
    'detailLevel',
    'needsSubAgent',
    'sopPreference',
    'customNotes',
    'subAgentType',
    'subAgentName',
    'subAgentId',
    'subAgentModel',
    'collaborationMode',
    'inheritStrategy',
  ]
  for (const field of textFields) {
    const value = String(draft?.[field] || '').trim()
    if (value) answerPatch[field] = value
  }
  if (Array.isArray(draft?.forbidden) && draft.forbidden.length) {
    answerPatch.forbidden = draft.forbidden.map(item => String(item || '').trim()).filter(Boolean)
  }
  if (Array.isArray(draft?.skillPreferences) && draft.skillPreferences.length) {
    answerPatch.skillPreferences = draft.skillPreferences.map(item => String(item || '').trim()).filter(Boolean)
  }

  return {
    createSpec: nextCreateSpec,
    answers: mergeQuestionnaireAnswers(answers, answerPatch),
    parentAgentId: nextParentAgentId,
  }
}

export function resolveWizardModeState(initialMode = 'configure', allowedModes = []) {
  const validModes = ['configure', 'create']
  const requested = Array.isArray(allowedModes) && allowedModes.length ? allowedModes : [initialMode]
  const availableModes = [...new Set(requested.filter(mode => validModes.includes(mode)))]
  const fallbackMode = validModes.includes(initialMode) ? initialMode : 'configure'
  const modes = availableModes.length ? availableModes : [fallbackMode]
  return {
    currentMode: modes.includes(initialMode) ? initialMode : modes[0],
    availableModes: modes,
    modeLocked: modes.length === 1,
  }
}

export function normalizeAdaptiveQuestions(items = []) {
  return items
    .filter(item => item && item.id && item.label)
    .slice(0, 3)
    .map((item, index) => ({
      id: String(item.id || `adaptive_${index + 1}`),
      label: String(item.label || `补充问题 ${index + 1}`),
      type: ['single', 'multiple', 'text'].includes(item.type) ? item.type : 'single',
      options: Array.isArray(item.options) ? item.options.slice(0, 6).map(option => String(option)) : [],
      placeholder: item.placeholder ? String(item.placeholder) : '',
      reason: item.reason ? String(item.reason) : '',
    }))
}

export function buildAnalysisPrompts({ mode, targetLabel, sourceScope, sources }) {
  const docs = formatSourceDocuments(sources)
  const systemPrompt = `你是 OpenClaw Agent 设定分析器。你的任务是阅读 workspace 核心文件与说明文档，提炼当前 Agent 的人格、回答风格、工具偏好、工作流规则，并识别缺口或冲突。

只返回一个 JSON 对象，不要输出 Markdown，不要解释。

JSON 结构：
{
  "summary": {
    "role": "",
    "audience": "",
    "thinkingStyle": "",
    "skillsStyle": "",
    "sopStyle": "",
    "strengths": ["..."]
  },
  "gaps": ["..."],
  "conflicts": ["..."],
  "recommendedDefaults": {
    "scenarioTemplate": "",
    "customScenario": "",
    "identityAdjustment": "",
    "primaryRole": "",
    "targetAudience": "",
    "thinkingStyle": "",
    "responseStyle": "",
    "detailLevel": "",
    "forbidden": ["..."],
    "skillPreferences": ["..."],
    "sopPreference": "",
    "needsSubAgent": "",
    "customNotes": ""
  },
  "adaptiveQuestions": [
    {
      "id": "",
      "label": "",
      "type": "single|multiple|text",
      "options": ["..."],
      "placeholder": "",
      "reason": ""
    }
  ]
}

adaptiveQuestions 最多 3 个，且仅在文档冲突、关键信息缺失、需要子 Agent 或职责边界不清时给出。`

  const userPrompt = `任务模式：${mode === 'create' ? '新建独立 Agent' : '配置现有 Agent'}
目标对象：${targetLabel}
读取范围：${sourceScope}

请分析以下 workspace 文档：

${docs || '（暂无可用文档）'}`

  return { systemPrompt, userPrompt }
}

export function buildDraftPromptPrefillPrompts({
  draftPrompt,
  parentAgentId = '',
  sources = [],
  availableModels = [],
}) {
  const docs = formatSourceDocuments(sources)
  const modelsText = availableModels.length ? availableModels.join(', ') : '（未提供模型列表）'

  const systemPrompt = `你是 OpenClaw Agent 新建向导的草案整理器。请根据用户的一段自然语言需求，提炼出适合表单预填的 Agent 设定草案。

只返回一个 JSON 对象，不要输出 Markdown，不要解释。

如果信息不明确，请返回空字符串，不要编造。
如果业务场景不在预设列表里，请设置 "scenarioTemplate": "自定义"，并把具体场景放入 "customScenario"。
如果用户没有明确提到模型，或提到的模型不在可用模型列表里，请返回空字符串。
agentId 只允许小写字母、数字、下划线和连字符；如果无法安全提炼，请返回空字符串。

允许的预设值：
- scenarioTemplate: ${SCENARIO_TEMPLATE_OPTIONS.join(' / ')}
- agentType: ${AGENT_TYPE_OPTIONS.join(' / ')}
- primaryRole: ${ROLE_OPTIONS.join(' / ')}
- targetAudience: ${AUDIENCE_OPTIONS.join(' / ')}
- responseStyle: ${RESPONSE_STYLE_OPTIONS.join(' / ')}
- thinkingStyle: ${THINKING_STYLE_OPTIONS.join(' / ')}
- detailLevel: ${DETAIL_LEVEL_OPTIONS.join(' / ')}
- needsSubAgent: ${SUBAGENT_OPTIONS.join(' / ')}

JSON 结构：
{
  "agentId": "",
  "name": "",
  "model": "",
  "scenarioTemplate": "",
  "customScenario": "",
  "agentType": "",
  "primaryRole": "",
  "targetAudience": "",
  "thinkingStyle": "",
  "responseStyle": "",
  "detailLevel": "",
  "needsSubAgent": "",
  "customNotes": "",
  "parentAgentId": ""
}`

  const userPrompt = `用户想新建一个 Agent，请提炼适合预填表单的草案。

可用模型列表：${modelsText}
当前选中的父 Agent：${parentAgentId || '无'}

如果提供了父 Agent 参考文档，请只把它作为语气、协作方式或职责拆分参考；不要把待创建 Agent 错当成现有 workspace。

父 Agent 参考文档：
${docs || '（无）'}

用户原始 prompt：
${String(draftPrompt || '').trim() || '（空）'}`

  return { systemPrompt, userPrompt }
}

export function buildConfigureConversationPrompts({
  targetLabel,
  analysis,
  currentAnswers = {},
  request = '',
  availableModels = [],
}) {
  const answerJson = JSON.stringify(currentAnswers || {}, null, 2)
  const analysisJson = JSON.stringify(analysis || {}, null, 2)
  const modelsText = availableModels.length ? availableModels.join(', ') : '（未提供模型列表）'

  const systemPrompt = `你是 OpenClaw Agent 配置聊天助手。你的任务是把用户用自然语言提出的调整意图，整理成可直接用于 Agent 设定生成的结构化答案。

只返回一个 JSON 对象，不要输出 Markdown，不要解释。

如果用户没有提到某个字段，不要返回该字段；不要擅自编造。
只有当用户明确要求删除、清空或移除某项设定时，才把对应字段返回为空字符串或空数组。
如果场景不在预设列表里，请设置 "scenarioTemplate": "自定义"，并把具体场景写入 "customScenario"。
如果用户提到模型，但不在可用模型列表中，请忽略模型字段，不要编造。

允许的预设值：
- scenarioTemplate: ${SCENARIO_TEMPLATE_OPTIONS.join(' / ')}
- identityAdjustment: ${IDENTITY_ADJUSTMENT_OPTIONS.join(' / ')}
- primaryRole: ${ROLE_OPTIONS.join(' / ')}
- targetAudience: ${AUDIENCE_OPTIONS.join(' / ')}
- responseStyle: ${RESPONSE_STYLE_OPTIONS.join(' / ')}
- thinkingStyle: ${THINKING_STYLE_OPTIONS.join(' / ')}
- detailLevel: ${DETAIL_LEVEL_OPTIONS.join(' / ')}
- needsSubAgent: ${SUBAGENT_OPTIONS.join(' / ')}

可返回的 JSON 字段：
{
  "model": "",
  "scenarioTemplate": "",
  "customScenario": "",
  "identityAdjustment": "",
  "primaryRole": "",
  "targetAudience": "",
  "thinkingStyle": "",
  "responseStyle": "",
  "detailLevel": "",
  "needsSubAgent": "",
  "customNotes": "",
  "forbidden": ["..."],
  "skillPreferences": ["..."],
  "sopPreference": "",
  "subAgentType": "",
  "subAgentName": "",
  "subAgentId": "",
  "subAgentModel": "",
  "collaborationMode": "",
  "inheritStrategy": ""
}`

  const userPrompt = `当前正在调整现有 Agent：${targetLabel}
可用模型列表：${modelsText}

当前分析摘要：
${analysisJson}

当前已整理的答案：
${answerJson}

用户刚刚提出的新要求：
${String(request || '').trim() || '（空）'}

请只提取这次要求里明确表达的变化，只返回需要合并的字段子集。`

  return { systemPrompt, userPrompt }
}

export function buildGenerationPrompts({
  mode,
  targetLabel,
  targetAgentId,
  parentAgentId,
  sources,
  analysis,
  answers,
  availableModels = [],
}) {
  const docs = formatSourceDocuments(sources)
  const answerJson = JSON.stringify(answers, null, 2)
  const analysisJson = JSON.stringify(analysis || {}, null, 2)
  const modelsText = availableModels.length ? availableModels.join(', ') : '（未提供模型列表）'
  const scenarioLabel = resolveScenarioLabel(answers)

  const systemPrompt = `你是 OpenClaw Agent 设定生成器。请根据现有 workspace 文档、分析摘要和问答结果，输出新的 Agent 设定文件。

只返回一个 JSON 对象，不要输出 Markdown，不要解释。

要求：
1. 必须生成 targetFiles.IDENTITY.md / SOUL.md / AGENTS.md / TOOLS.md 四个文件。
2. 只写适合 OpenClaw workspace 的 Markdown 内容。
3. 如果 answers.needsSubAgent 表明需要创建子 Agent，额外生成 subAgent 对象。
4. 如果生成 subAgent，必须同时给出 parentUpdates.AGENTS.md，让主 Agent 知道何时交给子 Agent。
5. 子 Agent 默认继承主 Agent 的整体世界观和协作规则，但职责、风格、工具边界和工作流要单独写。

JSON 结构：
{
  "summary": {
    "mission": "",
    "persona": "",
    "workflow": "",
    "notes": ["..."]
  },
  "target": {
    "agentId": "",
    "displayName": "",
    "files": {
      "IDENTITY.md": "",
      "SOUL.md": "",
      "AGENTS.md": "",
      "TOOLS.md": ""
    }
  },
  "subAgent": {
    "enabled": true,
    "agentId": "",
    "displayName": "",
    "model": "",
    "relationshipSummary": "",
    "files": {
      "IDENTITY.md": "",
      "SOUL.md": "",
      "AGENTS.md": "",
      "TOOLS.md": ""
    },
    "parentUpdates": {
      "AGENTS.md": ""
    }
  }
}

另外要求：
- 非投资场景是合法的一等公民。不要把简历筛选、旅行规划、祝福文案、PPT/海报设计、通用办公等场景默认改写成投研助手。
- 生成结果必须明确体现所选业务场景，尤其要在 IDENTITY.md、AGENTS.md、TOOLS.md 中写清楚该 Agent 服务什么任务、适合处理什么输入、输出什么结果。
- 如果场景依赖特定模型能力（例如更强文本推理、多模态理解、图片生成），请在 TOOLS.md 里写清楚模型前提、能力边界，以及能力缺失时如何降级处理。
- 如果 mode 是 configure 且 answers.identityAdjustment 表示“保持当前身份不动”，请尽量保留现有 IDENTITY.md，只做最小必要修改。
- 配置重心优先放在 AGENTS.md 和 TOOLS.md：思维习惯、skills 使用方式、SOP、确认点、升级/回退规则必须主要写在这两个文件里。
- SOUL.md 只做轻量风格补充，不要把所有规则都塞进 SOUL.md。

如果不需要子 Agent，请返回 "subAgent": { "enabled": false }。`

  const userPrompt = `模式：${mode === 'create' ? '新建独立 Agent' : '配置现有 Agent'}
目标 Agent：${targetLabel}
目标 Agent ID：${targetAgentId || '（待生成）'}
父 Agent：${parentAgentId || '无'}
可用模型列表：${modelsText}
业务场景：${scenarioLabel}

当前文档：
${docs || '（暂无可用文档）'}

分析摘要：
${analysisJson}

问答结果：
${answerJson}`

  return { systemPrompt, userPrompt }
}

export function normalizeGenerationOutput({
  createSpec = {},
  agent = null,
  answers = {},
} = {}, generation = {}) {
  const result = structuredClone(generation || {})
  if (!result.target) result.target = {}
  if (!result.target.files) result.target.files = {}
  result.target.agentId = result.target.agentId || createSpec.agentId || agent?.id || ''
  result.target.displayName = result.target.displayName || createSpec.name || agent?.id || 'Agent'

  for (const required of REQUIRED_AGENT_OUTPUT_FILES) {
    if (!result.target.files[required]) result.target.files[required] = `# ${required}\n\n待补充。\n`
  }

  const needSubAgent = wantsSubAgent(answers.needsSubAgent)
  if (!result.subAgent) result.subAgent = { enabled: false }
  if (needSubAgent) {
    result.subAgent.enabled = true
    result.subAgent.agentId = result.subAgent.agentId || answers.subAgentId || ''
    result.subAgent.displayName = result.subAgent.displayName || answers.subAgentName || ''
    result.subAgent.model = result.subAgent.model || answers.subAgentModel || ''
    if (!result.subAgent.files) result.subAgent.files = {}
    for (const required of REQUIRED_AGENT_OUTPUT_FILES) {
      if (!result.subAgent.files[required]) {
        result.subAgent.files[required] = `# ${required}\n\n待补充。\n`
      }
    }
    if (!result.subAgent.parentUpdates) result.subAgent.parentUpdates = {}
    if (!result.subAgent.parentUpdates['AGENTS.md']) {
      result.subAgent.parentUpdates['AGENTS.md'] = result.target.files['AGENTS.md']
    }
  } else {
    result.subAgent = { enabled: false }
  }
  return result
}

export function buildPreviewTargetsFromGeneration({
  mode,
  targetAgentId,
  createSpec,
  generation,
  currentAgentId,
}) {
  const targets = []
  const writableParentAgentId = mode === 'configure'
    ? String(currentAgentId || '').trim()
    : ''
  const primaryFiles = generation?.target?.files || {}
  if (Object.keys(primaryFiles).length > 0) {
    targets.push({
      key: 'primary',
      label: generation?.target?.displayName || targetAgentId || currentAgentId || '主 Agent',
      agentId: mode === 'create' ? null : (targetAgentId || currentAgentId || null),
      createSpec: mode === 'create' ? createSpec : null,
      files: primaryFiles,
    })
  }
  if (generation?.subAgent?.enabled && generation?.subAgent?.files) {
    targets.push({
      key: 'subagent',
      label: generation.subAgent.displayName || generation.subAgent.agentId || '子 Agent',
      agentId: null,
      createSpec: {
        agentId: generation.subAgent.agentId || '',
        name: generation.subAgent.displayName || '',
        model: generation.subAgent.model || '',
      },
      files: generation.subAgent.files,
    })
    if (generation?.subAgent?.parentUpdates?.['AGENTS.md'] && writableParentAgentId) {
      targets.push({
        key: 'parent',
        label: `父 Agent ${writableParentAgentId}`,
        agentId: writableParentAgentId,
        files: {
          'AGENTS.md': generation.subAgent.parentUpdates['AGENTS.md'],
        },
      })
    }
  }
  return targets
}

function buildPreviewExcerpt(value = '', limit = 160) {
  const compact = String(value || '').replace(/\r/g, '').replace(/\n/g, ' ').trim()
  if (compact.length <= limit) return compact
  return `${compact.slice(0, limit)}...`
}

function summarizeGeneratedFileContent(content = '') {
  const lines = String(content || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^#+\s*/, ''))
  return buildPreviewExcerpt(lines[0] || String(content || ''), 72)
}

export function buildCreateModePreviewTargets(generatedTargets = []) {
  return generatedTargets.map(target => {
    const files = target?.files || {}
    const workspace = target?.createSpec
      ? resolveCreateWorkspaceDisplayPath(target.createSpec)
      : ''

    return {
      key: target?.key || 'target',
      label: target?.label || target?.createSpec?.name || target?.createSpec?.agentId || 'Agent',
      agentId: target?.agentId || target?.createSpec?.agentId || null,
      workspace,
      exists: false,
      diffs: Object.fromEntries(
        Object.entries(files).map(([name, content]) => {
          const nextText = String(content || '')
          return [
            name,
            {
              status: 'created',
              currentExcerpt: null,
              nextExcerpt: buildPreviewExcerpt(nextText),
              currentLines: null,
              nextLines: nextText.split(/\r?\n/).length,
            },
          ]
        }),
      ),
    }
  })
}

export function buildWriteSummaryFromPreviewTargets(previewTargets = [], generatedTargets = []) {
  const generatedByKey = new Map(
    generatedTargets
      .filter(item => item?.key)
      .map(item => [item.key, item]),
  )

  const targets = previewTargets.map(target => {
    const diffs = target?.diffs || {}
    const generated = generatedByKey.get(target?.key) || {}
    const generatedFiles = generated?.files || {}
    const fileChanges = Object.entries(diffs).map(([name, diff]) => ({
      name,
      status: diff?.status || 'updated',
      summary: summarizeGeneratedFileContent(generatedFiles[name] || diff?.nextExcerpt || ''),
    }))

    return {
      key: target?.key || 'target',
      label: target?.label || target?.agentId || 'Agent',
      workspace: target?.workspace || '',
      exists: target?.exists !== false,
      backupFiles: Array.isArray(target?.backupPlan?.files) ? target.backupPlan.files : [],
      backupRoot: target?.backupPlan?.root || '',
      fileChanges,
    }
  })

  const totalFiles = targets.reduce((sum, target) => sum + target.fileChanges.length, 0)
  const createdFiles = targets.reduce((sum, target) => sum + target.fileChanges.filter(item => item.status === 'created').length, 0)
  const updatedFiles = targets.reduce((sum, target) => sum + target.fileChanges.filter(item => item.status === 'updated').length, 0)

  return {
    targets,
    totalFiles,
    createdFiles,
    updatedFiles,
    backupRoot: targets.find(item => item.backupRoot)?.backupRoot || '',
  }
}

export function buildAgentDebugPrompt({ agentId, workspacePath, configPath = '', modelPath = '' }) {
  return `请进入「现有 Agent 调试」模式，先分析，不要直接修改任何文件。

当前目标 Agent：${agentId}
Workspace 路径：${workspacePath || '未知'}
运行配置目录：${configPath || '未知'}
模型配置文件：${modelPath || '未知'}

请严格按下面顺序进行：
1. 先定位并阅读该 Agent 的 workspace 核心文件：
   - IDENTITY.md
   - SOUL.md
   - USER.md
   - AGENTS.md
   - TOOLS.md
2. 再检查常见说明文件（如果存在）：
   - agent.md
   - AGENT.md
   - CLAUDE.md
   - README.md
3. 再定位运行相关文件，优先检查：
   - agent/models.json
   - 必要时再看认证或运行时配置文件
4. 先总结文件结构，再判断问题更偏向哪一类：
   - 思维习惯问题
   - skills 配置问题
   - SOP 设计问题
   - 模型/运行配置问题
5. 最后输出：
   - 问题定位
   - 受影响文件
   - 建议下一步

注意：
- 本轮默认先分析和给建议
- 如果后续我明确要求你继续修改，再进入下一步`
}

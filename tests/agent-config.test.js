import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCreateSpecPayload,
  buildConfigureConversationPrompts,
  buildFixedQuestionnaire,
  buildDraftPromptPrefillPrompts,
  buildQuestionnaireSections,
  buildAgentDebugPrompt,
  buildCreateModePreviewTargets,
  buildGenerationPrompts,
  buildPreviewTargetsFromGeneration,
  buildWriteSummaryFromPreviewTargets,
  createDefaultCreateSpec,
  defaultQuestionnaireAnswers,
  flattenQuestionnaireSections,
  formatSourceDocuments,
  getWizardStepLabels,
  compactQuestionnairePatchForMerge,
  mergeCreateDraftIntoState,
  mergeQuestionnaireAnswers,
  normalizeAdaptiveQuestions,
  normalizeGenerationOutput,
  resolveCreateWorkspaceDisplayPath,
  resolveWizardModeState,
} from '../src/lib/agent-config.js'
import {
  buildAgentTemplateTargets,
  buildTemplateSkillStatus,
  listAgentTemplates,
} from '../src/lib/agent-templates.js'
import { assessAssistantModelQuality } from '../src/lib/assistant-provider.js'

test('create-mode questionnaire uses dedicated agentType question and removes identity adjustment', () => {
  const questions = buildFixedQuestionnaire('create')
  assert.equal(questions[0].id, 'agentType')
  assert.ok(questions.find(item => item.id === 'scenarioTemplate'))
  assert.ok(questions.find(item => item.id === 'primaryRole'))
  assert.equal(questions.some(item => item.id === 'identityAdjustment'), false)
})

test('custom scenario adds text question to questionnaire', () => {
  const questions = buildFixedQuestionnaire('configure', { scenarioTemplate: '自定义' })
  assert.ok(questions.find(item => item.id === 'scenarioTemplate'))
  assert.ok(questions.find(item => item.id === 'customScenario'))
})

test('create-mode sections keep sub-agent questions isolated without duplicate ids', () => {
  const answers = defaultQuestionnaireAnswers()
  answers.needsSubAgent = '需要一个专职子 Agent'
  const sections = buildQuestionnaireSections('create', answers)
  const ids = flattenQuestionnaireSections(sections).map(item => item.id)

  assert.ok(ids.includes('agentType'))
  assert.equal(ids.some(id => id === 'identityAdjustment'), false)
  assert.equal(ids.filter(id => id === 'subAgentType').length, 1)
  assert.equal(new Set(ids).size, ids.length)
})

test('expandable-only sub-agent choice does not force dedicated sub-agent questions', () => {
  const answers = defaultQuestionnaireAnswers()
  answers.needsSubAgent = '可能需要，先生成可扩展规则'
  const sections = buildQuestionnaireSections('create', answers)
  const ids = flattenQuestionnaireSections(sections).map(item => item.id)

  assert.equal(ids.includes('subAgentType'), false)
  assert.equal(ids.includes('subAgentId'), false)
})

test('adaptive questions are sanitized and capped at three items', () => {
  const normalized = normalizeAdaptiveQuestions([
    { id: 'a', label: 'A', type: 'single', options: ['1', '2'] },
    { id: 'b', label: 'B', type: 'multiple', options: ['x'] },
    { id: 'c', label: 'C', type: 'text', placeholder: 'fill' },
    { id: 'd', label: 'D', type: 'single', options: ['overflow'] },
  ])

  assert.equal(normalized.length, 3)
  assert.equal(normalized[0].id, 'a')
  assert.equal(normalized[1].type, 'multiple')
  assert.equal(normalized[2].placeholder, 'fill')
})

test('source document formatting truncates oversized content and caps total size', () => {
  const docs = formatSourceDocuments([
    { name: 'AGENTS.md', exists: true, content: `A${'x'.repeat(80)}` },
    { name: 'README.md', exists: true, content: `B${'y'.repeat(80)}` },
    { name: 'SOUL.md', exists: true, content: `C${'z'.repeat(80)}` },
  ], {
    perFileCharLimit: 40,
    totalCharLimit: 80,
  })

  assert.match(docs, /内容已截断/)
  assert.match(docs, /其余 1 份文档已省略/)
  assert.ok(docs.includes('## AGENTS.md'))
  assert.ok(docs.includes('## README.md'))
  assert.equal(docs.includes('## SOUL.md'), false)
})

test('preview targets include parent update when sub-agent is enabled', () => {
  const targets = buildPreviewTargetsFromGeneration({
    mode: 'configure',
    targetAgentId: 'main',
    createSpec: null,
    currentAgentId: 'main',
    generation: {
      target: {
        displayName: '主助手',
        files: {
          'IDENTITY.md': 'identity',
          'SOUL.md': 'soul',
          'AGENTS.md': 'agents',
          'TOOLS.md': 'tools',
        },
      },
      subAgent: {
        enabled: true,
        agentId: 'researcher',
        displayName: '研究助手',
        model: 'openai/gpt-5-mini',
        files: {
          'IDENTITY.md': 'sub identity',
          'SOUL.md': 'sub soul',
          'AGENTS.md': 'sub agents',
          'TOOLS.md': 'sub tools',
        },
        parentUpdates: {
          'AGENTS.md': 'parent agents update',
        },
      },
    },
  })

  assert.equal(targets.length, 3)
  assert.equal(targets[0].key, 'primary')
  assert.equal(targets[1].key, 'subagent')
  assert.equal(targets[2].key, 'parent')
  assert.equal(targets[2].files['AGENTS.md'], 'parent agents update')
})

test('create-mode preview keeps new primary agent on createSpec only', () => {
  const targets = buildPreviewTargetsFromGeneration({
    mode: 'create',
    targetAgentId: 'researcher',
    createSpec: {
      agentId: 'researcher',
      name: '研究助手',
      model: 'openai/gpt-5-mini',
    },
    generation: {
      target: {
        displayName: '研究助手',
        files: {
          'IDENTITY.md': 'identity',
          'SOUL.md': 'soul',
          'AGENTS.md': 'agents',
          'TOOLS.md': 'tools',
        },
      },
    },
    currentAgentId: null,
  })

  assert.equal(targets.length, 1)
  assert.equal(targets[0].key, 'primary')
  assert.equal(targets[0].agentId, null)
  assert.equal(targets[0].createSpec.agentId, 'researcher')
})

test('create-mode sub-agent preview does not write parent updates into reference agents', () => {
  const targets = buildPreviewTargetsFromGeneration({
    mode: 'create',
    targetAgentId: 'researcher',
    createSpec: {
      agentId: 'researcher',
      name: '研究助手',
      model: 'openai/gpt-5-mini',
    },
    generation: {
      target: {
        displayName: '研究助手',
        files: {
          'IDENTITY.md': 'identity',
          'SOUL.md': 'soul',
          'AGENTS.md': 'agents',
          'TOOLS.md': 'tools',
        },
      },
      subAgent: {
        enabled: true,
        agentId: 'screening_helper',
        displayName: '筛选助手',
        model: 'openai/gpt-5-mini',
        files: {
          'IDENTITY.md': 'sub identity',
          'SOUL.md': 'sub soul',
          'AGENTS.md': 'sub agents',
          'TOOLS.md': 'sub tools',
        },
        parentUpdates: {
          'AGENTS.md': 'new agent parent update',
        },
      },
    },
    currentAgentId: 'main',
  })

  assert.deepEqual(targets.map(item => item.key), ['primary', 'subagent'])
})

test('create-mode local preview shows created files without backend diff', () => {
  const previewTargets = buildCreateModePreviewTargets([
    {
      key: 'primary',
      label: '研究助手',
      createSpec: {
        agentId: 'researcher',
        name: '研究助手',
      },
      files: {
        'IDENTITY.md': '# identity\n\nnew file\n',
        'SOUL.md': '# soul\n\nnew file\n',
      },
    },
  ])

  assert.equal(previewTargets.length, 1)
  assert.equal(previewTargets[0].exists, false)
  assert.equal(previewTargets[0].workspace, '~/.openclaw/agents/researcher/workspace')
  assert.equal(previewTargets[0].diffs['IDENTITY.md'].status, 'created')
  assert.equal(previewTargets[0].diffs['IDENTITY.md'].currentExcerpt, null)
  assert.match(previewTargets[0].diffs['IDENTITY.md'].nextExcerpt, /identity/)
})

test('new sub-agent preview is created from createSpec instead of agentId', () => {
  const targets = buildPreviewTargetsFromGeneration({
    mode: 'configure',
    targetAgentId: 'main',
    createSpec: null,
    generation: {
      target: {
        displayName: '主助手',
        files: {
          'IDENTITY.md': 'identity',
          'SOUL.md': 'soul',
          'AGENTS.md': 'agents',
          'TOOLS.md': 'tools',
        },
      },
      subAgent: {
        enabled: true,
        agentId: 'researcher',
        displayName: '研究助手',
        model: 'openai/gpt-5-mini',
        files: {
          'IDENTITY.md': 'sub identity',
          'SOUL.md': 'sub soul',
          'AGENTS.md': 'sub agents',
          'TOOLS.md': 'sub tools',
        },
        parentUpdates: {
          'AGENTS.md': 'parent agents update',
        },
      },
    },
    currentAgentId: 'main',
  })

  assert.equal(targets[1].key, 'subagent')
  assert.equal(targets[1].agentId, null)
  assert.equal(targets[1].createSpec.agentId, 'researcher')
})

test('questionnaire merge keeps default arrays when overrides are malformed', () => {
  const merged = mergeQuestionnaireAnswers({}, { forbidden: 'bad-shape', skillPreferences: null })
  assert.ok(Array.isArray(merged.forbidden))
  assert.ok(Array.isArray(merged.skillPreferences))
  assert.equal(merged.scenarioTemplate, '通用办公')
})

test('questionnaire merge maps legacy subAgentType to new agentType', () => {
  const merged = mergeQuestionnaireAnswers({}, { subAgentType: '研究型子 Agent' })
  assert.equal(merged.agentType, '研究型 Agent')
})

test('wizard mode state locks to the supplied entry modes', () => {
  const createEntry = resolveWizardModeState('create', ['create'])
  assert.deepEqual(createEntry.availableModes, ['create'])
  assert.equal(createEntry.currentMode, 'create')
  assert.equal(createEntry.modeLocked, true)

  const configureEntry = resolveWizardModeState('configure', ['configure'])
  assert.deepEqual(configureEntry.availableModes, ['configure'])
  assert.equal(configureEntry.currentMode, 'configure')
  assert.equal(configureEntry.modeLocked, true)
})

test('create mode uses setup, questionnaire, preview steps without analysis step', () => {
  assert.deepEqual(getWizardStepLabels('create'), ['创建信息', '问答', '预览'])
  assert.deepEqual(getWizardStepLabels('configure'), ['准备', '分析', '问答', '预览'])
})

test('prompt draft merge keeps manually entered id name and model', () => {
  const merged = mergeCreateDraftIntoState({
    createSpec: {
      ...createDefaultCreateSpec('openai/gpt-5'),
      agentId: 'manual_id',
      name: '手动名称',
      model: 'openai/gpt-5',
    },
    answers: defaultQuestionnaireAnswers(),
    parentAgentId: '',
    draft: {
      agentId: 'Draft Agent',
      name: 'AI 草案名称',
      model: 'anthropic/claude-sonnet-4-5-20250514',
      scenarioTemplate: '旅行规划',
      primaryRole: '规划协调助手',
      responseStyle: '顾问型，结论和依据并重',
    },
    availableModels: ['openai/gpt-5', 'anthropic/claude-sonnet-4-5-20250514'],
  })

  assert.equal(merged.createSpec.agentId, 'manual_id')
  assert.equal(merged.createSpec.name, '手动名称')
  assert.equal(merged.createSpec.model, 'openai/gpt-5')
  assert.equal(merged.answers.scenarioTemplate, '旅行规划')
  assert.equal(merged.answers.primaryRole, '规划协调助手')
})

test('prompt draft merge ignores unknown parent agents from model output', () => {
  const merged = mergeCreateDraftIntoState({
    createSpec: createDefaultCreateSpec('openai/gpt-5'),
    answers: defaultQuestionnaireAnswers(),
    parentAgentId: '',
    draft: {
      agentId: 'screening_agent',
      parentAgentId: 'ghost_parent',
    },
    availableModels: ['openai/gpt-5'],
    availableAgentIds: ['main', 'ops_helper'],
  })

  assert.equal(merged.parentAgentId, '')
})

test('auto_new create workspace keeps default path and omits custom workspace in payload', () => {
  const createSpec = {
    ...createDefaultCreateSpec('openai/gpt-5-mini'),
    agentId: 'researcher',
    workspaceMode: 'auto_new',
    workspace: '/tmp/custom-workspace',
  }

  const payload = buildCreateSpecPayload(createSpec)
  assert.equal(payload.workspaceMode, 'auto_new')
  assert.equal('workspace' in payload, false)
  assert.equal(resolveCreateWorkspaceDisplayPath(createSpec), '~/.openclaw/agents/researcher/workspace')
})

test('model quality hint marks strong hosted models as recommended fit', () => {
  const hint = assessAssistantModelQuality({
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5',
    apiType: 'openai-completions',
  }, {
    scenarioTemplate: '祝福文案',
  })
  assert.equal(hint.level, 'strong')
  assert.equal(hint.recommended, false)
  assert.equal(hint.scenarioNeedsStrongText, true)
  assert.match(hint.scenarioDetail, /文案/)
})

test('model quality hint warns for local lightweight models', () => {
  const hint = assessAssistantModelQuality({
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
    apiType: 'openai-completions',
  }, {
    scenarioTemplate: 'PPT/海报设计',
  })
  assert.equal(hint.level, 'weak')
  assert.equal(hint.recommended, true)
  assert.equal(hint.scenarioLevel, 'warning')
  assert.equal(hint.scenarioNeedsMultimodal, true)
  assert.equal(hint.scenarioNeedsImageGeneration, true)
  assert.match(hint.scenarioDetail, /图片生成/)
})

test('travel planning guidance highlights reasoning-oriented models', () => {
  const hint = assessAssistantModelQuality({
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-reasoner',
    apiType: 'openai-completions',
  }, {
    scenarioTemplate: '旅行规划',
  })

  assert.equal(hint.scenarioNeedsReasoning, true)
  assert.match(hint.scenarioDetail, /行程|预算|路线/)
})

test('generation prompts carry non-investment scenario and model-boundary instructions', () => {
  const prompts = buildGenerationPrompts({
    mode: 'create',
    targetLabel: '旅行规划助手',
    targetAgentId: 'travel_planner',
    parentAgentId: null,
    sources: [],
    analysis: { summary: { role: '规划协调助手' } },
    answers: {
      scenarioTemplate: '旅行规划',
      customScenario: '',
      primaryRole: '规划协调助手',
      needsSubAgent: '不需要，单 Agent 即可',
    },
    availableModels: ['openai/gpt-5', 'anthropic/claude-sonnet-4-5-20250514'],
  })

  assert.match(prompts.systemPrompt, /非投资场景是合法的一等公民/)
  assert.match(prompts.systemPrompt, /TOOLS\.md/)
  assert.match(prompts.userPrompt, /业务场景：旅行规划/)
  assert.doesNotMatch(prompts.userPrompt, /投研助手/)
})

test('draft prompt prefill prompts keep parent-agent context without treating target as existing workspace', () => {
  const prompts = buildDraftPromptPrefillPrompts({
    draftPrompt: '帮我做招聘初筛，输出推荐等级和风险提醒',
    parentAgentId: 'main',
    sources: [{ name: 'AGENTS.md', exists: true, content: '父 Agent 负责分派招聘相关任务。' }],
    availableModels: ['openai/gpt-5'],
  })

  assert.match(prompts.systemPrompt, /OpenClaw Agent 新建向导的草案整理器/)
  assert.match(prompts.userPrompt, /当前选中的父 Agent：main/)
  assert.match(prompts.userPrompt, /不要把待创建 Agent 错当成现有 workspace/)
  assert.match(prompts.userPrompt, /招聘初筛/)
})

test('generation prompts preserve custom scenario labels', () => {
  const prompts = buildGenerationPrompts({
    mode: 'create',
    targetLabel: '海报助手',
    targetAgentId: 'poster_helper',
    parentAgentId: null,
    sources: [],
    analysis: {},
    answers: {
      scenarioTemplate: '自定义',
      customScenario: '活动海报创意',
      needsSubAgent: '不需要，单 Agent 即可',
    },
    availableModels: [],
  })

  assert.match(prompts.userPrompt, /业务场景：活动海报创意/)
})

test('agent debug prompt pins workspace and config file targets before analysis', () => {
  const prompt = buildAgentDebugPrompt({
    agentId: 'researcher',
    workspacePath: '~/.openclaw/agents/researcher/workspace',
    configPath: '~/.openclaw/agents/researcher/agent',
    modelPath: '~/.openclaw/agents/researcher/agent/models.json',
  })

  assert.match(prompt, /不要直接修改任何文件/)
  assert.match(prompt, /IDENTITY\.md/)
  assert.match(prompt, /models\.json/)
  assert.match(prompt, /先分析和给建议/)
})

test('normalize generation output fills required files and sub-agent defaults', () => {
  const normalized = normalizeGenerationOutput({
    createSpec: {
      agentId: 'travel_helper',
      name: '旅行助手',
    },
    answers: {
      needsSubAgent: '需要一个专职子 Agent',
      subAgentId: 'booking_helper',
      subAgentName: '预订助手',
      subAgentModel: 'openai/gpt-5-mini',
    },
  }, {
    target: {
      files: {
        'IDENTITY.md': '# IDENTITY\n',
      },
    },
    subAgent: {
      enabled: true,
      files: {
        'TOOLS.md': '# TOOLS\n',
      },
    },
  })

  assert.equal(normalized.target.agentId, 'travel_helper')
  assert.equal(normalized.target.displayName, '旅行助手')
  assert.ok(normalized.target.files['AGENTS.md'])
  assert.equal(normalized.subAgent.enabled, true)
  assert.equal(normalized.subAgent.agentId, 'booking_helper')
  assert.equal(normalized.subAgent.displayName, '预订助手')
  assert.equal(normalized.subAgent.model, 'openai/gpt-5-mini')
  assert.ok(normalized.subAgent.files['IDENTITY.md'])
  assert.equal(normalized.subAgent.parentUpdates['AGENTS.md'], normalized.target.files['AGENTS.md'])
})

test('write summary compacts preview targets into confirmation-friendly cards', () => {
  const summary = buildWriteSummaryFromPreviewTargets([
    {
      key: 'primary',
      label: '旅行助手',
      workspace: '~/.openclaw/agents/travel_helper/workspace',
      exists: true,
      backupPlan: {
        files: ['AGENTS.md'],
        root: '/tmp/backup',
      },
      diffs: {
        'AGENTS.md': {
          status: 'updated',
          nextExcerpt: '新的 SOP 摘要',
        },
        'TOOLS.md': {
          status: 'created',
          nextExcerpt: '新的工具规则',
        },
      },
    },
  ], [
    {
      key: 'primary',
      files: {
        'AGENTS.md': '# 运行规则\n\n更新后的旅行 SOP',
        'TOOLS.md': '# 工具与能力边界\n\n更新后的工具规则',
      },
    },
  ])

  assert.equal(summary.totalFiles, 2)
  assert.equal(summary.createdFiles, 1)
  assert.equal(summary.updatedFiles, 1)
  assert.equal(summary.backupRoot, '/tmp/backup')
  assert.equal(summary.targets[0].exists, true)
  assert.equal(summary.targets[0].backupFiles[0], 'AGENTS.md')
  assert.match(summary.targets[0].fileChanges[0].summary, /运行规则|旅行 SOP/)
})

test('configure conversation prompts tell the model to return questionnaire patches only', () => {
  const prompts = buildConfigureConversationPrompts({
    targetLabel: 'researcher',
    analysis: {
      summary: {
        role: '投研分析助手',
      },
    },
    currentAnswers: {
      scenarioTemplate: '投研分析',
      responseStyle: '顾问型，结论和依据并重',
    },
    request: '把它调成更偏行业扫描，输出要更像合伙人 briefing。',
    availableModels: ['openai/gpt-5', 'anthropic/claude-sonnet-4-5-20250514'],
  })

  assert.match(prompts.systemPrompt, /只返回一个 JSON 对象/)
  assert.match(prompts.systemPrompt, /不要返回该字段/)
  assert.match(prompts.userPrompt, /更偏行业扫描/)
  assert.match(prompts.userPrompt, /researcher/)
  assert.match(prompts.userPrompt, /responseStyle/)
})

test('compact questionnaire patch keeps prior answers when untouched fields are blank', () => {
  const patch = compactQuestionnairePatchForMerge({
    responseStyle: ' ',
    forbidden: [],
    customNotes: '\n',
    needsSubAgent: '需要一个专职子 Agent',
    subAgentId: 'research_helper',
  })

  const merged = mergeQuestionnaireAnswers({
    responseStyle: '顾问型，结论和依据并重',
    forbidden: ['不要编造未知事实'],
  }, patch)

  assert.equal(merged.responseStyle, '顾问型，结论和依据并重')
  assert.deepEqual(merged.forbidden, ['不要编造未知事实'])
  assert.equal(merged.needsSubAgent, '需要一个专职子 Agent')
  assert.equal(merged.subAgentId, 'research_helper')
})

test('template targets generate four core files without model calls', () => {
  const result = buildAgentTemplateTargets({
    templateId: 'travel_planner',
    createSpec: {
      ...createDefaultCreateSpec('openai/gpt-5'),
      agentId: 'travel_helper',
      name: '旅行助手',
    },
  })

  assert.equal(result.template.label, '旅行规划')
  assert.equal(result.workspacePath, '~/.openclaw/agents/travel_helper/workspace')
  assert.deepEqual(
    Object.keys(result.generatedTargets[0].files).sort(),
    ['AGENTS.md', 'IDENTITY.md', 'SOUL.md', 'TOOLS.md'],
  )
  assert.equal(result.previewTargets[0].exists, false)
  assert.equal(result.previewTargets[0].diffs['AGENTS.md'].status, 'created')
})

test('template skill status distinguishes required and recommended gaps', () => {
  const template = listAgentTemplates().find(item => item.id === 'travel_planner')
  const status = buildTemplateSkillStatus(template, {
    skills: [
      { name: 'maps', eligible: true, disabled: false },
      { name: 'weather', eligible: false, disabled: false },
      { name: 'search', eligible: true, disabled: true },
    ],
  })

  assert.deepEqual(status.requiredMissing, [])
  assert.deepEqual(status.recommendedMissing, ['weather', 'search'])
})

import { OPENCLAW_KB } from './openclaw-kb.js'
import { KIMI_CODING_BASE_URL } from './model-presets.js'
import { BRAND_NAME } from './brand.js'
import { migrateAssistantStorage } from './assistant-storage.js'

const ASSISTANT_STORAGE_KEYS = migrateAssistantStorage()
export const ASSISTANT_STORAGE_KEY = ASSISTANT_STORAGE_KEYS.config
export const ASSISTANT_SESSIONS_KEY = ASSISTANT_STORAGE_KEYS.sessions
export const DEFAULT_ASSISTANT_NAME = '钳子助手'
const DEFAULT_PROMPT_PRESET = 'default'
export const DEFAULT_ASSISTANT_PERSONALITY = '专业、严谨、高效。善于提炼关键信息并给出结构化建议。'
export const DEFAULT_ASSISTANT_MODE = 'execute'

export const ASSISTANT_PRESETS = {
  default: { label: '通用模式', desc: '兼顾平台管理与常见协作任务。' },
}

export function normalizeAssistantApiType(raw) {
  const type = String(raw || '').trim()
  if (type === 'anthropic' || type === 'anthropic-messages') return 'anthropic-messages'
  if (type === 'google-gemini') return 'google-gemini'
  if (type === 'openai' || type === 'openai-completions' || type === 'openai-responses') return 'openai-completions'
  return 'openai-completions'
}

export function assistantRequiresApiKey(apiType) {
  const type = normalizeAssistantApiType(apiType)
  return type === 'anthropic-messages' || type === 'google-gemini'
}

export function loadAssistantConfig() {
  let config = null
  try {
    const raw = localStorage.getItem(ASSISTANT_STORAGE_KEY)
    config = raw ? JSON.parse(raw) : null
  } catch {
    config = null
  }
  if (!config) {
    config = {}
  }
  if (!config.assistantName) config.assistantName = DEFAULT_ASSISTANT_NAME
  if (!config.assistantPersonality) config.assistantPersonality = DEFAULT_ASSISTANT_PERSONALITY
  if (!config.tools || typeof config.tools !== 'object') {
    config.tools = { terminal: false, fileOps: false, webSearch: false }
  }
  if (!config.mode) config.mode = DEFAULT_ASSISTANT_MODE
  if (!ASSISTANT_PRESETS[config.promptPreset]) config.promptPreset = DEFAULT_PROMPT_PRESET
  config.apiType = normalizeAssistantApiType(config.apiType)
  if (config.autoRounds === undefined) config.autoRounds = 8
  if (!Array.isArray(config.knowledgeFiles)) config.knowledgeFiles = []
  return config
}

export function saveAssistantConfig(config) {
  localStorage.setItem(ASSISTANT_STORAGE_KEY, JSON.stringify(config || {}))
}

export function cleanAssistantBaseUrl(raw, apiType) {
  let base = String(raw || '').replace(/\/+$/, '')
  base = base.replace(/\/api\/chat\/?$/, '')
  base = base.replace(/\/api\/generate\/?$/, '')
  base = base.replace(/\/api\/tags\/?$/, '')
  base = base.replace(/\/api\/?$/, '')
  base = base.replace(/\/chat\/completions\/?$/, '')
  base = base.replace(/\/completions\/?$/, '')
  base = base.replace(/\/responses\/?$/, '')
  base = base.replace(/\/messages\/?$/, '')
  base = base.replace(/\/models\/?$/, '')
  const type = normalizeAssistantApiType(apiType)
  if (type === 'anthropic-messages') {
    if (!base.endsWith('/v1')) base += '/v1'
    return base
  }
  if (type === 'google-gemini') return base
  if (/:(11434)$/i.test(base) && !base.endsWith('/v1')) return `${base}/v1`
  return base
}

export function buildAssistantAuthHeaders(config, apiType = null, apiKey = null, baseUrl = null) {
  const type = normalizeAssistantApiType(apiType || config?.apiType)
  const key = apiKey || config?.apiKey || ''
  const resolvedBase = cleanAssistantBaseUrl(baseUrl || config?.baseUrl || '', type)
  if (type === 'anthropic-messages') {
    const headers = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    }
    if (key) headers['x-api-key'] = key
    if (resolvedBase.startsWith(KIMI_CODING_BASE_URL.replace(/\/+$/, ''))) {
      headers['User-Agent'] = 'claude-code/0.1.0'
    }
    return headers
  }
  const headers = { 'Content-Type': 'application/json' }
  if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

function buildAssistantIdentity(config) {
  const name = config?.assistantName || DEFAULT_ASSISTANT_NAME
  const personality = config?.assistantPersonality || DEFAULT_ASSISTANT_PERSONALITY
  const lines = [
    `你是「${name}」，${BRAND_NAME} 内置的 AI 助手。`,
    '',
    `你的性格：${personality}`,
    '',
    '你的职责：',
    `- 在 ${BRAND_NAME} / OpenClaw 场景下给出准确、可执行、可审计的建议`,
    '- 缺少信息时明确指出风险和待确认项，不要幻想数据',
    '- 优先输出结构化、可核对、可执行的结果',
  ]
  return lines.join('\n')
}

export function buildAssistantSystemPrompt(config, {
  toolDescriptions = [],
  extraInstructions = [],
  includeKnowledgeBase = true,
} = {}) {
  const lines = [buildAssistantIdentity(config)]

  if (toolDescriptions.length > 0) {
    lines.push('你当前可用的受控工具：')
    toolDescriptions.forEach(line => {
      if (line) lines.push(`- ${line}`)
    })
  }

  extraInstructions.forEach(line => {
    if (line) lines.push(line)
  })

  const kbEnabled = (config?.knowledgeFiles || []).filter(file => file?.enabled !== false && file?.content)
  if (kbEnabled.length > 0) {
    lines.push('用户自定义知识库：')
    kbEnabled.forEach(file => {
      const content = file.content.length > 5000 ? `${file.content.slice(0, 5000)}\n\n[...内容已截断]` : file.content
      lines.push(`### ${file.name}\n${content}`)
    })
  }

  if (includeKnowledgeBase) {
    lines.push(OPENCLAW_KB)
  }

  return lines.filter(Boolean).join('\n\n')
}

import { migrateAssistantStorage } from './assistant-storage.js'

const ASSISTANT_STORAGE_KEYS = migrateAssistantStorage()
const STORAGE_KEY = ASSISTANT_STORAGE_KEYS.config

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function migrateStorageKey() {
  if (!canUseStorage()) return
  migrateAssistantStorage(localStorage)
}

export function normalizeApiType(raw) {
  const type = (raw || '').trim()
  if (type === 'anthropic' || type === 'anthropic-messages') return 'anthropic-messages'
  if (type === 'google-gemini') return 'google-gemini'
  if (type === 'openai' || type === 'openai-completions' || type === 'openai-responses') return 'openai-completions'
  return 'openai-completions'
}

export function requiresApiKey(apiType) {
  const type = normalizeApiType(apiType)
  return type === 'anthropic-messages' || type === 'google-gemini'
}

export function cleanBaseUrl(raw, apiType) {
  let base = (raw || '').replace(/\/+$/, '')
  base = base.replace(/\/api\/chat\/?$/, '')
  base = base.replace(/\/api\/generate\/?$/, '')
  base = base.replace(/\/api\/tags\/?$/, '')
  base = base.replace(/\/api\/?$/, '')
  base = base.replace(/\/chat\/completions\/?$/, '')
  base = base.replace(/\/completions\/?$/, '')
  base = base.replace(/\/responses\/?$/, '')
  base = base.replace(/\/messages\/?$/, '')
  base = base.replace(/\/models\/?$/, '')
  const type = normalizeApiType(apiType)
  if (type === 'anthropic-messages') {
    if (!base.endsWith('/v1')) base += '/v1'
    return base
  }
  if (type === 'google-gemini') return base
  if (/:(11434)$/i.test(base) && !base.endsWith('/v1')) return `${base}/v1`
  return base
}

function authHeaders(apiType, apiKey, baseUrl = null) {
  const type = normalizeApiType(apiType)
  const key = apiKey || ''
  const resolvedBase = cleanBaseUrl(baseUrl || '', type)
  if (type === 'anthropic-messages') {
    const headers = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    }
    if (key) headers['x-api-key'] = key
    if (resolvedBase.includes('kimi.com') || resolvedBase.includes('moonshot')) {
      headers['User-Agent'] = 'claude-code/0.1.0'
    }
    return headers
  }
  const headers = { 'Content-Type': 'application/json' }
  if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

async function fetchWithRetry(url, options, retries = 2) {
  const delays = [800, 1800, 3500]
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(url, options)
      if (resp.ok || resp.status < 500 || i >= retries) return resp
      await new Promise(resolve => setTimeout(resolve, delays[i] || 3500))
    } catch (error) {
      if (error?.name === 'AbortError' || i >= retries) throw error
      await new Promise(resolve => setTimeout(resolve, delays[i] || 3500))
    }
  }
}

function extractTextFromOpenAIResponse(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text
  const responseOutput = Array.isArray(data?.output) ? data.output : []
  for (const item of responseOutput) {
    const contents = Array.isArray(item?.content) ? item.content : []
    for (const part of contents) {
      if (typeof part?.text === 'string' && part.text.trim()) return part.text
    }
  }
  const choices = Array.isArray(data?.choices) ? data.choices : []
  const messageContent = choices[0]?.message?.content
  if (typeof messageContent === 'string' && messageContent.trim()) return messageContent
  if (Array.isArray(messageContent)) {
    const textPart = messageContent.find(part => typeof part?.text === 'string' && part.text.trim())
    if (textPart?.text) return textPart.text
  }
  return ''
}

function extractTextFromAnthropicResponse(data) {
  const blocks = Array.isArray(data?.content) ? data.content : []
  return blocks
    .filter(block => block?.type === 'text' && typeof block?.text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim()
}

function extractTextFromGeminiResponse(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : []
  const candidate = candidates[0]
  // 检查 finish_reason：Gemini 用驼峰命名 finishReason
  const finishReason = candidate?.finishReason ?? candidate?.finish_reason ?? ''
  if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
    // SAFETY / RECITATION / OTHER 等异常终止，记录但不抛出，让调用方获取空文本
    if (typeof console !== 'undefined') {
      console.warn('[Gemini] 非正常 finishReason:', finishReason)
    }
  }
  const parts = candidate?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts
    .map(part => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim()
}

function extractUsageFromGeminiResponse(data) {
  // Gemini 使用 usageMetadata 字段，字段名与 OpenAI 不同
  const meta = data?.usageMetadata ?? {}
  return {
    prompt_tokens: meta.promptTokenCount ?? meta.prompt_token_count ?? null,
    completion_tokens: meta.candidatesTokenCount ?? meta.candidates_token_count ?? null,
    total_tokens: meta.totalTokenCount ?? meta.total_token_count ?? null,
  }
}

function buildQualityMessage(level, title, detail, recommended, extras = {}) {
  return { level, title, detail, recommended, ...extras }
}

function normalizeScenarioLabel(context = {}) {
  const scenarioTemplate = String(context?.scenarioTemplate || '').trim()
  if (scenarioTemplate === '自定义') {
    return String(context?.customScenario || '').trim() || '自定义业务场景'
  }
  return scenarioTemplate || '通用办公'
}

function buildScenarioGuidance(context = {}, qualityLevel = 'okay') {
  const scenario = normalizeScenarioLabel(context)
  const scenarioInfo = {
    scenarioLabel: scenario,
    scenarioLevel: 'info',
    scenarioTitle: '',
    scenarioDetail: '',
    scenarioCapabilities: [],
    scenarioNeedsStrongText: false,
    scenarioNeedsReasoning: false,
    scenarioNeedsMultimodal: false,
    scenarioNeedsImageGeneration: false,
  }

  if (scenario === '简历筛选') {
    scenarioInfo.scenarioTitle = '当前场景更依赖稳定的文本理解'
    scenarioInfo.scenarioDetail = '简历筛选通常需要较强的文本抽取、对比和归纳能力。建议优先配置稳定的通用强模型，避免遗漏关键信息或评价过于模板化。'
    scenarioInfo.scenarioCapabilities = ['strong_text']
    scenarioInfo.scenarioNeedsStrongText = true
    scenarioInfo.scenarioNeedsReasoning = true
  } else if (scenario === '旅行规划') {
    scenarioInfo.scenarioTitle = '当前场景更依赖规划与推理能力'
    scenarioInfo.scenarioDetail = '旅行规划通常要综合行程约束、预算、地点偏好和时间安排。建议使用较强的文本理解与推理模型，便于生成更可执行的路线和备选方案。'
    scenarioInfo.scenarioCapabilities = ['strong_text', 'reasoning']
    scenarioInfo.scenarioNeedsStrongText = true
    scenarioInfo.scenarioNeedsReasoning = true
  } else if (scenario === '祝福文案') {
    scenarioInfo.scenarioTitle = '当前场景更依赖表达质量'
    scenarioInfo.scenarioDetail = '祝福文案更看重语言风格、语气拿捏和改写能力。建议使用较强的文本模型，能明显提升文案自然度和个性化程度。'
    scenarioInfo.scenarioCapabilities = ['strong_text']
    scenarioInfo.scenarioNeedsStrongText = true
  } else if (scenario === 'PPT/海报设计') {
    scenarioInfo.scenarioTitle = '当前场景需要设计相关模型能力'
    scenarioInfo.scenarioDetail = '如果只是生成设定文案，强文本模型即可继续；但若希望 Agent 后续参与版式建议、视觉参考、图片理解或海报出图，还需要补充多模态理解能力，目标包含出图时还需配置图片生成能力。'
    scenarioInfo.scenarioCapabilities = ['strong_text', 'multimodal', 'image_generation']
    scenarioInfo.scenarioNeedsStrongText = true
    scenarioInfo.scenarioNeedsMultimodal = true
    scenarioInfo.scenarioNeedsImageGeneration = true
  } else if (scenario === '投资研究') {
    scenarioInfo.scenarioTitle = '当前场景适合保留分析型模型偏好'
    scenarioInfo.scenarioDetail = '投资研究类 Agent 更看重长文本处理、结构化分析和结论可追溯性。较强的分析模型会更稳，但这次向导不会把它当成唯一默认方向。'
    scenarioInfo.scenarioCapabilities = ['strong_text', 'reasoning']
    scenarioInfo.scenarioNeedsStrongText = true
    scenarioInfo.scenarioNeedsReasoning = true
  } else if (scenario !== '通用办公') {
    scenarioInfo.scenarioTitle = '当前场景建议确认模型能力是否匹配'
    scenarioInfo.scenarioDetail = `当前 Agent 场景是「${scenario}」。建议确认模型至少能稳定完成该场景所需的文本理解；如果后续涉及图片理解、排版或出图，再额外补充多模态或图片生成能力。`
    scenarioInfo.scenarioCapabilities = ['strong_text']
    scenarioInfo.scenarioNeedsStrongText = true
  } else {
    scenarioInfo.scenarioTitle = '当前场景采用通用办公能力'
    scenarioInfo.scenarioDetail = '通用办公类 Agent 以文本理解、整理、总结和执行协作为主。后续如果演进到设计类或图片类任务，再补充多模态或图片生成能力即可。'
    scenarioInfo.scenarioCapabilities = ['strong_text']
  }

  if (qualityLevel === 'weak' && (scenarioInfo.scenarioNeedsMultimodal || scenarioInfo.scenarioNeedsReasoning)) {
    scenarioInfo.scenarioLevel = 'warning'
    scenarioInfo.scenarioDetail += ' 当前模型更像本地或轻量模型，复杂场景下更容易出现模板化输出或能力不足。'
  } else if (qualityLevel === 'missing') {
    scenarioInfo.scenarioLevel = 'warning'
  }

  return scenarioInfo
}

export function assessAssistantModelQuality(config, context = {}) {
  if (!config?.baseUrl || !config?.model) {
    return buildQualityMessage(
      'missing',
      '未配置外部模型',
      '该向导会调用钳子助手当前接入的外部模型生成 Agent 设定。建议先在 AI 助手页接入 OpenAI 或 Anthropic 模型。',
      true,
      buildScenarioGuidance(context, 'missing'),
    )
  }

  const model = String(config.model || '').toLowerCase()
  const base = String(config.baseUrl || '').toLowerCase()
  if (/(gpt-5|gpt-4\.1|gpt-4o|o1|o3|claude-3|claude-sonnet|claude-opus|claude-4|opus|sonnet)/.test(model) || /openai|anthropic/.test(base)) {
    return buildQualityMessage(
      'strong',
      '当前模型适合做 Agent 设定生成',
      '你现在接入的模型足够强，适合生成人格、工作流和子 Agent 协作规则。',
      false,
      buildScenarioGuidance(context, 'strong'),
    )
  }
  if (/(gemini-2\.5|gemini-2\.0|deepseek-r1|deepseek-v3|qwq|kimi-k2|kimi)/.test(model)) {
    return buildQualityMessage(
      'okay',
      '当前模型可用，但强模型通常更稳',
      '可以继续生成，但如果你希望人格、风格和流程规则更准确，OpenAI / Anthropic 通常效果更好。',
      true,
      buildScenarioGuidance(context, 'okay'),
    )
  }
  if (/(llama|qwen|mistral|phi|yi|glm|local|ollama)/.test(model) || /127\.0\.0\.1|localhost|11434/.test(base)) {
    return buildQualityMessage(
      'weak',
      '当前更像本地或轻量模型',
      '可以继续，但结果可能更模板化，复杂设定和子 Agent 协作规则更容易跑偏。推荐改用 OpenAI / Anthropic 再生成首版。',
      true,
      buildScenarioGuidance(context, 'weak'),
    )
  }
  return buildQualityMessage(
    'okay',
    '当前模型可继续使用',
    '该向导可以继续运行；如果你想要更稳定的设定生成效果，OpenAI / Anthropic 往往更好。',
    true,
    buildScenarioGuidance(context, 'okay'),
  )
}

export function loadAssistantProviderConfig() {
  if (!canUseStorage()) return null
  migrateStorageKey()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    parsed.apiType = normalizeApiType(parsed.apiType)
    return parsed
  } catch {
    return null
  }
}

function extractBalancedJson(text) {
  if (!text) return null
  const trimmed = String(text).trim()
  if (!trimmed) return null
  try { return JSON.parse(trimmed) } catch {}

  const start = trimmed.search(/[\[{]/)
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') depth++
    if (ch === '}' || ch === ']') depth--
    if (depth === 0) {
      const candidate = trimmed.slice(start, i + 1)
      try { return JSON.parse(candidate) } catch {}
    }
  }
  return null
}

export function extractStructuredJson(text) {
  const json = extractBalancedJson(text)
  if (!json || Array.isArray(json) || typeof json !== 'object') {
    throw new Error('模型没有返回可解析的 JSON 对象，请尝试更强模型或稍后重试。')
  }
  return json
}

function resolveTimeoutMs(timeoutMs, fallback = 45000) {
  const value = Number(timeoutMs)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function normalizeAssistantRequestError(error, timeoutMs) {
  const message = String(error?.message || error || '').trim()
  const timeout = Math.round(resolveTimeoutMs(timeoutMs) / 1000)
  if (error?.name === 'AbortError' || /timed out|timeout|aborted/i.test(message)) {
    return new Error(`外部模型请求超时（${timeout} 秒），请切到“只读核心文件”、减少参考文档，或换更快模型后重试。`)
  }
  return error instanceof Error ? error : new Error(message || '外部模型请求失败')
}

async function callOpenAIChat(base, config, systemPrompt, userPrompt, timeoutMs = 45000) {
  const url = `${base}/chat/completions`
  const resp = await fetchWithRetry(url, {
    method: 'POST',
    headers: authHeaders(config.apiType, config.apiKey, config.baseUrl),
    body: JSON.stringify({
      model: config.model,
      temperature: 0.25,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(resolveTimeoutMs(timeoutMs)),
  })

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '')
    throw new Error(errorText || `API 错误 ${resp.status}`)
  }
  return extractTextFromOpenAIResponse(await resp.json())
}

async function callOpenAIResponses(base, config, systemPrompt, userPrompt, timeoutMs = 45000) {
  const url = `${base}/responses`
  const resp = await fetchWithRetry(url, {
    method: 'POST',
    headers: authHeaders(config.apiType, config.apiKey, config.baseUrl),
    body: JSON.stringify({
      model: config.model,
      temperature: 0.25,
      instructions: systemPrompt,
      input: [{ role: 'user', content: userPrompt }],
    }),
    signal: AbortSignal.timeout(resolveTimeoutMs(timeoutMs)),
  })

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '')
    throw new Error(errorText || `API 错误 ${resp.status}`)
  }
  return extractTextFromOpenAIResponse(await resp.json())
}

async function callAnthropic(base, config, systemPrompt, userPrompt, timeoutMs = 45000) {
  const url = `${base}/messages`
  const resp = await fetchWithRetry(url, {
    method: 'POST',
    headers: authHeaders(config.apiType, config.apiKey, config.baseUrl),
    body: JSON.stringify({
      model: config.model,
      system: systemPrompt,
      max_tokens: 4096,
      temperature: 0.25,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    signal: AbortSignal.timeout(resolveTimeoutMs(timeoutMs)),
  })

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '')
    throw new Error(errorText || `API 错误 ${resp.status}`)
  }
  return extractTextFromAnthropicResponse(await resp.json())
}

async function callGemini(base, config, systemPrompt, userPrompt, timeoutMs = 45000) {
  const url = `${base}/models/${config.model}:generateContent?key=${config.apiKey}`
  const resp = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.25 },
    }),
    signal: AbortSignal.timeout(resolveTimeoutMs(timeoutMs)),
  })

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '')
    throw new Error(errorText || `API 错误 ${resp.status}`)
  }
  const data = await resp.json()
  return {
    text: extractTextFromGeminiResponse(data),
    usage: extractUsageFromGeminiResponse(data),
  }
}

export async function runStructuredAssistantTask({ config, systemPrompt, userPrompt, timeoutMs = 45000 }) {
  const resolved = config || loadAssistantProviderConfig()
  const apiType = normalizeApiType(resolved?.apiType)
  if (!resolved?.baseUrl || !resolved?.model || (requiresApiKey(apiType) && !resolved?.apiKey)) {
    throw new Error('请先在 AI 助手页配置可用的外部模型。')
  }

  const base = cleanBaseUrl(resolved.baseUrl, apiType)
  let text = ''
  let usage = null
  try {
    if (apiType === 'anthropic-messages') {
      text = await callAnthropic(base, resolved, systemPrompt, userPrompt, timeoutMs)
    } else if (apiType === 'google-gemini') {
      const result = await callGemini(base, resolved, systemPrompt, userPrompt, timeoutMs)
      text = result.text
      usage = result.usage
    } else {
      try {
        text = await callOpenAIChat(base, resolved, systemPrompt, userPrompt, timeoutMs)
      } catch (error) {
        const message = String(error?.message || error || '')
        if (/legacy protocol|\/v1\/responses|not supported/i.test(message)) {
          text = await callOpenAIResponses(base, resolved, systemPrompt, userPrompt, timeoutMs)
        } else {
          throw error
        }
      }
    }
  } catch (error) {
    throw normalizeAssistantRequestError(error, timeoutMs)
  }

  return {
    text,
    json: extractStructuredJson(text),
    config: resolved,
    ...(usage ? { usage } : {}),
  }
}

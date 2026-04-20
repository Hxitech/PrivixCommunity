/**
 * 共享模型预设配置
 * models.js 和 assistant.js 共用，只需维护一套数据
 */

import { api } from './tauri-api.js'

/**
 * 从 OpenClaw 配置读取模型列表和主模型
 * 供 assistant / clawswarm / evoscientist 页面使用
 * @returns {{ models: Array<{provider: string, model: string, full: string}>, primary: string, providers: Object }}
 */
export async function readOpenclawModels() {
  // 使用缓存版本即可，用户刚修改配置后缓存会自动失效
  const config = await api.readOpenclawConfig()
  const providers = config?.models?.providers || {}
  const primary = config?.agents?.defaults?.model?.primary || ''
  const models = []
  for (const [providerKey, provider] of Object.entries(providers)) {
    for (const item of (provider?.models || [])) {
      const modelId = typeof item === 'string' ? item : item?.id
      if (modelId) models.push({ provider: providerKey, model: modelId, full: `${providerKey}/${modelId}` })
    }
  }
  return { models, primary, providers }
}

/**
 * 从 OpenClaw 主模型解析出 provider 和 model ID
 * @param {string} primary - 格式 "provider/modelId"
 * @returns {{ providerKey: string, modelId: string, baseUrl: string }}
 */
export function parseOpenclawPrimary(primary, providers = {}) {
  if (!primary) return null
  const slashIdx = primary.indexOf('/')
  if (slashIdx < 0) return null
  const providerKey = primary.slice(0, slashIdx)
  const modelId = primary.slice(slashIdx + 1)
  const providerConfig = providers[providerKey] || {}
  const baseUrl = providerConfig.baseUrl || ''
  return { providerKey, modelId, baseUrl }
}

/**
 * 获取 OpenClaw 主模型并解析，供各页面"从 OpenClaw 获取"按钮使用
 * @returns {{ parsed: {providerKey, modelId, baseUrl}, primary: string, providers: Object }}
 * @throws {Error} 'no-models' | 'no-primary'
 */
export async function fetchOpenclawPrimaryModel() {
  const { models, primary, providers } = await readOpenclawModels()
  if (!primary && models.length === 0) throw new Error('no-models')
  const parsed = parseOpenclawPrimary(primary, providers)
  if (!parsed) throw new Error('no-primary')
  return { parsed, primary, providers }
}

/**
 * 将 OpenClaw 的 provider key 映射为面板内部的 apiType
 * 与 providerToApiType/apiTypeToProvider 互补
 */
export function openclawProviderToApiType(providerKey) {
  if (providerKey === 'anthropic') return 'anthropic-messages'
  if (providerKey === 'google' || providerKey === 'google-genai') return 'google-gemini'
  if (providerKey === 'ollama') return 'ollama'
  return 'openai-completions'
}

// API 接口类型选项
export const API_TYPES = [
  { value: 'openai-completions', label: 'OpenAI 兼容 (最常用)' },
  { value: 'anthropic-messages', label: 'Anthropic 原生' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'google-gemini', label: 'Google Gemini' },
  { value: 'ollama', label: 'Ollama 原生' },
]

// ── provider ↔ apiType 双向映射（ClawSwarm / 一键配置共用） ──

/** EvoScientist provider 枚举 → LLM API 类型 */
export function providerToApiType(provider) {
  if (provider === 'anthropic' || provider === 'custom-anthropic') return 'anthropic-messages'
  if (provider === 'google-genai') return 'google-gemini'
  return 'openai-completions'
}

/** LLM API 类型 → EvoScientist provider 枚举（baseUrl 用于区分 custom-openai） */
export function apiTypeToProvider(apiType, baseUrl) {
  if (apiType === 'anthropic-messages') return 'anthropic'
  if (apiType === 'google-gemini') return 'google-genai'
  if (baseUrl && !baseUrl.includes('api.openai.com')) return 'custom-openai'
  return 'openai'
}

export const MOONSHOT_BASE_URL = 'https://api.moonshot.ai/v1'
export const MOONSHOT_CN_BASE_URL = 'https://api.moonshot.cn/v1'
export const MOONSHOT_DEFAULT_MODEL_ID = 'kimi-k2.5'
export const KIMI_CODING_BASE_URL = 'https://api.kimi.com/coding/v1'
export const KIMI_CODING_DEFAULT_MODEL_ID = 'k2p5'

const MOONSHOT_DEFAULT_MODELS = [
  {
    id: MOONSHOT_DEFAULT_MODEL_ID,
    name: 'Kimi K2.5',
    contextWindow: 256000,
    maxTokens: 8192,
    input: ['text'],
    reasoning: false,
  },
]

const KIMI_CODING_DEFAULT_MODELS = [
  {
    id: KIMI_CODING_DEFAULT_MODEL_ID,
    name: 'Kimi for Coding',
    contextWindow: 262144,
    maxTokens: 32768,
    input: ['text', 'image'],
    reasoning: true,
  },
]

// 服务商快捷预设
export const PROVIDER_PRESETS = [
  { key: 'shengsuanyun', label: '胜算云', baseUrl: 'https://router.shengsuanyun.com/api/v1', api: 'openai-completions', site: 'https://www.shengsuanyun.com/?from=CH_4BVI0BM2', desc: '国内知名 AI 模型聚合平台，支持多种主流模型' },
  { key: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', api: 'openai-completions', site: 'https://cloud.siliconflow.cn/i/PFrw2an5', desc: '高性价比推理平台，支持 DeepSeek、Qwen 等开源模型' },
  { key: 'volcengine', label: '火山引擎', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', api: 'openai-completions', site: 'https://volcengine.com/L/Ph1OP5I3_GY', desc: '字节跳动旗下云平台，支持豆包等模型' },
  {
    key: 'aliyun',
    groupKey: 'aliyun',
    label: '阿里云百炼 (DashScope)',
    hint: '通义千问全系列，中国 / 国际端点',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    api: 'openai-completions',
    desc: '阿里云 AI 大模型平台，支持通义千问全系列。OpenClaw 3.23+ 新增按量付费国际端点。',
    choices: [
      {
        choiceKey: 'aliyun-cn',
        label: '中国 DashScope',
        hint: '中国区端点，适合国内用户',
        providerKey: 'aliyun',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        api: 'openai-completions',
        defaultModel: 'qwen-max',
        defaultModels: [
          { id: 'qwen-max', name: 'Qwen Max', contextWindow: 32768 },
          { id: 'qwen-plus', name: 'Qwen Plus', contextWindow: 131072 },
          { id: 'qwen-turbo', name: 'Qwen Turbo', contextWindow: 131072 },
          { id: 'qwen-vl-max', name: 'Qwen VL Max', contextWindow: 32768, input: ['text', 'image'] },
          { id: 'qwen2.5-max', name: 'Qwen 2.5 Max', contextWindow: 131072 },
        ],
        signupUrl: 'https://www.aliyun.com/benefit/ai/aistar?userCode=keahn2zr&clubBiz=subTask..12435175..10263..',
        note: '百炼平台中国区，使用阿里云 API Key。',
        lockProviderKey: true,
      },
      {
        choiceKey: 'aliyun-intl',
        label: '国际 DashScope',
        hint: '国际端点，适合海外用户',
        providerKey: 'aliyun',
        baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        api: 'openai-completions',
        defaultModel: 'qwen-max',
        defaultModels: [
          { id: 'qwen-max', name: 'Qwen Max', contextWindow: 32768 },
          { id: 'qwen-plus', name: 'Qwen Plus', contextWindow: 131072 },
          { id: 'qwen-turbo', name: 'Qwen Turbo', contextWindow: 131072 },
          { id: 'qwen2.5-max', name: 'Qwen 2.5 Max', contextWindow: 131072 },
        ],
        signupUrl: 'https://www.alibabacloud.com/product/dashscope',
        note: 'DashScope 国际区按量付费，使用 Alibaba Cloud API Key。OpenClaw 3.23+ 支持。',
        lockProviderKey: true,
      },
    ],
  },
  { key: 'zhipu', label: '智谱 AI', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai-completions', site: 'https://www.bigmodel.cn/glm-coding?ic=3F6F9XYKTS', desc: '国产大模型领军企业，支持 GLM-4 全系列' },
  { key: 'minimax', label: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', api: 'openai-completions', site: 'https://platform.minimaxi.com/', desc: '国产多模态大模型，支持 MiniMax-M2.7 / M2.5 系列，兼容 OpenAI 接口' },
  {
    key: 'moonshot',
    groupKey: 'moonshot',
    label: 'Moonshot AI (Kimi K2.5)',
    hint: 'Kimi K2.5 + Kimi Coding',
    baseUrl: MOONSHOT_BASE_URL,
    api: 'openai-completions',
    desc: '对齐 OpenClaw onboarding，支持 Kimi API（.ai / .cn）与 Kimi Code 订阅版。默认只需填写 API Key。',
    choices: [
      {
        choiceKey: 'moonshot-ai',
        label: 'Kimi API key (.ai)',
        hint: '国际端点，默认模型 kimi-k2.5',
        providerKey: 'moonshot',
        baseUrl: MOONSHOT_BASE_URL,
        api: 'openai-completions',
        defaultModel: MOONSHOT_DEFAULT_MODEL_ID,
        defaultModels: MOONSHOT_DEFAULT_MODELS,
        signupUrl: 'https://platform.moonshot.ai/',
        note: '会自动补充 moonshot/kimi-k2.5，但不会自动切成当前主模型。',
        lockProviderKey: true,
      },
      {
        choiceKey: 'moonshot-cn',
        label: 'Kimi API key (.cn)',
        hint: '中国端点，默认模型 kimi-k2.5',
        providerKey: 'moonshot',
        baseUrl: MOONSHOT_CN_BASE_URL,
        api: 'openai-completions',
        defaultModel: MOONSHOT_DEFAULT_MODEL_ID,
        defaultModels: MOONSHOT_DEFAULT_MODELS,
        signupUrl: 'https://platform.moonshot.cn/',
        note: '适合直接使用 Moonshot 中国站 API。',
        lockProviderKey: true,
      },
      {
        choiceKey: 'kimi-code',
        label: 'Kimi Code API key (subscription)',
        hint: '独立订阅端点，默认模型 k2p5',
        providerKey: 'kimi-coding',
        baseUrl: KIMI_CODING_BASE_URL,
        api: 'openai-completions',
        defaultModel: KIMI_CODING_DEFAULT_MODEL_ID,
        defaultModels: KIMI_CODING_DEFAULT_MODELS,
        signupUrl: 'https://www.kimi.com/code/en',
        note: 'Kimi Code 使用独立端点和独立密钥，和 Moonshot API 不互通。',
        lockProviderKey: true,
        apiKeyPlaceholder: '输入 Kimi Code API key',
      },
    ],
  },
  { key: 'xai', label: 'xAI', baseUrl: 'https://api.x.ai/v1', api: 'openai-completions', desc: 'xAI Grok 系列模型（Responses API），支持 x_search 内置搜索' },
  { key: 'openai', label: 'OpenAI 官方', baseUrl: 'https://api.openai.com/v1', api: 'openai-completions' },
  { key: 'anthropic', label: 'Anthropic 官方', baseUrl: 'https://api.anthropic.com', api: 'anthropic-messages' },
  { key: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', api: 'openai-completions' },
  { key: 'google', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', api: 'google-gemini' },
  { key: 'nvidia', label: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', api: 'openai-completions', desc: '英伟达推理平台，支持 Llama、Mistral 等模型' },
  // v1.5 Agent Studio 新增 Provider — 对齐 AionUi 20+ 平台覆盖
  { key: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions', site: 'https://openrouter.ai', desc: '聚合平台，一套 Key 访问 300+ 模型（Claude、GPT、Gemini、Llama 等）' },
  { key: 'modelscope', label: 'ModelScope 魔搭', baseUrl: 'https://api-inference.modelscope.cn/v1', api: 'openai-completions', site: 'https://modelscope.cn', desc: '阿里达摩院 AI 模型社区，支持 Qwen、DeepSeek、Llama 等开源模型推理' },
  { key: 'stepfun', label: '阶跃星辰 StepFun', baseUrl: 'https://api.stepfun.com/v1', api: 'openai-completions', site: 'https://platform.stepfun.com', desc: '国产多模态大模型，支持 Step-2 / Step-1V 系列' },
  { key: 'lingyi', label: '零一万物 01.AI', baseUrl: 'https://api.lingyiwanwu.com/v1', api: 'openai-completions', site: 'https://platform.lingyiwanwu.com', desc: '李开复团队出品，Yi 系列模型（Yi-Lightning / Yi-Large）' },
  { key: 'tencent', label: '腾讯混元 Hunyuan', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', api: 'openai-completions', site: 'https://cloud.tencent.com/product/hunyuan', desc: '腾讯云原生大模型，OpenAI 兼容接口' },
  { key: 'baidu', label: '百度千帆 Qianfan', baseUrl: 'https://qianfan.baidubce.com/v2', api: 'openai-completions', site: 'https://qianfan.cloud.baidu.com', desc: '百度智能云大模型平台，支持文心一言 ERNIE / DeepSeek / Llama 等' },
  { key: 'poe', label: 'Poe by Quora', baseUrl: 'https://api.poe.com/v1', api: 'openai-completions', site: 'https://poe.com/api_key', desc: 'Quora 旗下模型聚合器，一个订阅访问 Claude / GPT / Gemini / 等' },
  { key: 'bedrock', label: 'AWS Bedrock', baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com', api: 'openai-completions', site: 'https://aws.amazon.com/bedrock/', desc: 'AWS 原生大模型服务（需 LiteLLM 或类似 OpenAI 兼容代理；原生 SigV4 暂未内置）' },
  { key: 'lmstudio', label: 'LM Studio (本地)', baseUrl: 'http://127.0.0.1:1234/v1', api: 'openai-completions', site: 'https://lmstudio.ai', desc: '桌面本地模型运行时，OpenAI 兼容接口（默认 1234 端口，API Key 任填）' },
  { key: 'ollama', label: 'Ollama (本地)', baseUrl: 'http://127.0.0.1:11434', api: 'ollama' },
]

// 胜算云推广配置
export const SHENGSUANYUN = {
  baseUrl: 'https://router.shengsuanyun.com/api/v1',
  site: 'https://www.shengsuanyun.com/?from=CH_4BVI0BM2',
  providerKey: 'shengsuanyun',
  brandName: '胜算云',
  api: 'openai-completions',
}

// 常用模型预设（按服务商分组）
export const MODEL_PRESETS = {
  moonshot: [
    { id: MOONSHOT_DEFAULT_MODEL_ID, name: 'Kimi K2.5', contextWindow: 256000 },
  ],
  'kimi-coding': [
    { id: KIMI_CODING_DEFAULT_MODEL_ID, name: 'Kimi for Coding', contextWindow: 262144, reasoning: true },
  ],
  openai: [
    { id: 'gpt-5.4', name: 'GPT-5.4', contextWindow: 128000 },
    { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', contextWindow: 128000 },
    { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano', contextWindow: 128000 },
    { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000 },
    { id: 'o3-mini', name: 'o3 Mini', contextWindow: 200000, reasoning: true },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-5-20250514', name: 'Claude Sonnet 4.5', contextWindow: 200000 },
    { id: 'claude-haiku-3-5-20241022', name: 'Claude Haiku 3.5', contextWindow: 200000 },
  ],
  deepseek: [
    { id: 'deepseek-chat', name: 'DeepSeek V3', contextWindow: 64000 },
    { id: 'deepseek-reasoner', name: 'DeepSeek R1', contextWindow: 64000, reasoning: true },
  ],
  google: [
    { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', contextWindow: 2000000, reasoning: true },
    { id: 'gemini-3.1-flash', name: 'Gemini 3.1 Flash', contextWindow: 1000000 },
    { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', contextWindow: 1000000 },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1000000, reasoning: true },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1000000 },
  ],
  // 阿里云百炼 — 通义千问全系列（含 Qwen 2.5）
  aliyun: [
    { id: 'qwen2.5-max', name: 'Qwen 2.5 Max', contextWindow: 131072 },
    { id: 'qwen-max', name: 'Qwen Max', contextWindow: 32768 },
    { id: 'qwen-plus', name: 'Qwen Plus', contextWindow: 131072 },
    { id: 'qwen-turbo', name: 'Qwen Turbo', contextWindow: 131072 },
    { id: 'qwen-vl-max', name: 'Qwen VL Max', contextWindow: 32768, input: ['text', 'image'] },
  ],
  // MiniMax M2.7 / M2.5 系列
  minimax: [
    { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', contextWindow: 1000000 },
    { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax M2.7 Highspeed', contextWindow: 1000000 },
    { id: 'MiniMax-M2.7-reasoning', name: 'MiniMax M2.7 Reasoning', contextWindow: 1000000, reasoning: true },
    { id: 'MiniMax-M2.5', name: 'MiniMax M2.5', contextWindow: 204000 },
    { id: 'MiniMax-M2.5-highspeed', name: 'MiniMax M2.5 Highspeed', contextWindow: 204000 },
  ],
  // xAI Grok 系列
  xai: [
    { id: 'grok-3', name: 'Grok 3', contextWindow: 131072 },
    { id: 'grok-3-fast', name: 'Grok 3 Fast', contextWindow: 131072 },
  ],
  ollama: [
    { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', contextWindow: 32768 },
    { id: 'llama3.2', name: 'Llama 3.2', contextWindow: 8192 },
    { id: 'gemma3', name: 'Gemma 3', contextWindow: 32768 },
  ],
  // v1.5 Agent Studio 新增 Provider 的默认模型
  openrouter: [
    { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5 (via OpenRouter)', contextWindow: 200000 },
    { id: 'openai/gpt-5.4', name: 'GPT-5.4 (via OpenRouter)', contextWindow: 128000 },
    { id: 'google/gemini-3.1-pro', name: 'Gemini 3.1 Pro (via OpenRouter)', contextWindow: 2000000 },
    { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', contextWindow: 131072 },
  ],
  modelscope: [
    { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen 2.5 72B Instruct', contextWindow: 131072 },
    { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', contextWindow: 64000 },
    { id: 'Qwen/Qwen2.5-Coder-32B-Instruct', name: 'Qwen 2.5 Coder 32B', contextWindow: 131072 },
  ],
  stepfun: [
    { id: 'step-2-16k', name: 'Step-2 16K', contextWindow: 16384 },
    { id: 'step-1-256k', name: 'Step-1 256K', contextWindow: 256000 },
    { id: 'step-1v-8k', name: 'Step-1V 8K (视觉)', contextWindow: 8192, input: ['text', 'image'] },
  ],
  lingyi: [
    { id: 'yi-lightning', name: 'Yi Lightning', contextWindow: 16384 },
    { id: 'yi-large', name: 'Yi Large', contextWindow: 32768 },
    { id: 'yi-large-rag', name: 'Yi Large RAG', contextWindow: 16384 },
  ],
  tencent: [
    { id: 'hunyuan-turbos-latest', name: 'Hunyuan TurboS (Latest)', contextWindow: 32000 },
    { id: 'hunyuan-pro', name: 'Hunyuan Pro', contextWindow: 32000 },
    { id: 'hunyuan-large', name: 'Hunyuan Large', contextWindow: 32000 },
  ],
  baidu: [
    { id: 'ernie-4.0-turbo-8k', name: 'ERNIE 4.0 Turbo 8K', contextWindow: 8192 },
    { id: 'ernie-speed-128k', name: 'ERNIE Speed 128K', contextWindow: 131072 },
    { id: 'deepseek-v3', name: 'DeepSeek V3 (via 千帆)', contextWindow: 64000 },
  ],
  poe: [
    { id: 'Claude-Sonnet-4.5', name: 'Claude Sonnet 4.5', contextWindow: 200000 },
    { id: 'GPT-5.4', name: 'GPT-5.4', contextWindow: 128000 },
    { id: 'Gemini-3.1-Pro', name: 'Gemini 3.1 Pro', contextWindow: 2000000 },
  ],
  bedrock: [
    { id: 'anthropic.claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (Bedrock)', contextWindow: 200000 },
    { id: 'meta.llama3-3-70b-instruct-v1:0', name: 'Llama 3.3 70B Instruct (Bedrock)', contextWindow: 131072 },
  ],
  lmstudio: [
    { id: 'local-model', name: '本地运行的模型（在 LM Studio 中选定）', contextWindow: 32768 },
  ],
}

function cloneModelDefinition(model) {
  return {
    ...model,
    input: Array.isArray(model.input) ? [...model.input] : model.input,
    cost: model.cost ? { ...model.cost } : model.cost,
  }
}

function cloneChoice(choice) {
  return {
    ...choice,
    defaultModels: (choice.defaultModels || []).map(cloneModelDefinition),
  }
}

export function resolveProviderPresetChoice(presetKey, choiceKey = null) {
  const preset = PROVIDER_PRESETS.find(p => p.key === presetKey || p.groupKey === presetKey)
  if (!preset) return null

  if (!Array.isArray(preset.choices) || preset.choices.length === 0) {
    return {
      groupKey: preset.groupKey || preset.key,
      choiceKey: choiceKey || preset.key,
      label: preset.label,
      hint: preset.hint || preset.desc || '',
      providerKey: preset.providerKey || preset.key,
      baseUrl: preset.baseUrl || '',
      api: preset.api || 'openai-completions',
      defaultModel: preset.defaultModel || '',
      defaultModels: (preset.defaultModels || []).map(cloneModelDefinition),
      note: preset.note || '',
      signupUrl: preset.signupUrl || preset.site || '',
      lockProviderKey: !!preset.lockProviderKey,
      apiKeyPlaceholder: preset.apiKeyPlaceholder || '',
    }
  }

  const picked = preset.choices.find(choice => choice.choiceKey === choiceKey) || preset.choices[0]
  return {
    groupKey: preset.groupKey || preset.key,
    groupLabel: preset.label,
    groupHint: preset.hint || preset.desc || '',
    ...cloneChoice(picked),
  }
}

export function upsertProviderWithDefaults(config, choice, overrides = {}) {
  if (!choice) throw new Error('missing provider preset choice')

  if (!config.models) config.models = { mode: 'replace', providers: {} }
  if (!config.models.providers) config.models.providers = {}
  if (!config.models.mode) config.models.mode = 'replace'

  const providerKey = overrides.providerKey || choice.providerKey
  const existedBefore = !!config.models.providers[providerKey]
  const currentProvider = config.models.providers[providerKey] || {}
  const existingModels = Array.isArray(currentProvider.models) ? currentProvider.models : []
  const mergedModels = [...existingModels]
  const knownIds = new Set(existingModels.map(model => (typeof model === 'string' ? model : model?.id)).filter(Boolean))
  const addedModelIds = []

  for (const model of (overrides.defaultModels || choice.defaultModels || []).map(cloneModelDefinition)) {
    if (!model?.id || knownIds.has(model.id)) continue
    mergedModels.push(model)
    knownIds.add(model.id)
    addedModelIds.push(model.id)
  }

  config.models.providers[providerKey] = {
    ...currentProvider,
    baseUrl: overrides.baseUrl ?? choice.baseUrl ?? currentProvider.baseUrl ?? '',
    apiKey: overrides.apiKey ?? currentProvider.apiKey ?? '',
    api: overrides.api ?? choice.api ?? currentProvider.api ?? 'openai-completions',
    models: mergedModels,
  }

  return {
    providerKey,
    created: !existedBefore,
    addedModelIds,
    defaultModel: overrides.defaultModel || choice.defaultModel || '',
    provider: config.models.providers[providerKey],
  }
}

function collectConfiguredModelFullIds(config) {
  const providers = config?.models?.providers
  if (!providers || typeof providers !== 'object') return []
  return Object.entries(providers).flatMap(([providerKey, provider]) => {
    const models = Array.isArray(provider?.models) ? provider.models : []
    return models
      .map(model => typeof model === 'string' ? model : model?.id)
      .filter(Boolean)
      .map(modelId => `${providerKey}/${modelId}`)
  })
}

export function applyPrimaryModelSelection(config, providerKey, model) {
  if (!providerKey) throw new Error('missing provider key')
  const modelId = typeof model === 'string' ? model : model?.id
  if (!modelId) throw new Error('missing model id')

  if (!config.models) config.models = { mode: 'replace', providers: {} }
  if (!config.models.providers) config.models.providers = {}
  if (!config.models.providers[providerKey]) {
    config.models.providers[providerKey] = {
      baseUrl: '',
      apiKey: '',
      api: 'openai-completions',
      models: [],
    }
  }

  const provider = config.models.providers[providerKey]
  const providerModels = Array.isArray(provider.models) ? provider.models : []
  const hasTargetModel = providerModels.some(entry => (typeof entry === 'string' ? entry : entry?.id) === modelId)
  if (!hasTargetModel) {
    provider.models = [
      ...providerModels,
      typeof model === 'string'
        ? { id: model, name: model }
        : cloneModelDefinition({
            id: modelId,
            name: model?.name || modelId,
            contextWindow: model?.contextWindow,
            reasoning: model?.reasoning,
            input: model?.input,
            cost: model?.cost,
          }),
    ]
  }

  if (!config.agents) config.agents = {}
  if (!config.agents.defaults) config.agents.defaults = {}

  const fullModelId = `${providerKey}/${modelId}`
  const allModelIds = collectConfiguredModelFullIds(config)
  const fallbacks = allModelIds.filter(full => full !== fullModelId)

  const existingDefaultModel = (config.agents.defaults.model && typeof config.agents.defaults.model === 'object')
    ? config.agents.defaults.model
    : {}

  config.agents.defaults.model = {
    ...existingDefaultModel,
    primary: fullModelId,
    fallbacks,
  }
  config.agents.defaults.models = Object.fromEntries([fullModelId, ...fallbacks].map(full => [full, {}]))

  return {
    primary: fullModelId,
    fallbacks,
  }
}

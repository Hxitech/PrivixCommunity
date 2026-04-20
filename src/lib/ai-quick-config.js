/**
 * 一键 AI 配置 — 社区版:钳子助手 + OpenClaw
 */
import { api } from './tauri-api.js'
import {
  PROVIDER_PRESETS,
  MODEL_PRESETS,
  resolveProviderPresetChoice,
  upsertProviderWithDefaults,
  applyPrimaryModelSelection,
} from './model-presets.js'
import {
  loadAssistantConfig,
  saveAssistantConfig,
  normalizeAssistantApiType,
  cleanAssistantBaseUrl,
} from './assistant-config.js'

// ── 可配置的服务商列表 ──
export function getConfigurableProviders() {
  return PROVIDER_PRESETS.filter(p => !p.hidden)
}

// ── 获取服务商的模型列表 ──
export function getProviderModels(providerKey) {
  return MODEL_PRESETS[providerKey] || []
}

// ── 写入钳子助手 ──
function applyToAssistant(providerKey, choiceKey, apiKey, modelId, baseUrl, apiType) {
  try {
    const config = loadAssistantConfig()
    config.apiType = normalizeAssistantApiType(apiType)
    config.baseUrl = cleanAssistantBaseUrl(baseUrl, apiType)
    config.apiKey = apiKey
    config.model = modelId
    saveAssistantConfig(config)
    return { success: true, system: '钳子助手' }
  } catch (err) {
    return { success: false, system: '钳子助手', error: err.message || String(err) }
  }
}

// ── 写入 OpenClaw ──
async function applyToOpenclaw(providerKey, choiceKey, apiKey, modelId, baseUrl, apiType) {
  try {
    const config = await api.readOpenclawConfig()
    const choice = resolveProviderPresetChoice(providerKey, choiceKey)
    const openclawProviderKey = choice?.providerKey || providerKey
    const selectedModel = {
      id: modelId,
      name: modelId,
      ...(choice?.defaultModels || []).find(model => model?.id === modelId),
    }
    if (!choice) {
      if (!config.models) config.models = { mode: 'replace', providers: {} }
      if (!config.models.providers) config.models.providers = {}
      config.models.providers[providerKey] = {
        baseUrl,
        apiKey,
        api: apiType || 'openai-completions',
        models: [{ id: modelId, name: modelId }],
      }
    } else {
      const defaultModels = [...(choice.defaultModels || [])]
      if (!defaultModels.some(model => model?.id === modelId)) {
        defaultModels.push(selectedModel)
      }
      upsertProviderWithDefaults(config, choice, {
        apiKey,
        defaultModel: modelId,
        defaultModels,
      })
    }
    applyPrimaryModelSelection(config, openclawProviderKey, selectedModel)
    await api.writeOpenclawConfig(config)
    return { success: true, system: 'OpenClaw' }
  } catch (err) {
    return { success: false, system: 'OpenClaw', error: err.message || String(err), skipped: true }
  }
}

// ── 探测系统可用性 ──
export async function probeSystemAvailability() {
  const results = { assistant: true, openclaw: false }
  try {
    await api.readOpenclawConfig()
    results.openclaw = true
  } catch {}
  return results
}

// ── 编排器：一键写入所有系统 ──
export async function applyToAllSystems({ providerKey, choiceKey, apiKey, modelId, baseUrl, apiType }) {
  const results = await Promise.allSettled([
    Promise.resolve(applyToAssistant(providerKey, choiceKey, apiKey, modelId, baseUrl, apiType)),
    applyToOpenclaw(providerKey, choiceKey, apiKey, modelId, baseUrl, apiType),
  ])

  return results.map(r => {
    if (r.status === 'fulfilled') return r.value
    return { success: false, system: '未知', error: r.reason?.message || String(r.reason) }
  })
}

// ── 测试连接 ──
export async function testProviderConnection(baseUrl, apiKey, apiType) {
  try {
    const result = await api.listRemoteModels(baseUrl, apiKey, apiType || null)
    if (result && (Array.isArray(result) || result.data)) {
      return { ok: true }
    }
    return { ok: true }
  } catch (err) {
    const msg = err.message || String(err)
    if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('403')) {
      return { ok: false, reason: 'API Key 无效或已过期' }
    }
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('timeout') || msg.includes('ECONNREFUSED')) {
      return { ok: false, reason: '无法连接到服务商，请检查网络' }
    }
    return { ok: false, reason: msg }
  }
}

// ── 教程内容 ──
export const TUTORIALS = {
  provider: {
    title: '什么是 AI 模型服务商？',
    content: `AI 模型服务商是提供大语言模型推理服务的平台。不同服务商托管不同的 AI 模型，价格和速度各异。

<strong>国内推荐</strong>：MiniMax、DeepSeek、Moonshot (Kimi)、硅基流动、阿里云百炼
<strong>国际推荐</strong>：OpenAI、Anthropic、Google Gemini

你需要在至少一个服务商处注册账号，才能使用 AI 功能。大多数服务商提供免费额度供你试用。`,
  },
  apiKey: {
    title: '什么是 API Key？如何获取？',
    content: `API Key 是服务商给你的身份凭证，长这样：<code>sk-abc123...</code>。

<strong>获取步骤（以 DeepSeek 为例）</strong>：
1. 访问服务商官网并注册账号
2. 登录后进入"API Keys"或"密钥管理"页面
3. 点击"创建新密钥"，复制保存（通常只显示一次）
4. 粘贴到本页面的输入框

⚠️ <strong>安全提示</strong>：API Key 等同于你的账户密码，请勿泄露或提交到公开代码。`,
  },
  model: {
    title: '如何选择模型？',
    content: `同一服务商通常提供多个模型，按能力和价格分档：

<strong>旗舰模型</strong>（最强但最贵）：
- OpenAI GPT-4o、Anthropic Claude 3.5 Sonnet、DeepSeek V3

<strong>均衡模型</strong>（性价比高，推荐）：
- Kimi k1.5、MiniMax M1、通义千问 Plus、DeepSeek Chat

<strong>入门模型</strong>（速度快、成本低）：
- GPT-4o-mini、Claude Haiku、DeepSeek Coder

💡 <strong>建议</strong>：先用均衡模型试用，根据实际体验再升级或降级。`,
  },
}

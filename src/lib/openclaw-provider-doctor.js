/**
 * OpenClaw Provider Doctor — 修复 OAuth provider 残留导致的 Telegram/Hermes 调用失败
 *
 * 背景:OpenClaw 5.4+ 引入了 *-portal OAuth provider(如 minimax-portal),
 * 与同名 API Key provider(如 minimax)共存。Privix 一键配置写入的 primary
 * 是 API Key 版本,但 fallbacks 数组会被 collectConfiguredModelFullIds()
 * 自动收进 OAuth 版本;若 OAuth 未完成认证,Telegram bot fallback 时会全失败。
 *
 * 本模块负责审计与修复:
 * 1. auditModelDefaults(config) — 检测 primary/fallbacks 是否指向未认证 OAuth provider
 * 2. repairModelDefaults(config, audit) — 修正 primary、清 OAuth fallbacks、disable 残缺 OAuth provider
 * 3. runProviderDoctor() — 端到端编排(读 → 审 → 修 → 写 → 重载 Gateway)
 */
import { api } from './tauri-api.js'

// OpenClaw 5.4+ 自动注入的 OAuth provider → 同模型的 API Key provider 映射
// 测试访问需要,故 export
export const OAUTH_TO_APIKEY_PROVIDER = Object.freeze({
  'minimax-portal': 'minimax',
  'kimi-coding-portal': 'kimi-coding',
  'moonshot-portal': 'moonshot',
})

export const KNOWN_OAUTH_PROVIDERS = Object.freeze(Object.keys(OAUTH_TO_APIKEY_PROVIDER))

function isOauthProviderKey(key) {
  return Object.prototype.hasOwnProperty.call(OAUTH_TO_APIKEY_PROVIDER, key)
}

function splitFullId(fullId) {
  const idx = String(fullId || '').indexOf('/')
  if (idx <= 0) return { providerKey: '', modelId: '' }
  return { providerKey: fullId.slice(0, idx), modelId: fullId.slice(idx + 1) }
}

function providerHasModel(providerNode, modelId) {
  if (!providerNode || !modelId) return false
  const models = Array.isArray(providerNode.models) ? providerNode.models : []
  return models.some(m => (typeof m === 'string' ? m : m?.id) === modelId)
}

function providerHasApiKey(providerNode) {
  return !!(providerNode && typeof providerNode.apiKey === 'string' && providerNode.apiKey.trim())
}

/**
 * 给定 OAuth provider key 找同模型的 API Key provider key(若存在且 healthy)
 * @returns {string|null}
 */
export function findShadowedApiKeyProvider(config, oauthProviderKey, modelId) {
  const sibling = OAUTH_TO_APIKEY_PROVIDER[oauthProviderKey]
  if (!sibling) return null
  const providers = config?.models?.providers || {}
  const node = providers[sibling]
  if (!node) return null
  if (!providerHasApiKey(node)) return null
  if (!providerHasModel(node, modelId)) return null
  return sibling
}

/**
 * 审计 agents.defaults.model.primary 与 fallbacks
 * @returns {{
 *   needsFix: boolean,
 *   currentPrimary: string,
 *   suggestedPrimary: string,
 *   primaryReason: string,
 *   fallbackRemovals: string[],
 *   disableProviders: string[],
 * }}
 */
export function auditModelDefaults(config) {
  const result = {
    needsFix: false,
    currentPrimary: '',
    suggestedPrimary: '',
    primaryReason: '',
    fallbackRemovals: [],
    disableProviders: [],
  }
  const defaults = config?.agents?.defaults?.model
  if (!defaults || typeof defaults !== 'object') return result

  const primary = String(defaults.primary || '')
  result.currentPrimary = primary
  const fallbacks = Array.isArray(defaults.fallbacks) ? defaults.fallbacks : []
  const providers = config?.models?.providers || {}

  // 1. 检查 primary 是否在不健康的 OAuth provider 上
  if (primary) {
    const { providerKey, modelId } = splitFullId(primary)
    if (isOauthProviderKey(providerKey)) {
      const oauthNode = providers[providerKey]
      const oauthAuthed = providerHasApiKey(oauthNode) // OAuth 完成后会写 apiKey/token
      if (!oauthAuthed) {
        const sibling = findShadowedApiKeyProvider(config, providerKey, modelId)
        if (sibling) {
          result.needsFix = true
          result.suggestedPrimary = `${sibling}/${modelId}`
          result.primaryReason = `${providerKey} 未完成 OAuth 认证,切换到 ${sibling}(API Key 直连)`
          if (!result.disableProviders.includes(providerKey)) {
            result.disableProviders.push(providerKey)
          }
        }
      }
    }
  }

  // 2. 检查 fallbacks 中是否含 OAuth provider 残留
  for (const full of fallbacks) {
    const { providerKey, modelId } = splitFullId(full)
    if (!isOauthProviderKey(providerKey)) continue
    const oauthNode = providers[providerKey]
    if (providerHasApiKey(oauthNode)) continue // OAuth 已完成,合法
    const sibling = findShadowedApiKeyProvider(config, providerKey, modelId)
    if (!sibling) continue // 没有可替代的 API Key provider,保留以免误删
    result.needsFix = true
    result.fallbackRemovals.push(full)
    if (!result.disableProviders.includes(providerKey)) {
      result.disableProviders.push(providerKey)
    }
  }

  return result
}

/**
 * 执行修复 — 直接 mutate config
 * @returns {{ before: object, after: object }} 用于日志/UI 展示
 */
export function repairModelDefaults(config, audit) {
  if (!audit?.needsFix) return { before: null, after: null }
  const defaults = config?.agents?.defaults?.model
  if (!defaults || typeof defaults !== 'object') return { before: null, after: null }

  const before = {
    primary: defaults.primary,
    fallbacks: Array.isArray(defaults.fallbacks) ? [...defaults.fallbacks] : [],
  }

  // 1. 改 primary
  if (audit.suggestedPrimary && audit.suggestedPrimary !== defaults.primary) {
    defaults.primary = audit.suggestedPrimary
  }

  // 2. 过滤 fallbacks
  if (audit.fallbackRemovals.length) {
    const removeSet = new Set(audit.fallbackRemovals)
    defaults.fallbacks = (Array.isArray(defaults.fallbacks) ? defaults.fallbacks : [])
      .filter(full => !removeSet.has(full))
  }

  // 3. 同步 agents.defaults.models map
  const models = config?.agents?.defaults?.models
  if (models && typeof models === 'object') {
    for (const removed of audit.fallbackRemovals) {
      delete models[removed]
    }
    if (audit.currentPrimary && audit.currentPrimary !== defaults.primary) {
      delete models[audit.currentPrimary]
    }
    if (defaults.primary && !(defaults.primary in models)) {
      models[defaults.primary] = {}
    }
  }

  // 4. disable 残缺 OAuth provider 节点(保留配置但不参与解析)
  const providers = config?.models?.providers
  if (providers && typeof providers === 'object') {
    for (const oauthKey of audit.disableProviders) {
      if (providers[oauthKey] && typeof providers[oauthKey] === 'object') {
        providers[oauthKey].disabled = true
      }
    }
  }

  const after = {
    primary: defaults.primary,
    fallbacks: Array.isArray(defaults.fallbacks) ? [...defaults.fallbacks] : [],
  }
  return { before, after }
}

/**
 * 端到端 doctor:读 openclaw.json → audit → repair → write → reload Gateway
 * @returns {Promise<{ repaired: boolean, audit: object, before: object|null, after: object|null }>}
 */
export async function runProviderDoctor() {
  let config
  try {
    config = await api.readOpenclawConfig()
  } catch (err) {
    return { repaired: false, audit: null, before: null, after: null, error: err?.message || String(err) }
  }
  if (!config || typeof config !== 'object') {
    return { repaired: false, audit: null, before: null, after: null }
  }

  const audit = auditModelDefaults(config)
  if (!audit.needsFix) {
    return { repaired: false, audit, before: null, after: null }
  }

  const { before, after } = repairModelDefaults(config, audit)

  try {
    await api.writeOpenclawConfig(config)
  } catch (err) {
    return { repaired: false, audit, before, after, error: `写 openclaw.json 失败: ${err?.message || err}` }
  }

  // Gateway 重载失败不影响 doctor 成功(用户下次重启 Gateway 也会生效)
  try { await api.reloadGateway() } catch (err) { console.warn('[provider-doctor] reload gateway failed:', err) }

  return { repaired: true, audit, before, after }
}

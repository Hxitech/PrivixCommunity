/**
 * OpenClaw Plugin Doctor — 检测 legacy 插件与官方版冲突,提供一键迁移
 *
 * 背景:OpenClaw 2026.5.3 起把官方插件迁到 `@openclaw/*` npm 包。
 * 用户从老版本升级时,旧插件(openclaw-lark / 旧 discord 包等)不会自动被新版替代,
 * 导致同一 channel 既有 legacy 又有 official,channel 注册失败 / 行为不可预测。
 *
 * `src-tauri/src/commands/messaging.rs:497` 已有 `disable_legacy_plugin` 在用户启用 channel
 * 时被动调用,但**对存量冲突无主动检测**。本模块负责进 Plugin Hub 时主动审计 + 修复。
 *
 * 架构对齐 audit/repair 模式:
 * 1. auditPluginConflicts(config)  — 纯函数,扫 plugins.allow ∪ entries[id].enabled
 * 2. repairPluginConflicts(audit)  — 调既有 togglePlugin(legacy, false) + installPlugin(official)
 * 3. runPluginDoctor()             — 端到端编排
 */
import { api } from './tauri-api.js'

// 已知 legacy → official 映射(写死,不依赖 CLI 元数据)
// channel 字段供 UI 分组显示;若新增请同步上游 CHANGELOG
export const LEGACY_TO_OFFICIAL = Object.freeze({
  'openclaw-lark':            { official: '@openclaw/feishu',   channel: 'feishu' },
  'openclaw-feishu-legacy':   { official: '@openclaw/feishu',   channel: 'feishu' },
  'openclaw-discord-bot':     { official: '@openclaw/discord',  channel: 'discord' },
  'openclaw-discord-legacy':  { official: '@openclaw/discord',  channel: 'discord' },
  'openclaw-qqbot-legacy':    { official: '@openclaw/qqbot',    channel: 'qqbot' },
  'openclaw-telegram-legacy': { official: '@openclaw/telegram', channel: 'telegram' },
})

export const KNOWN_LEGACY_PLUGINS = Object.freeze(Object.keys(LEGACY_TO_OFFICIAL))

/**
 * 收集所有 enabled 插件的 id 集合
 * - plugins.allow[] 数组
 * - plugins.entries[id].enabled === true
 * 任一为真即视为 enabled
 */
export function collectEnabledPlugins(config) {
  const enabled = new Set()
  const plugins = config?.plugins
  if (!plugins || typeof plugins !== 'object') return enabled
  if (Array.isArray(plugins.allow)) {
    for (const id of plugins.allow) {
      if (typeof id === 'string' && id.trim()) enabled.add(id)
    }
  }
  if (plugins.entries && typeof plugins.entries === 'object') {
    for (const [id, node] of Object.entries(plugins.entries)) {
      if (node && typeof node === 'object' && node.enabled === true) {
        enabled.add(id)
      }
    }
  }
  return enabled
}

/**
 * 审计 legacy 插件冲突
 *
 * 三种状态:
 * - `disable_legacy`: legacy + official 都 enabled → 直接禁 legacy
 * - `migrate`:       只有 legacy enabled → 装 official + 禁 legacy
 * - 仅 official enabled / 都没装  → 不在结果里
 *
 * @returns {{
 *   needsFix: boolean,
 *   conflicts: Array<{ legacy: string, official: string, channel: string, action: 'disable_legacy'|'migrate' }>
 * }}
 */
export function auditPluginConflicts(config) {
  const enabled = collectEnabledPlugins(config)
  const conflicts = []
  for (const [legacy, meta] of Object.entries(LEGACY_TO_OFFICIAL)) {
    if (!enabled.has(legacy)) continue
    const action = enabled.has(meta.official) ? 'disable_legacy' : 'migrate'
    conflicts.push({
      legacy,
      official: meta.official,
      channel: meta.channel,
      action,
    })
  }
  return { needsFix: conflicts.length > 0, conflicts }
}

/**
 * 执行修复 — 串行调用既有 Tauri 命令
 *
 * 注意:不并行 — install/toggle 都会写 openclaw.json,串行避免后写覆盖前写。
 *
 * @param {ReturnType<typeof auditPluginConflicts>} audit
 * @returns {Promise<{ repaired: boolean, count: number, errors: Array<{ legacy: string, error: string }> }>}
 */
export async function repairPluginConflicts(audit) {
  if (!audit?.needsFix) return { repaired: false, count: 0, errors: [] }
  const errors = []
  let count = 0
  for (const c of audit.conflicts) {
    try {
      if (c.action === 'migrate') {
        // 先装官方版,失败也尝试禁 legacy 不留半边
        try {
          await api.installPlugin(c.official)
        } catch (err) {
          errors.push({ legacy: c.legacy, error: `安装 ${c.official} 失败: ${err?.message || err}` })
        }
      }
      await api.togglePlugin(c.legacy, false)
      count += 1
    } catch (err) {
      errors.push({ legacy: c.legacy, error: err?.message || String(err) })
    }
  }
  return { repaired: count > 0, count, errors }
}

/**
 * 端到端 doctor:读 openclaw.json → audit → 不自动修复(由 UI 触发 repair)
 *
 * UI 用法:
 *   const audit = await runPluginDoctor()
 *   if (audit?.needsFix) showBanner(audit.conflicts)
 *   // 用户点修复 → repairPluginConflicts(audit) → restartGateway
 *
 * @returns {Promise<ReturnType<typeof auditPluginConflicts>|null>} 配置读取失败时返回 null
 */
export async function runPluginDoctor() {
  let config
  try {
    config = await api.readOpenclawConfig()
  } catch {
    return null
  }
  if (!config || typeof config !== 'object') return null
  return auditPluginConflicts(config)
}

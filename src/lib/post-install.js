/**
 * 安装/升级后的通用后处理逻辑
 * - 确保 Gateway 已安装
 * - 补丁 openclaw.json 关键默认值
 */
import { api } from './tauri-api.js'

/**
 * 安装/升级 OpenClaw 后自动执行的后处理
 * @param {{ appendLog: Function, appendHtmlLog: Function }} logger - 日志输出（modal 或兼容接口）
 * @param {{ gatewayMsg: string, gatewayOk: string, gatewayFail: string }} msgs - i18n 消息
 */
export async function runPostInstall(logger, msgs) {
  // 确保 Gateway 已安装
  logger.appendLog(msgs.gatewayMsg)
  try {
    await api.installGateway()
    if (msgs.gatewayOk) logger.appendHtmlLog(msgs.gatewayOk)
  } catch (ge) {
    if (msgs.gatewayFail) logger.appendHtmlLog(msgs.gatewayFail.replace('{error}', String(ge)))
  }

  // 确保 openclaw.json 有关键默认值
  try {
    const config = await api.readOpenclawConfig()
    if (!config) return
    let patched = false
    if (!config.gateway) config.gateway = {}
    if (!config.gateway.mode) {
      config.gateway.mode = 'local'
      patched = true
    }
    if (!config.tools || config.tools.profile !== 'full') {
      config.tools = { profile: 'full', sessions: { visibility: 'all' }, ...(config.tools || {}) }
      config.tools.profile = 'full'
      if (!config.tools.sessions) config.tools.sessions = {}
      config.tools.sessions.visibility = 'all'
      patched = true
    }
    if (patched) await api.writeOpenclawConfig(config)
  } catch (_ce) { /* 配置补丁非关键，静默失败 */ }
}

/**
 * 跳转到 AI 助手并携带错误诊断上下文
 */
export function navigateToAIAssistant(prompt) {
  sessionStorage.setItem('assistant-auto-prompt', prompt)
  window.location.hash = '/assistant'
}

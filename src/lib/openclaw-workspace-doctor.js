/**
 * OpenClaw Workspace Doctor — 检测 ~/.openclaw/workspace/ 子目录的所有权异常
 *
 * 背景:历史 sudo 装包 / Docker run 残留可能让 ~/.openclaw/workspace/scripts、
 * .clawhub、skills、memory 等子目录被 root 拥有,OpenClaw 写入时报 EACCES。
 *
 * Panel 不能直接 `sudo chown`(Tauri 没 elevation token),只能检测 + 提示用户
 * 在终端跑命令。本模块负责审计 + 24h 节流(参考 version-migration.js pattern)。
 *
 * Rust 端 `check_workspace_permissions` 命令(见 src-tauri/src/commands/config.rs)
 * 在 Windows 上直接返回 needsFix=false(NTFS 权限模型不同,跳过)。
 */
import { api } from './tauri-api.js'

const WORKSPACE_LAST_CHECK_KEY = 'privix_workspace_check_last_run'
const WORKSPACE_ATTENTION_KEY = 'privix_workspace_needs_attention'
const WORKSPACE_DETAIL_KEY = 'privix_workspace_attention_detail'
// 24h 节流 — 用户在终端跑了 chown 之后想立即复检,可走 force=true
const THROTTLE_MS = 24 * 60 * 60 * 1000

/**
 * 是否在节流窗口内 — 仅供 UI 决定要不要主动调用
 */
export function isWorkspaceCheckThrottled() {
  try {
    const last = parseInt(localStorage.getItem(WORKSPACE_LAST_CHECK_KEY) || '0', 10) || 0
    return Date.now() - last < THROTTLE_MS
  } catch {
    return false
  }
}

/**
 * sessionStorage flag — 由 banner 组件读,跨页面跳转保留提示
 */
export function isWorkspaceAttentionPending() {
  try { return sessionStorage.getItem(WORKSPACE_ATTENTION_KEY) === '1' } catch { return false }
}

export function getWorkspaceAttentionDetail() {
  try { return sessionStorage.getItem(WORKSPACE_DETAIL_KEY) || '' } catch { return '' }
}

export function markWorkspaceAttentionResolved() {
  try {
    sessionStorage.removeItem(WORKSPACE_ATTENTION_KEY)
    sessionStorage.removeItem(WORKSPACE_DETAIL_KEY)
  } catch {}
}

/**
 * 端到端 workspace 自检
 *
 * @param {{ force?: boolean }} opts - force=true 跳过 24h 节流(用户手动点"复检")
 * @returns {Promise<{
 *   exists: boolean,
 *   needsFix: boolean,
 *   workspace: string,
 *   badDirs: Array<{ path: string, ownerUid: number, currentUid: number }>,
 *   chownCommand: string|null,
 *   platformSupported: boolean,
 *   throttled?: boolean,
 *   error?: string,
 * }|null>}
 */
export async function runWorkspaceDoctor(opts = {}) {
  if (!opts.force && isWorkspaceCheckThrottled()) {
    return { throttled: true, needsFix: false, exists: true, badDirs: [], chownCommand: null, platformSupported: true, workspace: '' }
  }
  let result
  try {
    result = await api.checkWorkspacePermissions()
  } catch (err) {
    return {
      exists: false,
      needsFix: false,
      workspace: '',
      badDirs: [],
      chownCommand: null,
      platformSupported: false,
      error: err?.message || String(err),
    }
  }
  try { localStorage.setItem(WORKSPACE_LAST_CHECK_KEY, String(Date.now())) } catch {}
  if (result?.needsFix) {
    try {
      sessionStorage.setItem(WORKSPACE_ATTENTION_KEY, '1')
      const summary = `${result.badDirs.length} 个目录所有者异常`
      sessionStorage.setItem(WORKSPACE_DETAIL_KEY, summary)
    } catch {}
  } else {
    markWorkspaceAttentionResolved()
  }
  return result
}

/**
 * 把 chown 命令复制到剪贴板
 * @returns {Promise<boolean>} 成功返回 true
 */
export async function copyChownCommand(command) {
  if (!command) return false
  try {
    await navigator.clipboard.writeText(command)
    return true
  } catch {
    return false
  }
}

/**
 * OpenClaw 版本特性门控工具
 * 根据检测到的 OpenClaw 版本，决定是否启用特定功能的 UI
 */
import { api } from './tauri-api.js'

// 特性版本常量 — 每个常量对应引入该特性的最低 OpenClaw 版本
export const FEATURE_QWEN_DASHSCOPE = '2026.3.23'
export const FEATURE_CONTAINER_MODE = '2026.3.24'
export const FEATURE_DISCORD_AUTO_THREAD = '2026.3.24'
export const FEATURE_NODE_PREFLIGHT = '2026.3.24'

// 缓存当前检测到的 OpenClaw 版本
let _cachedVersion = null

/**
 * 比较两个 dot-separated 版本号
 * @returns {number} 1 if a > b, -1 if a < b, 0 if equal
 */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

/**
 * 获取当前 OpenClaw 版本（带缓存）
 * @returns {Promise<string|null>} 版本号，如 "2026.3.24"；未安装则返回 null
 */
export async function getCurrentVersion() {
  if (_cachedVersion !== undefined && _cachedVersion !== null) return _cachedVersion
  try {
    const info = await api.getVersionInfo()
    // info.current 格式可能是 "v2026.3.24" 或 "2026.3.24" 或 "2026.3.24-zh.1"
    const raw = info?.current || ''
    _cachedVersion = raw.replace(/^v/, '').replace(/-zh\.\d+$/, '') || null
    return _cachedVersion
  } catch {
    _cachedVersion = null
    return null
  }
}

/**
 * 判断当前 OpenClaw 版本是否 >= 指定版本
 * @param {string} targetVersion 目标最低版本，如 "2026.3.24"
 * @returns {Promise<boolean>}
 */
export async function isFeatureAvailable(targetVersion) {
  const current = await getCurrentVersion()
  if (!current) return false
  return compareVersions(current, targetVersion) >= 0
}

/** 清除缓存（升级/降级后调用） */
export function resetVersionCache() {
  _cachedVersion = null
}

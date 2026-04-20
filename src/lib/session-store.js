/**
 * 会话缓存统一层
 * 协调 IndexedDB（本地缓存） ↔ Gateway（权威数据源）
 * 解决 Gateway 断连后 AI 失忆的问题
 */

import { wsClient, uuid } from './ws-client.js'
import {
  saveMessages, getLocalMessages, saveSessionMeta, listSessionMetas,
  getMessageCount, pruneSessionMessages, purgeOldMessages, isStorageAvailable,
} from './message-db.js'

// ─── 状态 ────────────────────────────────────────────────

let _connected = false
let _syncCallbacks = []
let _lastPurgeAt = 0
const _lastSyncAt = new Map()
const SYNC_COOLDOWN_MS = 5000
const PURGE_COOLDOWN_MS = 3600_000 // 每小时最多清理一次

// ─── 初始化 ──────────────────────────────────────────────

/** App 启动时调用，执行定期清理（每小时最多一次） */
export function initSessionStore() {
  if (!isStorageAvailable()) return
  if (Date.now() - _lastPurgeAt < PURGE_COOLDOWN_MS) return
  _lastPurgeAt = Date.now()
  purgeOldMessages(30)
}

// ─── 连接状态 ────────────────────────────────────────────

/** 设置 Gateway 连接状态 */
export function setConnectionState(connected) {
  _connected = connected
}

/** 是否处于离线状态 */
export function isOffline() {
  return !_connected
}

// ─── 消息缓存 ────────────────────────────────────────────

/**
 * 获取本地缓存的消息
 * 离线时直接返回 IndexedDB 数据；在线时也先返回缓存（快速首屏）
 */
export async function getCachedMessages(sessionKey, limit = 200) {
  if (!sessionKey || !isStorageAvailable()) return []
  return getLocalMessages(sessionKey, limit)
}

/**
 * 缓存用户发出的消息（发送前调用）
 * 确保消息即使在 Gateway 断连后仍可查看
 */
export function cacheOutboundMessage(sessionKey, msg) {
  if (!sessionKey || !msg || !isStorageAvailable()) return
  saveMessages([{
    id: msg.id || uuid(),
    sessionKey,
    role: msg.role || 'user',
    content: msg.content || msg.text || '',
    timestamp: msg.timestamp || Date.now(),
  }])
  _debouncedUpdateMeta(sessionKey)
}

/**
 * 缓存 AI 回复的消息（流式完成后调用）
 */
export function cacheInboundMessage(sessionKey, msg) {
  if (!sessionKey || !msg || !isStorageAvailable()) return
  saveMessages([{
    id: msg.id || uuid(),
    sessionKey,
    role: msg.role || 'assistant',
    content: msg.content || msg.text || '',
    timestamp: msg.timestamp || Date.now(),
  }])
  _debouncedUpdateMeta(sessionKey)
}

// ─── Gateway 同步 ────────────────────────────────────────

/**
 * 从 Gateway 拉取历史并与本地缓存合并
 * @returns {object|null} { messages, isUpdate } 或 null（无更新/离线）
 */
export async function syncWithGateway(sessionKey) {
  if (!sessionKey || !_connected || !wsClient.gatewayReady) return null
  if (!isStorageAvailable()) return null

  // 冷却期内不重复同步
  const lastSync = _lastSyncAt.get(sessionKey) || 0
  if (Date.now() - lastSync < SYNC_COOLDOWN_MS) return null

  try {
    const result = await wsClient.chatHistory(sessionKey, 200)
    const serverMessages = result?.messages || []
    if (!serverMessages.length) return null

    // 只写入本地缺失的消息，避免对已有记录做无用 put()
    const localMessages = await getLocalMessages(sessionKey, 200)
    const localIds = new Set(localMessages.map(m => m.id))
    const toSave = serverMessages
      .filter(m => m.id && !localIds.has(m.id))
      .map(m => ({
        id: m.id,
        sessionKey,
        role: m.role || 'assistant',
        content: m.text || m.content || '',
        timestamp: m.timestamp || Date.now(),
      }))

    if (toSave.length) {
      saveMessages(toSave)
      _debouncedUpdateMeta(sessionKey)
    }

    _lastSyncAt.set(sessionKey, Date.now())

    // 超限裁剪
    const count = await getMessageCount(sessionKey)
    if (count > 500) pruneSessionMessages(sessionKey, 500)

    // 通知同步完成
    _syncCallbacks.forEach(fn => {
      try { fn(sessionKey) } catch {}
    })

    return { messages: serverMessages, isUpdate: true }
  } catch (e) {
    console.warn('[session-store] syncWithGateway 失败:', e.message)
    return null
  }
}

// ─── 会话列表 ────────────────────────────────────────────

/**
 * 获取本地缓存的会话列表（按最后消息时间降序）
 * Gateway 在线时应优先用 wsClient.sessionsList()，离线回退到这里
 */
export async function getCachedSessionList() {
  if (!isStorageAvailable()) return []
  return listSessionMetas()
}

// ─── 回调注册 ────────────────────────────────────────────

/** 注册同步完成回调 */
export function onSyncComplete(callback) {
  _syncCallbacks.push(callback)
  return () => { _syncCallbacks = _syncCallbacks.filter(fn => fn !== callback) }
}

// ─── 内部工具 ────────────────────────────────────────────

let _metaUpdateTimer = null
let _pendingMetaKeys = new Set()

/** debounce 会话元信息更新，避免每条消息触发 2 次 DB 事务 */
function _debouncedUpdateMeta(sessionKey) {
  _pendingMetaKeys.add(sessionKey)
  if (_metaUpdateTimer) clearTimeout(_metaUpdateTimer)
  _metaUpdateTimer = setTimeout(async () => {
    _metaUpdateTimer = null
    const keys = [..._pendingMetaKeys]
    _pendingMetaKeys.clear()
    for (const key of keys) {
      try {
        const count = await getMessageCount(key)
        saveSessionMeta(key, { lastMessageAt: Date.now(), messageCount: count })
      } catch { /* 非关键路径 */ }
    }
  }, 500)
}

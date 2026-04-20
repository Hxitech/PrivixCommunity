/**
 * 本地消息存储 - IndexedDB
 * 从 clawapp 移植，适配 Privix
 * v2: 启用 sessions store，增加清理函数
 */

const DB_NAME = 'clawpanel-messages'
const DB_VERSION = 2
const STORE_NAME = 'messages'
const STORE_SESSIONS = 'sessions'

let _db = null

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db)
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => { _db = request.result; resolve(_db) }
    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const msgStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        msgStore.createIndex('sessionKey', 'sessionKey', { unique: false })
        msgStore.createIndex('timestamp', 'timestamp', { unique: false })
        msgStore.createIndex('sessionKey_timestamp', ['sessionKey', 'timestamp'], { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        const sessStore = db.createObjectStore(STORE_SESSIONS, { keyPath: 'sessionKey' })
        sessStore.createIndex('lastMessageAt', 'lastMessageAt', { unique: false })
      } else if (event.oldVersion < 2) {
        // v1→v2: 给已有 sessions store 加 lastMessageAt 索引
        try {
          const sessStore = event.currentTarget.transaction.objectStore(STORE_SESSIONS)
          if (!sessStore.indexNames.contains('lastMessageAt')) {
            sessStore.createIndex('lastMessageAt', 'lastMessageAt', { unique: false })
          }
        } catch { /* 索引已存在则忽略 */ }
      }
    }
  })
}

export async function saveMessage(message) {
  if (!message || !message.id) return
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put({
      id: message.id,
      sessionKey: message.sessionKey || '',
      role: message.role || 'assistant',
      content: message.content || message.text || '',
      timestamp: message.timestamp || Date.now(),
      sync: true
    })
  } catch (e) {
    console.error('[db] saveMessage error:', e)
  }
}

export async function saveMessages(messages) {
  if (!messages?.length) return
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    messages.forEach(msg => {
      if (!msg.id) return
      store.put({
        id: msg.id,
        sessionKey: msg.sessionKey || '',
        role: msg.role || 'assistant',
        content: msg.content || msg.text || '',
        timestamp: msg.timestamp || Date.now(),
        sync: true
      })
    })
  } catch (e) {
    console.error('[db] saveMessages error:', e)
  }
}

export async function getLocalMessages(sessionKey, limit = 200) {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const index = tx.objectStore(STORE_NAME).index('sessionKey_timestamp')
      const range = IDBKeyRange.bound([sessionKey, 0], [sessionKey, Date.now() + 1])
      const messages = []
      const request = index.openCursor(range, 'prev')
      request.onsuccess = (event) => {
        const cursor = event.target.result
        if (cursor && messages.length < limit) { messages.push(cursor.value); cursor.continue() }
      }
      tx.oncomplete = () => resolve(messages.reverse())
      tx.onerror = () => resolve([])
    })
  } catch (e) {
    console.error('[db] getLocalMessages error:', e)
    return []
  }
}

export async function clearSessionMessages(sessionKey) {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const request = tx.objectStore(STORE_NAME).index('sessionKey').openCursor(sessionKey)
    request.onsuccess = (event) => {
      const cursor = event.target.result
      if (cursor) { cursor.delete(); cursor.continue() }
    }
  } catch (e) {
    console.error('[db] clearSessionMessages error:', e)
  }
}

// ─── Session 元信息管理 ──────────────────────────────────

/** 保存/更新会话元信息 */
export async function saveSessionMeta(sessionKey, meta = {}) {
  if (!sessionKey) return
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_SESSIONS, 'readwrite')
    tx.objectStore(STORE_SESSIONS).put({
      sessionKey,
      displayName: meta.displayName || '',
      lastMessageAt: meta.lastMessageAt || Date.now(),
      messageCount: meta.messageCount || 0,
    })
  } catch (e) {
    console.error('[db] saveSessionMeta error:', e)
  }
}

/** 获取单个会话元信息 */
export async function getSessionMeta(sessionKey) {
  if (!sessionKey) return null
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_SESSIONS, 'readonly')
      const req = tx.objectStore(STORE_SESSIONS).get(sessionKey)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => resolve(null)
    })
  } catch { return null }
}

/** 列出所有会话元信息，按 lastMessageAt 降序 */
export async function listSessionMetas() {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_SESSIONS, 'readonly')
      const index = tx.objectStore(STORE_SESSIONS).index('lastMessageAt')
      const results = []
      const req = index.openCursor(null, 'prev')
      req.onsuccess = (event) => {
        const cursor = event.target.result
        if (cursor) { results.push(cursor.value); cursor.continue() }
      }
      tx.oncomplete = () => resolve(results)
      tx.onerror = () => resolve([])
    })
  } catch { return [] }
}

/** 删除会话元信息 */
export async function deleteSessionMeta(sessionKey) {
  if (!sessionKey) return
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_SESSIONS, 'readwrite')
    tx.objectStore(STORE_SESSIONS).delete(sessionKey)
  } catch (e) {
    console.error('[db] deleteSessionMeta error:', e)
  }
}

// ─── 消息计数与清理 ──────────────────────────────────────

/** 获取某个会话的消息数量 */
export async function getMessageCount(sessionKey) {
  if (!sessionKey) return 0
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const index = tx.objectStore(STORE_NAME).index('sessionKey')
      const req = index.count(sessionKey)
      req.onsuccess = () => resolve(req.result || 0)
      req.onerror = () => resolve(0)
    })
  } catch { return 0 }
}

/** 裁剪某个会话的消息，只保留最近 keepCount 条 */
export async function pruneSessionMessages(sessionKey, keepCount = 500) {
  if (!sessionKey) return
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const index = tx.objectStore(STORE_NAME).index('sessionKey_timestamp')
    const range = IDBKeyRange.bound([sessionKey, 0], [sessionKey, Date.now() + 1])

    // 先收集所有 id，按时间正序
    const allIds = []
    const collectReq = index.openCursor(range, 'next')
    collectReq.onsuccess = (event) => {
      const cursor = event.target.result
      if (cursor) { allIds.push(cursor.primaryKey); cursor.continue() }
    }
    tx.oncomplete = () => {
      if (allIds.length <= keepCount) return
      // 删除最老的
      const toDelete = allIds.slice(0, allIds.length - keepCount)
      openDB().then(db2 => {
        const tx2 = db2.transaction(STORE_NAME, 'readwrite')
        const store = tx2.objectStore(STORE_NAME)
        toDelete.forEach(id => store.delete(id))
      }).catch(() => {})
    }
  } catch (e) {
    console.error('[db] pruneSessionMessages error:', e)
  }
}

/** 清理超过 maxAgeDays 天的消息 */
export async function purgeOldMessages(maxAgeDays = 30) {
  try {
    const db = await openDB()
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const index = tx.objectStore(STORE_NAME).index('timestamp')
    const range = IDBKeyRange.upperBound(cutoff)
    const req = index.openCursor(range)
    let count = 0
    req.onsuccess = (event) => {
      const cursor = event.target.result
      if (cursor) { cursor.delete(); count++; cursor.continue() }
    }
    tx.oncomplete = () => {
      if (count > 0) console.log(`[db] 清理了 ${count} 条过期消息`)
    }
  } catch (e) {
    console.error('[db] purgeOldMessages error:', e)
  }
}

export function isStorageAvailable() {
  try { return 'indexedDB' in window && !!indexedDB } catch { return false }
}

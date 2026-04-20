const _sessions = new Map()

function makeId(prefix = 'assistant-session') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function ensureSessionRecord(sessionId, surface = 'assistant') {
  let record = _sessions.get(sessionId)
  if (!record) {
    record = {
      id: sessionId,
      surface,
      snapshot: {
        sessionId,
        surface,
        streaming: false,
        status: 'idle',
        updatedAt: Date.now(),
      },
      views: new Map(),
      handlers: {
        send: null,
        abort: null,
      },
    }
    _sessions.set(sessionId, record)
  }
  return record
}

function emitSnapshot(record) {
  const snapshot = { ...record.snapshot, attachedViews: record.views.size }
  record.views.forEach(view => {
    try {
      view.onSnapshot?.(snapshot)
    } catch {
      // ignore detached/broken views
    }
  })
}

export function createSession(surface = 'assistant') {
  const sessionId = makeId(surface)
  ensureSessionRecord(sessionId, surface)
  return sessionId
}

export function setSessionHandlers(sessionId, handlers = {}) {
  const record = ensureSessionRecord(sessionId)
  record.handlers = {
    ...record.handlers,
    ...handlers,
  }
  return record.snapshot
}

export function updateSessionSnapshot(sessionId, patch = {}) {
  const record = ensureSessionRecord(sessionId)
  record.snapshot = {
    ...record.snapshot,
    ...patch,
    sessionId,
    updatedAt: Date.now(),
  }
  emitSnapshot(record)
  return record.snapshot
}

export function attachView(sessionId, viewAdapter = {}) {
  const record = ensureSessionRecord(sessionId)
  const viewId = viewAdapter.viewId || makeId('assistant-view')
  record.views.set(viewId, {
    viewId,
    onSnapshot: typeof viewAdapter.onSnapshot === 'function' ? viewAdapter.onSnapshot : null,
  })
  emitSnapshot(record)
  return viewId
}

export function detachView(sessionId, viewId) {
  const record = ensureSessionRecord(sessionId)
  record.views.delete(viewId)
  return record.snapshot
}

export function send(sessionId, payload = {}) {
  const record = ensureSessionRecord(sessionId)
  if (typeof record.handlers.send !== 'function') {
    throw new Error('assistant runtime 未绑定 send 处理器')
  }
  return record.handlers.send(payload)
}

export function abort(sessionId, runId = null) {
  const record = ensureSessionRecord(sessionId)
  if (typeof record.handlers.abort !== 'function') return false
  return record.handlers.abort(runId)
}

export function getSnapshot(sessionId) {
  return ensureSessionRecord(sessionId).snapshot
}

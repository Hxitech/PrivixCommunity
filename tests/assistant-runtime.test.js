import test from 'node:test'
import assert from 'node:assert/strict'

import {
  abort,
  attachView,
  createSession,
  detachView,
  getSnapshot,
  send,
  setSessionHandlers,
  updateSessionSnapshot,
} from '../src/lib/assistant-runtime.js'

test('assistant runtime can attach views and route send/abort handlers', async () => {
  const sessionId = createSession('assistant-test')
  const snapshots = []

  const viewId = attachView(sessionId, {
    onSnapshot(snapshot) {
      snapshots.push(snapshot)
    },
  })

  let sendPayload = null
  let abortRunId = null
  setSessionHandlers(sessionId, {
    send(payload) {
      sendPayload = payload
      return { ok: true }
    },
    abort(runId) {
      abortRunId = runId
      return true
    },
  })

  updateSessionSnapshot(sessionId, { streaming: true, status: 'streaming', title: '后台助手' })
  const sendResult = await send(sessionId, { text: '继续执行' })
  const abortResult = abort(sessionId, 'run-1')

  assert.equal(sendResult.ok, true)
  assert.deepEqual(sendPayload, { text: '继续执行' })
  assert.equal(abortResult, true)
  assert.equal(abortRunId, 'run-1')
  assert.equal(getSnapshot(sessionId).title, '后台助手')
  assert.equal(snapshots.at(-1).streaming, true)

  detachView(sessionId, viewId)
})

import test from 'node:test'
import assert from 'node:assert/strict'

import { runStructuredAssistantTask } from '../src/lib/assistant-provider.js'
import { getAssistantStorageKeys } from '../src/lib/assistant-storage.js'

const originalLocalStorage = global.localStorage
const originalFetch = global.fetch
const originalAbortSignal = global.AbortSignal
const ASSISTANT_STORAGE_KEYS = getAssistantStorageKeys('invest_workbench')

function createStorage() {
  const store = new Map()
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}

function createJsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload
    },
    async text() {
      return JSON.stringify(payload)
    },
  }
}

test.before(() => {
  global.localStorage = createStorage()
})

test.after(() => {
  if (originalLocalStorage === undefined) delete global.localStorage
  else global.localStorage = originalLocalStorage

  if (originalFetch === undefined) delete global.fetch
  else global.fetch = originalFetch

  if (originalAbortSignal === undefined) delete global.AbortSignal
  else global.AbortSignal = originalAbortSignal
})

test.beforeEach(() => {
  global.localStorage.clear()
  global.localStorage.setItem(ASSISTANT_STORAGE_KEYS.config, JSON.stringify({
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-test',
    apiKey: 'sk-test',
    apiType: 'openai-completions',
  }))
})

test('runStructuredAssistantTask forwards timeout override to the request signal', async () => {
  let seenSignal = null
  global.AbortSignal = {
    timeout(ms) {
      return `signal-${ms}`
    },
  }
  global.fetch = async (_url, options = {}) => {
    seenSignal = options.signal
    return createJsonResponse(200, {
      choices: [
        {
          message: {
            content: '{"status":"ok"}',
          },
        },
      ],
    })
  }

  const result = await runStructuredAssistantTask({
    config: {
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-test',
      apiKey: 'sk-test',
      apiType: 'openai-completions',
    },
    systemPrompt: 'system',
    userPrompt: 'user',
    timeoutMs: 12345,
  })

  assert.equal(seenSignal, 'signal-12345')
  assert.deepEqual(result.json, { status: 'ok' })
})

test('runStructuredAssistantTask surfaces timeout with actionable guidance', async () => {
  global.fetch = async () => {
    const error = new Error('The operation was aborted due to timeout')
    error.name = 'AbortError'
    throw error
  }

  await assert.rejects(
    () => runStructuredAssistantTask({
      config: {
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-test',
        apiKey: 'sk-test',
        apiType: 'openai-completions',
      },
      systemPrompt: 'system',
      userPrompt: 'user',
      timeoutMs: 30000,
    }),
    /外部模型请求超时（30 秒）/,
  )
})

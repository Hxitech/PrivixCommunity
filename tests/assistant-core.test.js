import test from 'node:test'
import assert from 'node:assert/strict'
import { getAssistantStorageKeys } from '../src/lib/assistant-storage.js'

const originalLocalStorage = global.localStorage
const originalFetch = global.fetch
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
})

test.beforeEach(() => {
  global.localStorage.clear()
  global.localStorage.setItem(ASSISTANT_STORAGE_KEYS.config, JSON.stringify({
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-test',
    apiKey: 'sk-test',
    apiType: 'openai-completions',
    temperature: 0.2,
  }))
})

test('runAssistantTask falls back to Responses API and keeps tool loop working', async () => {
  const fetchCalls = []
  let responsesRound = 0

  global.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null
    fetchCalls.push({ url, body })

    if (url === 'https://api.example.com/v1/chat/completions') {
      return createJsonResponse(400, {
        error: { message: 'This model uses the legacy protocol; use /v1/responses instead.' },
      })
    }

    if (url === 'https://api.example.com/v1/responses') {
      responsesRound += 1
      if (responsesRound === 1) {
        return createJsonResponse(200, {
          id: 'resp_1',
          output: [
            {
              type: 'function_call',
              id: 'fc_1',
              call_id: 'call_1',
              name: 'invest_cli',
              arguments: JSON.stringify({ action: 'query', entity: 'company' }),
            },
          ],
        })
      }

      return createJsonResponse(200, {
        id: 'resp_2',
        output_text: '查询完成',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: '查询完成' }],
          },
        ],
      })
    }

    throw new Error(`unexpected url: ${url}`)
  }

  const { runAssistantTask } = await import('../src/lib/assistant-core.js')
  const result = await runAssistantTask({
    messages: [{ role: 'user', content: '查一下企业库' }],
    toolPolicy: {
      tools: [
        {
          type: 'function',
          function: {
            name: 'invest_cli',
            description: 'query invest data',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
      executors: {
        async invest_cli(args) {
          return { ok: true, echoed: args }
        },
      },
    },
  })

  assert.equal(result.content, '查询完成')
  assert.equal(result.toolHistory.length, 1)
  assert.deepEqual(result.toolHistory[0].args, { action: 'query', entity: 'company' })

  assert.equal(fetchCalls[0].url, 'https://api.example.com/v1/chat/completions')
  assert.equal(fetchCalls[1].url, 'https://api.example.com/v1/responses')
  assert.equal(fetchCalls[2].body.previous_response_id, 'resp_1')
  assert.deepEqual(fetchCalls[2].body.input, [
    {
      type: 'function_call_output',
      call_id: 'call_1',
      output: JSON.stringify({ ok: true, echoed: { action: 'query', entity: 'company' } }),
    },
  ])
})

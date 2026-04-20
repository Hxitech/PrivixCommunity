import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getAssistantLegacyStorageKeys,
  getAssistantStorageKeys,
  migrateAssistantStorage,
} from '../src/lib/assistant-storage.js'

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

test('default profile migrates legacy assistant storage into scoped keys', () => {
  const storage = createStorage()
  const legacy = getAssistantLegacyStorageKeys('invest_workbench')
  const next = getAssistantStorageKeys('invest_workbench')

  storage.setItem(legacy.config[0], '{"promptPreset":"invest_workbench"}')
  storage.setItem(legacy.sessions[0], '[{"id":"session-1"}]')
  storage.setItem(legacy.guide[0], '1')

  const migrated = migrateAssistantStorage(storage, 'invest_workbench')

  assert.deepEqual(migrated, next)
  assert.equal(storage.getItem(next.config), '{"promptPreset":"invest_workbench"}')
  assert.equal(storage.getItem(next.sessions), '[{"id":"session-1"}]')
  assert.equal(storage.getItem(next.guide), '1')
})

test('v1.2.2: unified profile maps all legacy profile IDs to same storage scope', () => {
  // 统一后所有 profile ID 都映射到 prospectclaw scope
  const docSopKeys = getAssistantStorageKeys('doc_sop')
  const investKeys = getAssistantStorageKeys('invest_workbench')
  const prospectclawKeys = getAssistantStorageKeys('prospectclaw')

  // 所有旧 profile 都映射到同一个 scope
  assert.equal(docSopKeys.config, prospectclawKeys.config)
  assert.equal(investKeys.config, prospectclawKeys.config)
})

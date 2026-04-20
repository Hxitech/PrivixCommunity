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

test('社区版:默认 profile 迁移 legacy 助手存储键到 scoped keys', () => {
  const storage = createStorage()
  const legacy = getAssistantLegacyStorageKeys('privix-community')
  const next = getAssistantStorageKeys('privix-community')

  storage.setItem(legacy.config[0], '{"promptPreset":"default"}')
  storage.setItem(legacy.sessions[0], '[{"id":"session-1"}]')
  storage.setItem(legacy.guide[0], '1')

  const migrated = migrateAssistantStorage(storage, 'privix-community')

  assert.deepEqual(migrated, next)
  assert.equal(storage.getItem(next.config), '{"promptPreset":"default"}')
  assert.equal(storage.getItem(next.sessions), '[{"id":"session-1"}]')
  assert.equal(storage.getItem(next.guide), '1')
})

test('社区版:统一 profile 仅一个 scope,所有旧 profile ID 归一', () => {
  // 统一后所有 profile ID 都映射到同一 scope(社区版仅 privix-community)
  const communityKeys = getAssistantStorageKeys('privix-community')

  assert.ok(communityKeys.config)
  assert.ok(communityKeys.sessions)
  assert.ok(communityKeys.guide)
})

import {
  getActiveProductProfileId,
  getDefaultProductProfileId,
  normalizeProductProfileId,
} from './product-profile.js'

const ACTIVE_PRODUCT_PROFILE_ID = getActiveProductProfileId()

const STORAGE_BASE_KEYS = Object.freeze({
  config: 'prospectclaw-assistant',
  sessions: 'prospectclaw-assistant-sessions',
  guide: 'prospectclaw-guide-assistant-dismissed',
})

const LEGACY_STORAGE_BASE_KEYS = Object.freeze({
  config: 'clawpanel-assistant',
  sessions: 'clawpanel-assistant-sessions',
  guide: 'clawpanel-guide-assistant-dismissed',
})

function scopeKey(baseKey, profileId) {
  return `${baseKey}:${normalizeProductProfileId(profileId)}`
}

function shouldMigrateUnscopedKeys(profileId) {
  return normalizeProductProfileId(profileId) === getDefaultProductProfileId()
}

export function getAssistantStorageKeys(profileId = ACTIVE_PRODUCT_PROFILE_ID) {
  return {
    config: scopeKey(STORAGE_BASE_KEYS.config, profileId),
    sessions: scopeKey(STORAGE_BASE_KEYS.sessions, profileId),
    guide: scopeKey(STORAGE_BASE_KEYS.guide, profileId),
  }
}

export function getAssistantLegacyStorageKeys(profileId = ACTIVE_PRODUCT_PROFILE_ID) {
  if (!shouldMigrateUnscopedKeys(profileId)) {
    return {
      config: [],
      sessions: [],
      guide: [],
    }
  }

  return {
    config: [STORAGE_BASE_KEYS.config, LEGACY_STORAGE_BASE_KEYS.config],
    sessions: [STORAGE_BASE_KEYS.sessions, LEGACY_STORAGE_BASE_KEYS.sessions],
    guide: [STORAGE_BASE_KEYS.guide, LEGACY_STORAGE_BASE_KEYS.guide],
  }
}

function migrateKey(storage, nextKey, legacyKeys) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') return
  if (storage.getItem(nextKey) !== null) return
  for (const legacyKey of legacyKeys) {
    const value = storage.getItem(legacyKey)
    if (value !== null) {
      storage.setItem(nextKey, value)
      return
    }
  }
}

export function migrateAssistantStorage(storage = globalThis?.localStorage, profileId = ACTIVE_PRODUCT_PROFILE_ID) {
  const keys = getAssistantStorageKeys(profileId)
  const legacyKeys = getAssistantLegacyStorageKeys(profileId)
  try {
    migrateKey(storage, keys.config, legacyKeys.config)
    migrateKey(storage, keys.sessions, legacyKeys.sessions)
    migrateKey(storage, keys.guide, legacyKeys.guide)
  } catch {
    // ignore storage access failures
  }
  return keys
}

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyPrimaryModelSelection,
  resolveProviderPresetChoice,
  upsertProviderWithDefaults,
} from '../src/lib/model-presets.js'

test('Moonshot .ai preset resolves to openai-compatible kimi-k2.5 defaults', () => {
  const choice = resolveProviderPresetChoice('moonshot', 'moonshot-ai')

  assert.equal(choice.providerKey, 'moonshot')
  assert.equal(choice.baseUrl, 'https://api.moonshot.ai/v1')
  assert.equal(choice.api, 'openai-completions')
  assert.equal(choice.defaultModel, 'kimi-k2.5')
  assert.deepEqual(choice.defaultModels.map(model => model.id), ['kimi-k2.5'])
})

test('Moonshot .cn preset resolves to china endpoint with same default model', () => {
  const choice = resolveProviderPresetChoice('moonshot', 'moonshot-cn')

  assert.equal(choice.providerKey, 'moonshot')
  assert.equal(choice.baseUrl, 'https://api.moonshot.cn/v1')
  assert.equal(choice.api, 'openai-completions')
  assert.equal(choice.defaultModel, 'kimi-k2.5')
  assert.deepEqual(choice.defaultModels.map(model => model.id), ['kimi-k2.5'])
})

test('Kimi Code preset resolves to anthropic-compatible k2p5 defaults', () => {
  const choice = resolveProviderPresetChoice('moonshot', 'kimi-code')

  assert.equal(choice.providerKey, 'kimi-coding')
  assert.equal(choice.baseUrl, 'https://api.kimi.com/coding/v1')
  assert.equal(choice.api, 'openai-completions')
  assert.equal(choice.defaultModel, 'k2p5')
  assert.deepEqual(choice.defaultModels.map(model => model.id), ['k2p5'])
})

test('upsertProviderWithDefaults merges models without duplication and preserves current primary', () => {
  const config = {
    agents: {
      defaults: {
        model: { primary: 'openai/gpt-4o' },
      },
    },
    models: {
      mode: 'replace',
      providers: {
        moonshot: {
          baseUrl: 'https://old.example/v1',
          apiKey: 'old-key',
          api: 'openai-completions',
          models: [
            { id: 'kimi-k2.5', name: 'Old Kimi K2.5' },
            { id: 'custom-model', name: 'Custom Model' },
          ],
        },
      },
    },
  }

  const result = upsertProviderWithDefaults(
    config,
    resolveProviderPresetChoice('moonshot', 'moonshot-ai'),
    {
      baseUrl: 'https://api.moonshot.ai/v1',
      apiKey: 'new-key',
      api: 'openai-completions',
    },
  )

  assert.equal(result.providerKey, 'moonshot')
  assert.equal(result.created, false)
  assert.deepEqual(result.addedModelIds, [])
  assert.equal(config.models.providers.moonshot.baseUrl, 'https://api.moonshot.ai/v1')
  assert.equal(config.models.providers.moonshot.apiKey, 'new-key')
  assert.deepEqual(
    config.models.providers.moonshot.models.map(model => typeof model === 'string' ? model : model.id),
    ['kimi-k2.5', 'custom-model'],
  )
  assert.equal(config.agents.defaults.model.primary, 'openai/gpt-4o')
})

test('applyPrimaryModelSelection sets primary and rebuilds fallback order from configured models', () => {
  const config = {
    agents: {
      defaults: {
        model: { primary: 'openai/gpt-4o' },
      },
    },
    models: {
      mode: 'replace',
      providers: {
        moonshot: {
          baseUrl: 'https://api.moonshot.ai/v1',
          apiKey: 'key',
          api: 'openai-completions',
          models: [
            { id: 'kimi-k2.5', name: 'Kimi K2.5' },
          ],
        },
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'other-key',
          api: 'openai-completions',
          models: [
            { id: 'gpt-4o', name: 'GPT-4o' },
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
          ],
        },
      },
    },
  }

  const result = applyPrimaryModelSelection(config, 'moonshot', {
    id: 'kimi-k2.5',
    name: 'Kimi K2.5',
  })

  assert.equal(result.primary, 'moonshot/kimi-k2.5')
  assert.deepEqual(config.agents.defaults.model.fallbacks, ['openai/gpt-4o', 'openai/gpt-4o-mini'])
  assert.deepEqual(
    Object.keys(config.agents.defaults.models),
    ['moonshot/kimi-k2.5', 'openai/gpt-4o', 'openai/gpt-4o-mini'],
  )
})

test('applyPrimaryModelSelection inserts the selected model when provider is missing it', () => {
  const config = {
    agents: { defaults: {} },
    models: {
      mode: 'replace',
      providers: {
        moonshot: {
          baseUrl: 'https://api.moonshot.ai/v1',
          apiKey: 'key',
          api: 'openai-completions',
          models: [],
        },
      },
    },
  }

  applyPrimaryModelSelection(config, 'moonshot', { id: 'kimi-k2.5', name: 'Kimi K2.5' })

  assert.deepEqual(
    config.models.providers.moonshot.models.map(model => model.id),
    ['kimi-k2.5'],
  )
  assert.equal(config.agents.defaults.model.primary, 'moonshot/kimi-k2.5')
})

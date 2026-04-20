import test from 'node:test'
import assert from 'node:assert/strict'

import {
  extractGatewayChatContent,
  mergeGatewayChatState,
  normalizeGatewayChatEvent,
  stripThinkingTags,
} from '../src/lib/chat-event-compat.js'

test('normalizeGatewayChatEvent handles cumulative deltas', () => {
  const result = normalizeGatewayChatEvent({
    state: 'delta',
    message: { content: 'Hello world' },
  }, 'Hello')

  assert.equal(result.text, 'Hello world')
  assert.equal(result.hasContent, true)
})

test('normalizeGatewayChatEvent handles incremental deltas', () => {
  const result = normalizeGatewayChatEvent({
    state: 'delta',
    delta: ' world',
  }, 'Hello')

  assert.equal(result.text, 'Hello world')
  assert.equal(result.hasContent, true)
})

test('normalizeGatewayChatEvent can render final-only replies with media', () => {
  const result = normalizeGatewayChatEvent({
    state: 'final',
    message: {
      content: [
        { type: 'image_url', image_url: { url: 'https://example.com/demo.png' } },
      ],
    },
  }, '')

  assert.equal(result.text, '')
  assert.equal(result.images.length, 1)
  assert.equal(result.hasContent, true)
})

test('mergeGatewayChatState prefers authoritative final text over earlier partial delta text', () => {
  const merged = mergeGatewayChatState({
    text: 'He',
    images: [],
    videos: [],
    audios: [],
    files: [],
  }, {
    state: 'final',
    text: 'Hello world',
    images: [],
    videos: [],
    audios: [],
    files: [],
  })

  assert.equal(merged.text, 'Hello world')
  assert.equal(merged.hasContent, true)
})

test('mergeGatewayChatState preserves buffered text when final event only contributes media', () => {
  const merged = mergeGatewayChatState({
    text: 'Visible answer',
    images: [],
    videos: [],
    audios: [],
    files: [],
  }, {
    state: 'final',
    text: '',
    images: [],
    videos: [],
    audios: [],
    files: [{ name: 'memo.pdf', url: 'https://example.com/memo.pdf' }],
  })

  assert.equal(merged.text, 'Visible answer')
  assert.equal(merged.files.length, 1)
  assert.equal(merged.hasContent, true)
})

test('extractGatewayChatContent and stripThinkingTags preserve visible text only', () => {
  const message = {
    content: [
      { type: 'text', text: '<thinking>ignore me</thinking>\nVisible answer' },
      { type: 'file', name: 'memo.pdf', url: 'https://example.com/memo.pdf' },
    ],
  }

  const content = extractGatewayChatContent(message)
  assert.equal(stripThinkingTags(content.text), 'Visible answer')
  assert.equal(content.files.length, 1)
})

test('extractGatewayChatContent unwraps nested message payloads from history events', () => {
  const wrapped = {
    message: {
      role: 'toolResult',
      content: [
        { type: 'text', text: 'Sub-agent final answer' },
        { type: 'image_url', image_url: { url: 'https://example.com/subagent.png' } },
      ],
    },
  }

  const content = extractGatewayChatContent(wrapped)
  assert.equal(content.text, 'Sub-agent final answer')
  assert.equal(content.images.length, 1)
})

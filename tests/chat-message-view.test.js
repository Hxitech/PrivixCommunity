import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildChatMessageGroups,
  decideRenderMode,
  dedupeHistoryMessages,
  getMessageGroupPosition,
  groupChatMessages,
  normalizeChatMessage,
} from '../src/lib/chat-message-view.js'

test('decideRenderMode keeps streaming replies in plain mode', () => {
  const mode = decideRenderMode({
    text: '正在生成中的回复',
    attachments: [],
    isStreaming: true,
  })

  assert.equal(mode, 'plain')
})

test('decideRenderMode upgrades structured long content to rich mode', () => {
  const mode = decideRenderMode({
    text: '# 标题\n\n- 一\n- 二\n- 三\n\n这是一段足够长的结构化说明，包含多个段落和列表项，用来触发富文本模式。',
    attachments: [],
    isStreaming: false,
  })

  assert.equal(mode, 'rich')
})

test('groupChatMessages preserves separate assistant replies while grouping adjacency', () => {
  const baseTs = Date.now()
  const grouped = groupChatMessages([
    normalizeChatMessage({ id: 'u1', role: 'user', text: 'hello', timestamp: baseTs }),
    normalizeChatMessage({ id: 'a1', role: 'assistant', text: 'first', timestamp: baseTs + 1000 }),
    normalizeChatMessage({ id: 'a2', role: 'assistant', text: 'second', timestamp: baseTs + 2000 }),
    normalizeChatMessage({ id: 'u2', role: 'user', text: 'thanks', timestamp: baseTs + 4000 }),
  ])

  assert.deepEqual(
    grouped.map(item => [item.id, item.groupPosition]),
    [['u1', 'single'], ['a1', 'first'], ['a2', 'last'], ['u2', 'single']],
  )
})

test('getMessageGroupPosition only depends on adjacent messages', () => {
  const baseTs = Date.now()
  const prev = normalizeChatMessage({ id: 'a1', role: 'assistant', text: 'first', timestamp: baseTs })
  const current = normalizeChatMessage({ id: 'a2', role: 'assistant', text: 'second', timestamp: baseTs + 1000 })
  const next = normalizeChatMessage({ id: 'u1', role: 'user', text: 'break', timestamp: baseTs + 2000 })

  assert.equal(
    getMessageGroupPosition({ prev, message: current, next }),
    'last',
  )

  assert.equal(
    getMessageGroupPosition({ prev: null, message: current, next: null }),
    'single',
  )
})

test('dedupeHistoryMessages drops exact duplicates without merging distinct replies', () => {
  const baseTs = Date.now()
  const deduped = dedupeHistoryMessages([
    { id: 'a1', role: 'assistant', text: 'same reply', timestamp: baseTs },
    { id: 'a2', role: 'assistant', text: 'same reply', timestamp: baseTs },
    { id: 'a3', role: 'assistant', text: 'another reply', timestamp: baseTs + 1000 },
  ])

  assert.equal(deduped.length, 2)
  assert.deepEqual(deduped.map(item => item.text), ['same reply', 'another reply'])
})

test('buildChatMessageGroups merges adjacent assistant replies into one group', () => {
  const baseTs = Date.now()
  const groups = buildChatMessageGroups([
    normalizeChatMessage({ id: 'u1', role: 'user', text: 'hi', timestamp: baseTs }),
    normalizeChatMessage({ id: 'a1', role: 'assistant', text: 'first', timestamp: baseTs + 1000 }),
    normalizeChatMessage({ id: 'a2', role: 'assistant', text: 'second', timestamp: baseTs + 2000 }),
    normalizeChatMessage({ id: 'u2', role: 'user', text: 'ok', timestamp: baseTs + 4000 }),
  ])

  assert.deepEqual(
    groups.map(group => [group.role, group.messages.length]),
    [['user', 1], ['assistant', 2], ['user', 1]],
  )
})

test('tool result messages preserve tool kind inside grouped history', () => {
  const groups = buildChatMessageGroups([
    normalizeChatMessage({ id: 'tool-1', role: 'assistant', kind: 'tool', text: '{"tool":"search"}' }),
  ])

  assert.equal(groups[0].messages[0].kind, 'tool')
})

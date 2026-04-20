import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createStreamRenderController,
  isNearBottom,
  selectStreamingTextRenderMode,
  shouldForceStreamingRefresh,
  STREAMING_TEXT_FALLBACK_THRESHOLD,
} from '../src/lib/chat-streaming.js'

test('stream render fallback flushes even when rAF is unavailable', () => {
  let nowValue = 10
  let renders = 0
  const timers = []

  const controller = createStreamRenderController({
    render: () => { renders++ },
    now: () => nowValue,
    requestAnimationFrameImpl: () => {},
    setTimeoutImpl: (cb, delay) => {
      timers.push({ cb, delay })
      return timers.length
    },
    clearTimeoutImpl: () => {},
    isDocumentHidden: () => true,
  })

  controller.schedule()
  assert.equal(renders, 0)
  assert.equal(timers.length, 1)
  assert.ok(timers[0].delay >= 30)

  nowValue = 120
  timers[0].cb()
  assert.equal(renders, 1)
})

test('visible-page refresh can force latest buffered stream content to render', () => {
  let buffer = 'first chunk'
  const rendered = []
  const controller = createStreamRenderController({
    render: () => rendered.push(buffer),
    now: () => 100,
    requestAnimationFrameImpl: () => {},
    setTimeoutImpl: () => 1,
    clearTimeoutImpl: () => {},
    isDocumentHidden: () => false,
  })

  buffer = 'latest chunk'
  assert.equal(
    shouldForceStreamingRefresh({ isStreaming: true, isDocumentHidden: false, hasBufferedText: true }),
    true,
  )
  controller.force()
  assert.deepEqual(rendered, ['latest chunk'])
})

test('streaming text render mode degrades to plain text after threshold', () => {
  assert.equal(
    selectStreamingTextRenderMode({
      textLength: STREAMING_TEXT_FALLBACK_THRESHOLD - 1,
      currentMode: 'html',
    }),
    'html',
  )

  assert.equal(
    selectStreamingTextRenderMode({
      textLength: STREAMING_TEXT_FALLBACK_THRESHOLD,
      currentMode: 'html',
    }),
    'text',
  )

  assert.equal(
    selectStreamingTextRenderMode({
      textLength: 10,
      currentMode: 'text',
    }),
    'text',
  )
})

test('near-bottom detection prevents forced follow when user scrolled away', () => {
  assert.equal(
    isNearBottom({
      scrollTop: 920,
      scrollHeight: 1000,
      clientHeight: 40,
    }),
    true,
  )

  assert.equal(
    isNearBottom({
      scrollTop: 400,
      scrollHeight: 1000,
      clientHeight: 300,
    }),
    false,
  )
})

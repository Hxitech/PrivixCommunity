import test from 'node:test'
import assert from 'node:assert/strict'

import { createCompositionState, isImeComposing, shouldSubmitOnEnter } from '../src/lib/input-helpers.js'

test('IME composition blocks Enter submission', async () => {
  const composition = createCompositionState()
  composition.handleCompositionStart()

  assert.equal(
    shouldSubmitOnEnter({ key: 'Enter', shiftKey: false }, { localIsComposing: composition.isActive() }),
    false,
  )
  assert.equal(
    isImeComposing({ key: 'Enter', keyCode: 229 }, false),
    true,
  )

  composition.handleCompositionEnd()
  assert.equal(
    shouldSubmitOnEnter({ key: 'Enter', shiftKey: false }, { localIsComposing: composition.isActive() }),
    false,
  )

  await new Promise(resolve => setTimeout(resolve, 1))
  assert.equal(composition.isActive(), false)
})

test('plain Enter submits and Shift+Enter keeps newline behavior', () => {
  assert.equal(
    shouldSubmitOnEnter({ key: 'Enter', shiftKey: false }, { localIsComposing: false }),
    true,
  )
  assert.equal(
    shouldSubmitOnEnter({ key: 'Enter', shiftKey: true }, { localIsComposing: false }),
    false,
  )
})

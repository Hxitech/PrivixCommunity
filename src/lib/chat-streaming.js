export const STREAM_RENDER_THROTTLE_MS = 30
export const STREAM_RENDER_FALLBACK_MS = 80
export const STREAMING_TEXT_FALLBACK_THRESHOLD = 4000
export const STREAM_AUTO_SCROLL_THRESHOLD_PX = 80

export function shouldForceStreamingRefresh({ isStreaming, isDocumentHidden, hasBufferedText }) {
  return Boolean(isStreaming && !isDocumentHidden && hasBufferedText)
}

export function selectStreamingTextRenderMode({
  textLength = 0,
  currentMode = 'html',
  fallbackThreshold = STREAMING_TEXT_FALLBACK_THRESHOLD,
} = {}) {
  if (currentMode === 'text') return 'text'
  return textLength >= fallbackThreshold ? 'text' : 'html'
}

export function isNearBottom({
  scrollTop = 0,
  scrollHeight = 0,
  clientHeight = 0,
  thresholdPx = STREAM_AUTO_SCROLL_THRESHOLD_PX,
} = {}) {
  return (scrollHeight - scrollTop - clientHeight) <= thresholdPx
}

export function createStreamRenderController({
  render,
  now = () => performance.now(),
  requestAnimationFrameImpl = cb => requestAnimationFrame(cb),
  setTimeoutImpl = (cb, delay) => setTimeout(cb, delay),
  clearTimeoutImpl = timer => clearTimeout(timer),
  isDocumentHidden = () => document.hidden,
  throttleMs = STREAM_RENDER_THROTTLE_MS,
  fallbackMs = STREAM_RENDER_FALLBACK_MS,
} = {}) {
  let lastRenderTime = 0
  let pending = false
  let fallbackTimer = null

  const clearFallback = () => {
    if (fallbackTimer) {
      clearTimeoutImpl(fallbackTimer)
      fallbackTimer = null
    }
  }

  const flush = () => {
    pending = false
    clearFallback()
    lastRenderTime = now()
    render()
  }

  return {
    schedule() {
      if (pending) return

      const elapsed = now() - lastRenderTime
      if (elapsed >= throttleMs) {
        flush()
        return
      }

      pending = true
      const runFlush = () => {
        if (!pending) return
        flush()
      }

      if (!isDocumentHidden() && typeof requestAnimationFrameImpl === 'function') {
        requestAnimationFrameImpl(runFlush)
      }

      fallbackTimer = setTimeoutImpl(runFlush, Math.max(fallbackMs, throttleMs - elapsed))
    },
    force() {
      flush()
    },
    reset() {
      pending = false
      clearFallback()
      lastRenderTime = 0
    },
    getLastRenderTime() {
      return lastRenderTime
    },
    isPending() {
      return pending
    },
  }
}

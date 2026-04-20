export function isImeComposing(event, localIsComposing = false) {
  return Boolean(
    localIsComposing
    || event?.isComposing
    || event?.nativeEvent?.isComposing
    || event?.keyCode === 229
    || event?.which === 229
  )
}

export function shouldSubmitOnEnter(event, { localIsComposing = false } = {}) {
  if (!event || event.key !== 'Enter') return false
  if (event.shiftKey) return false
  return !isImeComposing(event, localIsComposing)
}

export function createCompositionState() {
  let localIsComposing = false
  let releaseTimer = null

  const clearReleaseTimer = () => {
    if (releaseTimer) {
      clearTimeout(releaseTimer)
      releaseTimer = null
    }
  }

  return {
    isActive() {
      return localIsComposing
    },
    handleCompositionStart() {
      clearReleaseTimer()
      localIsComposing = true
    },
    handleCompositionEnd() {
      clearReleaseTimer()
      // Some IMEs emit Enter in the same task right after compositionend.
      releaseTimer = setTimeout(() => {
        localIsComposing = false
        releaseTimer = null
      }, 0)
    },
    reset() {
      clearReleaseTimer()
      localIsComposing = false
    },
  }
}

/**
 * 为消息容器添加复制按钮事件委托
 * @param {HTMLElement} container - 消息列表容器
 * @param {string} wrapperSel - 消息包装元素选择器（如 '.msg' 或 '.ast-msg'）
 * @param {string} bubbleSel - 气泡元素选择器（如 '.msg-bubble' 或 '.ast-msg-bubble'）
 * @param {Function} iconFn - 图标渲染函数（icon(name, size)）
 */
export function bindCopyButtons(container, { wrapperSel, bubbleSel, iconFn }) {
  container.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.msg-copy-btn')
    if (!copyBtn) return
    e.stopPropagation()
    const msgWrap = copyBtn.closest(wrapperSel)
    const bubble = msgWrap?.querySelector(bubbleSel)
    if (!bubble) return
    const text = bubble.innerText || bubble.textContent || ''
    navigator.clipboard.writeText(text.trim()).then(() => {
      copyBtn.classList.add('copied')
      copyBtn.innerHTML = iconFn('check', 12)
      setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.innerHTML = iconFn('copy', 12) }, 1500)
    }).catch(() => {})
  })
}

export function bindCompositionState(target, compositionState) {
  if (!target || !compositionState) return () => {}

  const onStart = () => compositionState.handleCompositionStart()
  const onEnd = () => compositionState.handleCompositionEnd()

  target.addEventListener('compositionstart', onStart)
  target.addEventListener('compositionend', onEnd)

  return () => {
    target.removeEventListener('compositionstart', onStart)
    target.removeEventListener('compositionend', onEnd)
    compositionState.reset()
  }
}

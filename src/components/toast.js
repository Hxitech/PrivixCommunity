/**
 * Toast 通知组件
 */
let _container = null

const ICONS = {
  success: '✓',
  error: '✕',
  warning: '!',
  info: 'i',
}

function ensureContainer() {
  if (!_container) {
    _container = document.createElement('div')
    _container.className = 'toast-container'
    document.body.appendChild(_container)
  }
  return _container
}

export function toast(message, type = 'info', options = {}) {
  const duration = options.duration || 3000
  const action = options.action // 可选的操作按钮（DOM 元素）

  const container = ensureContainer()
  const el = document.createElement('div')
  el.className = `toast ${type}`

  const icon = document.createElement('span')
  icon.className = 'toast-icon'
  icon.textContent = ICONS[type] || ICONS.info
  el.appendChild(icon)

  const textSpan = document.createElement('span')
  textSpan.textContent = message
  el.appendChild(textSpan)

  // 如果有操作按钮，添加到 toast 中
  if (action instanceof HTMLElement) {
    el.appendChild(action)
  }

  container.appendChild(el)

  setTimeout(() => {
    el.style.opacity = '0'
    el.style.transform = 'translateX(16px) scale(0.96)'
    el.style.transition = 'all 200ms ease-in'
    setTimeout(() => el.remove(), 200)
  }, duration)
}

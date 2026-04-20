/**
 * Modal 弹窗组件
 */
import { t } from '../lib/i18n.js'

const CLOSE_ANIMATION_FALLBACK_MS = 220

function prefersReducedMotion() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
}

// 带退出动画的关闭函数
function closeWithAnimation(overlay, callback) {
  if (!overlay || overlay.dataset.closing === '1') return false

  const modal = overlay.querySelector('.modal')
  overlay.dataset.closing = '1'
  overlay.setAttribute('aria-hidden', 'true')
  overlay.querySelectorAll('button').forEach(btn => { btn.disabled = true })

  const activeEl = document.activeElement
  if (activeEl instanceof HTMLElement && overlay.contains(activeEl)) activeEl.blur()

  const finish = () => {
    if (!overlay || overlay.dataset.closed === '1') return
    overlay.dataset.closed = '1'
    overlay.remove()
    callback?.()
  }

  if (prefersReducedMotion()) {
    finish()
    return true
  }

  let done = false
  const cleanup = () => {
    overlay.removeEventListener('animationend', handleAnimationEnd)
    modal?.removeEventListener('animationend', handleAnimationEnd)
    clearTimeout(fallbackTimer)
  }
  const handleAnimationEnd = (event) => {
    if (event && modal && event.target !== modal && event.target !== overlay) return
    if (done) return
    done = true
    cleanup()
    finish()
  }

  if (modal) modal.classList.add('closing')
  overlay.classList.add('closing')
  overlay.addEventListener('animationend', handleAnimationEnd)
  modal?.addEventListener('animationend', handleAnimationEnd)
  const fallbackTimer = setTimeout(() => handleAnimationEnd(), CLOSE_ANIMATION_FALLBACK_MS)
  return true
}

// 转义 HTML 属性值，防止双引号等字符破坏 HTML 结构
function escapeAttr(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * 自定义确认弹窗，替代原生 confirm()
 * Tauri WebView 不支持原生 confirm/alert，必须用自定义弹窗
 * @param {string} message 确认消息
 * @returns {Promise<boolean>} 用户选择确认返回 true，取消返回 false
 */
export function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px">
        <div class="modal-title">${t('comp_modal.confirm_title')}</div>
        <div class="modal-body" style="font-size:var(--font-size-sm);color:var(--text-secondary);white-space:pre-wrap;line-height:1.6">${escapeAttr(message)}</div>
        <div class="modal-actions">
          <button class="btn btn-secondary btn-sm" data-action="cancel">${t('comp_modal.btn_cancel')}</button>
          <button class="btn btn-danger btn-sm" data-action="confirm">${t('comp_modal.btn_confirm')}</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)

    const close = (result) => {
      closeWithAnimation(overlay, () => resolve(result))
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false)
    })
    overlay.querySelector('[data-action="cancel"]').onclick = () => close(false)
    overlay.querySelector('[data-action="confirm"]').onclick = () => close(true)
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); close(true) }
      else if (e.key === 'Escape') close(false)
    })
    // 聚焦确认按钮以接收键盘事件
    overlay.querySelector('[data-action="confirm"]').focus()
  })
}

export function showModal({ title, fields, onConfirm }) {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'

  const fieldHtml = fields.map(f => {
    if (f.type === 'checkbox') {
      return `
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" data-name="${f.name}" ${f.value ? 'checked' : ''}>
            <span class="form-label" style="margin:0">${f.label}</span>
          </label>
          ${f.hint ? `<div class="form-hint">${f.hint}</div>` : ''}
        </div>`
    }
    if (f.type === 'select') {
      return `
        <div class="form-group">
          <label class="form-label">${f.label}</label>
          <select class="form-input" data-name="${f.name}">
            ${f.options.map(o => `<option value="${o.value}" ${o.value === f.value ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
          ${f.hint ? `<div class="form-hint">${f.hint}</div>` : ''}
        </div>`
    }
    return `
      <div class="form-group">
        <label class="form-label">${f.label}</label>
        <input class="form-input" data-name="${f.name}" value="${escapeAttr(f.value)}" placeholder="${escapeAttr(f.placeholder)}"${f.readonly ? ' readonly style="opacity:0.6;cursor:not-allowed"' : ''}>
        ${f.hint ? `<div class="form-hint">${f.hint}</div>` : ''}
      </div>`
  }).join('')

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-title">${title}</div>
      ${fieldHtml}
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" data-action="cancel">${t('comp_modal.btn_cancel')}</button>
        <button class="btn btn-primary btn-sm" data-action="confirm">${t('comp_modal.btn_confirm')}</button>
      </div>
    </div>
  `

  document.body.appendChild(overlay)

  // 点击遮罩关闭
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeWithAnimation(overlay)
  })

  overlay.querySelector('[data-action="cancel"]').onclick = () => closeWithAnimation(overlay)

  overlay.querySelector('[data-action="confirm"]').onclick = () => {
    if (overlay.dataset.closing === '1') return

    const result = {}
    overlay.querySelectorAll('[data-name]').forEach(el => {
      if (el.type === 'checkbox') {
        result[el.dataset.name] = el.checked
      } else {
        result[el.dataset.name] = el.value
      }
    })
    const callback = onConfirm
    closeWithAnimation(overlay, () => callback?.(result))
  }

  // 键盘事件：Enter 确认，Escape 关闭
  const handleKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      overlay.querySelector('[data-action="confirm"]')?.click()
    } else if (e.key === 'Escape') {
      closeWithAnimation(overlay)
    }
  }
  overlay.addEventListener('keydown', handleKey)

  // 自动聚焦第一个输入框
  const firstInput = overlay.querySelector('input, select')
  if (firstInput) firstInput.focus()
}

/**
 * 通用内容弹窗 — 支持自定义 HTML 和按钮
 * @param {{ title, content, buttons, width }} opts
 *   buttons: [{ label, className, id }]
 * @returns {HTMLElement} overlay 元素（带 .close() 方法）
 */
export function showContentModal({ title, content, buttons = [], width = 480 }) {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'

  const btnsHtml = buttons.map(b =>
    `<button class="${b.className || 'btn btn-primary btn-sm'}" id="${b.id || ''}">${b.label}</button>`
  ).join('')

  overlay.innerHTML = `
    <div class="modal" style="max-width:${width}px">
      <div class="modal-title">${title}</div>
      <div class="modal-content-body">${content}</div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" data-action="cancel">${t('comp_modal.btn_cancel')}</button>
        ${btnsHtml}
      </div>
    </div>
  `

  document.body.appendChild(overlay)

  overlay.close = () => closeWithAnimation(overlay)

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeWithAnimation(overlay)
  })
  overlay.querySelector('[data-action="cancel"]').onclick = () => closeWithAnimation(overlay)
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeWithAnimation(overlay)
  })

  // 自动聚焦第一个输入框或按钮
  const firstInput = overlay.querySelector('input, textarea, select')
  if (firstInput) firstInput.focus()

  return overlay
}

/**
 * 升级进度弹窗 — 带进度条和实时日志
 * @returns {{ appendLog, setProgress, setDone, setError, destroy }}
 */
export function showUpgradeModal(title) {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px">
      <div class="modal-title">${title || t('comp_modal.upgrade_title')}</div>
      <div class="upgrade-progress-wrap">
        <div class="upgrade-progress-bar"><div class="upgrade-progress-fill" style="width:0%"></div></div>
        <div class="upgrade-progress-text">${t('comp_modal.upgrade_preparing')}</div>
      </div>
      <div class="upgrade-log-box"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" data-action="close">${t('comp_modal.btn_close')}</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  const fill = overlay.querySelector('.upgrade-progress-fill')
  const text = overlay.querySelector('.upgrade-progress-text')
  const logBox = overlay.querySelector('.upgrade-log-box')
  const closeBtn = overlay.querySelector('[data-action="close"]')
  const _logLines = []

  let _onClose = null
  let _finished = false
  let _taskBar = null

  // 重新打开弹窗（从任务状态栏点击时）
  function reopenModal() {
    if (_taskBar) { _taskBar.remove(); _taskBar = null }
    document.body.appendChild(overlay)
  }

  // 关闭弹窗：未完成时显示任务状态栏
  function closeModal() {
    overlay.remove()
    if (!_finished) {
      showTaskBar()
    } else {
      if (_taskBar) { _taskBar.remove(); _taskBar = null }
      _onClose?.()
    }
  }

  // 全局任务状态栏：关闭弹窗后显示在页面顶部
  function showTaskBar() {
    if (_taskBar) return
    _taskBar = document.createElement('div')
    _taskBar.className = 'upgrade-task-bar'
    _taskBar.innerHTML = `
      <span class="upgrade-task-bar-text">${text.textContent}</span>
      <button class="btn btn-sm upgrade-task-bar-open">${t('comp_modal.task_bar_details')}</button>
      <button class="btn btn-sm btn-ghost upgrade-task-bar-dismiss">×</button>
    `
    _taskBar.querySelector('.upgrade-task-bar-open').onclick = reopenModal
    _taskBar.querySelector('.upgrade-task-bar-dismiss').onclick = () => { _taskBar.remove(); _taskBar = null }
    document.body.appendChild(_taskBar)
  }

  function updateTaskBar(statusText) {
    if (_taskBar) {
      const span = _taskBar.querySelector('.upgrade-task-bar-text')
      if (span) span.textContent = statusText
    }
  }

  closeBtn.onclick = closeModal
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal()
  })

  return {
    appendLog(line) {
      _logLines.push(line)
      const div = document.createElement('div')
      div.textContent = line
      logBox.appendChild(div)
      logBox.scrollTop = logBox.scrollHeight
    },
    appendHtmlLog(line) {
      _logLines.push(line)
      const div = document.createElement('div')
      div.innerHTML = line
      logBox.appendChild(div)
      logBox.scrollTop = logBox.scrollHeight
    },
    getLogText() { return _logLines.join('\n') },
    setProgress(pct) {
      fill.style.width = pct + '%'
      let statusText
      if (pct >= 100) statusText = t('comp_modal.upgrade_done')
      else if (pct >= 75) statusText = t('comp_modal.upgrade_installing')
      else if (pct >= 30) statusText = t('comp_modal.upgrade_downloading')
      else statusText = t('comp_modal.upgrade_preparing')
      text.textContent = statusText
      updateTaskBar(statusText)
    },
    setDone(msg) {
      _finished = true
      text.textContent = msg || t('comp_modal.upgrade_complete')
      fill.style.width = '100%'
      fill.classList.add('done')
      if (_taskBar) { _taskBar.remove(); _taskBar = null }
      closeBtn.focus()
    },
    setError(msg, { helpContext, logText, onAskAIHelp } = {}) {
      _finished = true
      text.textContent = msg || t('comp_modal.upgrade_failed')
      fill.classList.add('error')
      if (_taskBar) {
        const span = _taskBar.querySelector('.upgrade-task-bar-text')
        if (span) { span.textContent = msg || t('comp_modal.upgrade_failed'); span.style.color = 'var(--error)' }
      }
      const actions = overlay.querySelector('.modal-actions')
      if (actions && !actions.querySelector('.btn-ask-ai-help')) {
        const helpBtn = document.createElement('button')
        helpBtn.className = 'btn btn-primary btn-sm btn-ask-ai-help'
        helpBtn.textContent = t('diag.btn_ask_ai')
        helpBtn.onclick = () => {
          const fullLog = logText || _logLines.join('\n')
          const prompt = `我在安装/升级 OpenClaw 时遇到问题：\n\n错误信息：${msg}\n\n${helpContext ? `错误类型：${helpContext}\n\n` : ''}安装日志（最后部分）：\n${fullLog.slice(-1500)}\n\n请帮我分析问题并给出解决步骤。`
          overlay.remove()
          if (_taskBar) { _taskBar.remove(); _taskBar = null }
          if (onAskAIHelp) {
            onAskAIHelp(prompt)
          } else {
            // 默认行为：跳转到 AI 助手
            import('../lib/post-install.js').then(m => m.navigateToAIAssistant(prompt))
          }
        }
        actions.insertBefore(helpBtn, actions.firstChild)
      }
      closeBtn.focus()
    },
    onClose(fn) { _onClose = fn },
    destroy() { overlay.remove(); if (_taskBar) { _taskBar.remove(); _taskBar = null } _onClose?.() },
  }
}

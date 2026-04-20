/**
 * 操作成功 Toast + 下一步提示
 * 从顶部滑入，带进度条和下一步跳转
 */
import { t } from '../lib/i18n.js'

const STYLE_ID = 'success-toast-styles'
const CONTAINER_ID = 'success-toast-container'

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    /* ── 容器：固定在顶部居中 ── */
    #success-toast-container {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9500;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      pointer-events: none;
    }

    /* ── 单条 Toast ── */
    .success-toast {
      background: var(--bg-secondary, #fff);
      border: 1px solid var(--border-primary, #E2E5EB);
      border-left: 3px solid var(--success, #0D7A3E);
      border-radius: 10px;
      box-shadow: 0 6px 24px rgba(15, 23, 42, 0.14);
      min-width: 320px;
      max-width: 480px;
      overflow: hidden;
      pointer-events: all;
      animation: success-toast-in 360ms cubic-bezier(0.34, 1.42, 0.64, 1) forwards;
    }
    @keyframes success-toast-in {
      from { opacity: 0; transform: translateY(-100%) scale(0.94); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .success-toast.dismissing {
      animation: success-toast-out 260ms ease-in forwards;
    }
    @keyframes success-toast-out {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to   { opacity: 0; transform: translateY(-20px) scale(0.92); }
    }

    .success-toast-body {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 16px 10px;
    }

    .success-toast-icon {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--success-muted, rgba(13,122,62,0.08));
      color: var(--success, #0D7A3E);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 700;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .success-toast-content {
      flex: 1;
      min-width: 0;
    }
    .success-toast-message {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary, #0F1419);
      line-height: 1.4;
      margin-bottom: 4px;
    }
    .success-toast-next {
      font-size: 12px;
      color: var(--text-tertiary, #9CA3AF);
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .success-toast-next-link {
      color: var(--accent, #5A72EE);
      font-weight: 500;
      cursor: pointer;
      background: none;
      border: none;
      padding: 0;
      font-size: 12px;
      font-family: var(--font-sans, 'Inter', sans-serif);
      text-decoration: underline;
      text-underline-offset: 2px;
      transition: color 150ms ease;
    }
    .success-toast-next-link:hover {
      color: var(--accent-hover, #4B63D8);
    }

    .success-toast-close {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-tertiary, #9CA3AF);
      font-size: 16px;
      padding: 4px;
      margin-top: -2px;
      flex-shrink: 0;
      line-height: 1;
      transition: color 150ms ease;
      font-family: var(--font-sans, 'Inter', sans-serif);
    }
    .success-toast-close:hover {
      color: var(--text-secondary, #4B5563);
    }

    /* 进度条 */
    .success-toast-progress {
      height: 3px;
      background: var(--success-muted, rgba(13,122,62,0.1));
      overflow: hidden;
    }
    .success-toast-progress-bar {
      height: 100%;
      background: var(--success, #0D7A3E);
      transform-origin: left center;
      animation: success-progress-shrink linear forwards;
    }
    @keyframes success-progress-shrink {
      from { transform: scaleX(1); }
      to   { transform: scaleX(0); }
    }
  `
  document.head.appendChild(style)
}

function getContainer() {
  let container = document.getElementById(CONTAINER_ID)
  if (!container) {
    container = document.createElement('div')
    container.id = CONTAINER_ID
    document.body.appendChild(container)
  }
  return container
}

/**
 * 显示操作成功 Toast，带下一步提示
 * @param {Object} options
 * @param {string} options.message - 成功信息
 * @param {Object} [options.nextStep] - 下一步提示 { text, action }
 * @param {number} [options.duration=4000] - 自动消失时间（ms）
 */
export function showSuccessToast({ message, nextStep = null, duration = 4000 } = {}) {
  injectStyles()
  const container = getContainer()

  const toast = document.createElement('div')
  toast.className = 'success-toast'

  const nextHtml = nextStep ? `
    <div class="success-toast-next">
      <span>${t('comp_success_toast.next_step_label')}</span>
      <button class="success-toast-next-link" id="toast-next-btn">${nextStep.text || t('comp_success_toast.next_step_continue')}</button>
    </div>
  ` : ''

  toast.innerHTML = `
    <div class="success-toast-body">
      <div class="success-toast-icon">✓</div>
      <div class="success-toast-content">
        <div class="success-toast-message">${message || t('comp_success_toast.default_message')}</div>
        ${nextHtml}
      </div>
      <button class="success-toast-close" id="toast-close-btn" aria-label="${t('comp_success_toast.close_label')}">✕</button>
    </div>
    <div class="success-toast-progress">
      <div class="success-toast-progress-bar" style="animation-duration: ${duration}ms"></div>
    </div>
  `

  container.appendChild(toast)

  let dismissed = false

  function dismiss() {
    if (dismissed) return
    dismissed = true
    toast.classList.add('dismissing')
    setTimeout(() => toast.remove(), 280)
  }

  // 自动消失
  const timer = setTimeout(dismiss, duration)

  // 关闭按钮
  toast.querySelector('#toast-close-btn')?.addEventListener('click', () => {
    clearTimeout(timer)
    dismiss()
  })

  // 下一步按钮
  if (nextStep?.action) {
    toast.querySelector('#toast-next-btn')?.addEventListener('click', () => {
      clearTimeout(timer)
      dismiss()
      setTimeout(() => nextStep.action(), 280)
    })
  }

  return { dismiss }
}

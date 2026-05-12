/**
 * 统一错误反馈 —— 把散落各处的 console.error 收敛到 toast + 开发期调试
 *
 * 用法:
 *   import { reportError } from '../lib/error-report.js'
 *   try { await api.foo() }
 *   catch (e) { reportError(e, { context: '加载项目列表', silent: false }) }
 *
 * 行为:
 * - 生产: toast(red) + action 按钮可复制堆栈
 * - 开发(import.meta.env.DEV): toast + console.error 原始对象
 * - silent=true: 只走 console.error,不打扰用户(用于后台重试等场景)
 *
 * 好处:
 * - 统一用户可见的错误入口
 * - 错误堆栈可复制,方便用户粘贴反馈
 * - 开发期依然有完整 console trace
 */
import { toast } from '../components/toast.js'
import { t } from './i18n.js'

const IS_DEV = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV

/**
 * @param {unknown} err              错误对象或字符串
 * @param {Object} [opts]
 * @param {string} [opts.context]    上下文描述(例如 "加载会话列表")
 * @param {boolean} [opts.silent]    true: 不弹 toast,只 console
 * @param {number}  [opts.duration]  toast 持续时间(ms)
 */
export function reportError(err, opts = {}) {
  const { context, silent = false, duration = 4500 } = opts
  const msg = _extractMessage(err)
  const stack = _extractStack(err)

  if (IS_DEV) {
    // 开发期保留原始对象,方便打断点
    if (context) console.error(`[${context}]`, err)
    else console.error(err)
  }

  if (silent) return

  const prefix = context ? `${context}: ` : ''
  const display = `${prefix}${msg}`

  // 带"复制错误"按钮的 toast
  const action = _buildCopyAction(display, stack)
  toast(display, 'error', { duration, action })
}

/**
 * 便捷包装: wrapAsync(fn, context) 返回一个 async 包装函数,
 * 自动 catch 并 reportError。
 */
export function wrapAsync(fn, context) {
  return async function (...args) {
    try {
      return await fn.apply(this, args)
    } catch (e) {
      reportError(e, { context })
      throw e
    }
  }
}

function _extractMessage(err) {
  if (err == null) return String(err)
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message || err.toString()
  if (typeof err === 'object') {
    if (err.message) return String(err.message)
    if (err.error) return String(err.error)
    try { return JSON.stringify(err) } catch { return String(err) }
  }
  return String(err)
}

function _extractStack(err) {
  if (err instanceof Error && err.stack) return err.stack
  if (err && typeof err === 'object' && err.stack) return String(err.stack)
  return ''
}

function _buildCopyAction(displayText, stack) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'btn btn-xs btn-ghost'
  btn.style.marginInlineStart = 'auto'
  btn.textContent = t('comp_toast.copy_error')
  btn.addEventListener('click', async (e) => {
    e.stopPropagation()
    const payload = stack ? `${displayText}\n\n${stack}` : displayText
    try {
      await navigator.clipboard.writeText(payload)
      btn.textContent = t('comp_toast.copied')
    } catch {
      btn.textContent = t('comp_toast.copy_failed')
    }
  })
  return btn
}

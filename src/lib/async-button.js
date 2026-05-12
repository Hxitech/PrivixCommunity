/**
 * 异步按钮 —— 防双击 + 自动 loading 态
 *
 * 解决两类问题:
 * 1. 用户快速双击/三击触发多次异步操作(保存、提交、API 调用)
 * 2. 缺少 loading 视觉反馈,用户以为按钮没响应继续点
 *
 * 用法 A(装饰现有按钮):
 *   const btn = page.querySelector('#save-btn')
 *   wrapAsyncButton(btn, async () => {
 *     await api.saveSession(data)
 *     toast('已保存', 'success')
 *   })
 *
 * 用法 B(运行时调用):
 *   btn.addEventListener('click', () => runOnce(btn, async () => {
 *     await doSomething()
 *   }))
 *
 * 效果:
 * - 点击后立即 disabled + 加 .btn-loading 类(components.css 已定义 spinner 动画)
 * - handler 完成(成功或异常)后解除
 * - 执行期间再次点击无效
 * - 异常会 reportError 并重新抛出给调用方
 */
import { reportError } from './error-report.js'

/**
 * 绑定一个 async handler 到按钮,自动防双击 + loading 态
 * @param {HTMLButtonElement} btn
 * @param {(e: Event) => Promise<any>} handler
 * @param {Object} [opts]
 * @param {string} [opts.context] 错误上下文,用于 reportError
 * @returns {Function} 解绑函数
 */
export function wrapAsyncButton(btn, handler, opts = {}) {
  if (!btn || typeof handler !== 'function') return () => {}

  const onClick = async (e) => {
    if (btn.disabled || btn._asyncBusy) return
    await runOnce(btn, () => handler(e), opts)
  }

  btn.addEventListener('click', onClick)
  return () => btn.removeEventListener('click', onClick)
}

/**
 * 在按钮上执行一次 async 操作,期间禁用并显示 loading。
 * 如果按钮当前正忙,直接跳过。
 * @param {HTMLButtonElement} btn
 * @param {() => Promise<any>} task
 * @param {Object} [opts]
 * @param {string} [opts.context]
 * @returns {Promise<any>} task 的返回值(若成功)或 undefined(若被跳过)
 */
export async function runOnce(btn, task, opts = {}) {
  if (!btn || btn._asyncBusy) return undefined
  const { context } = opts

  btn._asyncBusy = true
  const prevDisabled = btn.disabled
  btn.disabled = true
  btn.classList.add('btn-loading')

  try {
    return await task()
  } catch (e) {
    reportError(e, { context })
    throw e
  } finally {
    btn._asyncBusy = false
    btn.disabled = prevDisabled
    btn.classList.remove('btn-loading')
  }
}

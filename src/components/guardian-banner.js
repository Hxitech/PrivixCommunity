/**
 * Guardian Banner — Gateway 守护给弃状态可视化
 *
 * 后端守护(src-tauri/src/commands/service.rs)在 Gateway 连续 3 次重启失败 / 检测到
 * 配置错误(EADDRINUSE/EACCES/SyntaxError 等)时进入 give_up 状态,
 * 并把根因写入 GuardianStatus.lastConfigError(v1.10.7 新增)。
 *
 * 本组件读取该状态,在 host 元素顶部插入红色 banner,并附:
 * - 根因提示(基于 lastConfigError 关键字分发)
 * - "手动重启"按钮(走 reset_guardian + restart_gateway)
 * - "诊断 Gateway 连接"快捷链接(已有 /diagnose 页)
 *
 * 调用方式:
 *   import { mountGuardianBanner } from '../components/guardian-banner.js'
 *   const unmount = mountGuardianBanner(page)  // 自动检测 + 渲染 + 监听 guardian-event
 *   // cleanup 时调 unmount() 移除 listener + DOM
 */
import { api } from '../lib/tauri-api.js'
import { t } from '../lib/i18n.js'
import { toast } from './toast.js'
import { escapeHtml } from '../lib/escape.js'
import { navigate } from '../router.js'

const BANNER_CLASS = 'guardian-banner'

// Lazy Tauri event listen — 避免顶层 await,且 web 模式不会拉 @tauri-apps/api
let _listenFn = null
async function tauriListen(event, cb) {
  if (typeof window === 'undefined' || !window.__TAURI_INTERNALS__) return null
  if (!_listenFn) {
    try {
      const mod = await import('@tauri-apps/api/event')
      _listenFn = mod.listen
    } catch { return null }
  }
  return _listenFn(event, cb)
}

/**
 * 根据 lastConfigError 关键字给出根因提示 i18n key
 */
function configErrorTipKey(errLine) {
  const lower = String(errLine || '').toLowerCase()
  if (lower.includes('eaddrinuse') || lower.includes('address already in use') || lower.includes('port already in use')) {
    return 'components.guardian_banner.tip.eaddrinuse'
  }
  if (lower.includes('eacces') || lower.includes('permission denied')) {
    return 'components.guardian_banner.tip.eacces'
  }
  if (lower.includes('syntaxerror') || lower.includes('invalid configuration')) {
    return 'components.guardian_banner.tip.syntax'
  }
  if (lower.includes('cannot find module')) {
    return 'components.guardian_banner.tip.module'
  }
  return 'components.guardian_banner.tip.generic'
}

function renderBanner(status) {
  const wrap = document.createElement('div')
  wrap.className = BANNER_CLASS
  wrap.style.cssText = [
    'background:var(--error-bg, #fef2f2)',
    'border:1px solid var(--error-border, #fca5a5)',
    'color:var(--error, #b91c1c)',
    'padding:12px 16px',
    'border-radius:10px',
    'margin-bottom:var(--space-md, 16px)',
    'display:flex',
    'flex-direction:column',
    'gap:8px',
  ].join(';')

  const title = `${t('components.guardian_banner.title')} — ${t('components.guardian_banner.restart_count', { count: status.autoRestartCount || 0 })}`
  const errLine = status.lastConfigError || ''
  const tipKey = configErrorTipKey(errLine)

  wrap.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:16px">⚠️</span>
      <strong style="font-size:14px">${escapeHtml(title)}</strong>
    </div>
    ${errLine ? `<code style="font-size:12px;background:rgba(0,0,0,0.04);padding:6px 8px;border-radius:6px;word-break:break-all">${escapeHtml(errLine)}</code>` : ''}
    <div style="font-size:13px;line-height:1.5">${escapeHtml(t(tipKey))}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
      <button class="btn btn-pill-filled btn-sm" data-action="manual-restart">${t('components.guardian_banner.btn_manual_restart')}</button>
      <button class="btn btn-pill-outline btn-sm" data-action="open-diagnose">${t('components.guardian_banner.btn_diagnose')}</button>
      <button class="btn btn-pill-outline btn-sm" data-action="dismiss" style="margin-left:auto">${t('components.guardian_banner.btn_dismiss')}</button>
    </div>
  `

  return wrap
}

async function fetchStatus() {
  try {
    const status = await api.guardianStatus()
    return status || null
  } catch {
    return null
  }
}

/**
 * 在 host 元素顶部挂载 Guardian banner
 *
 * @param {HTMLElement} host - 通常是 page 根 DOM
 * @param {{ refreshOnEvent?: boolean }} opts - 是否监听 guardian-event 自动刷新(默认 true)
 * @returns {() => void} unmount 函数,清理 listener + 移除 DOM
 */
export function mountGuardianBanner(host, opts = {}) {
  if (!host) return () => {}
  const refreshOnEvent = opts.refreshOnEvent !== false
  let bannerEl = null
  let unlisten = null
  let mounted = true

  async function maybeRender() {
    if (!mounted) return
    const status = await fetchStatus()
    // 只在 give_up 状态显;否则确保移除
    const shouldShow = !!(status && status.giveUp)
    if (shouldShow) {
      const next = renderBanner(status)
      next.addEventListener('click', async (e) => {
        const action = e.target.closest('[data-action]')?.dataset.action
        if (!action) return
        if (action === 'dismiss') {
          if (bannerEl?.isConnected) bannerEl.remove()
          bannerEl = null
        } else if (action === 'manual-restart') {
          const btn = e.target.closest('button')
          if (btn) { btn.disabled = true; btn.textContent = '...' }
          try {
            await api.resetGuardian()
            await api.restartGateway()
            toast(t('components.guardian_banner.restart_ok'), 'success')
            await maybeRender()
          } catch (err) {
            toast(`${t('components.guardian_banner.restart_failed')}: ${err?.message || err}`, 'error')
            if (btn) { btn.disabled = false; btn.textContent = t('components.guardian_banner.btn_manual_restart') }
          }
        } else if (action === 'open-diagnose') {
          navigate('/diagnose')
        }
      })
      if (bannerEl?.isConnected) {
        bannerEl.replaceWith(next)
      } else {
        host.prepend(next)
      }
      bannerEl = next
    } else if (bannerEl?.isConnected) {
      bannerEl.remove()
      bannerEl = null
    }
  }

  // 首次检查
  maybeRender()

  // 监听后端 guardian-event(give_up / config_error / restored 等)
  if (refreshOnEvent) {
    tauriListen('guardian-event', () => { maybeRender() })
      .then(fn => { unlisten = typeof fn === 'function' ? fn : null })
      .catch(() => {})
  }

  return function unmount() {
    mounted = false
    if (typeof unlisten === 'function') { try { unlisten() } catch {} }
    if (bannerEl?.isConnected) { try { bannerEl.remove() } catch {} }
    bannerEl = null
  }
}

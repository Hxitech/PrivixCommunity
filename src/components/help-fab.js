/**
 * 常驻悬浮帮助按钮 (FAB)
 * 右下角圆形 "?" 按钮，点击展开帮助面板
 */
import { showWelcomeModal } from './welcome-modal.js'
import { t } from '../lib/i18n.js'
import { icon } from '../lib/icons.js'

const STYLE_ID = 'help-fab-styles'

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    /* ── FAB 按钮 ── */
    .help-fab-wrap {
      position: fixed;
      bottom: 88px;
      right: 24px;
      z-index: 7000;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
    }

    .help-fab-btn {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--help-fab-bg, rgba(255, 255, 255, 0.82));
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--help-fab-border, rgba(151, 161, 255, 0.2));
      box-shadow: 0 4px 16px rgba(15, 23, 42, 0.14), 0 1px 4px rgba(15, 23, 42, 0.08);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      font-weight: 700;
      color: var(--help-fab-text, var(--accent, #5A72EE));
      transition: all 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
      position: relative;
      font-family: var(--font-sans, 'Inter', sans-serif);
      user-select: none;
    }
    .help-fab-btn:hover {
      transform: scale(1.12);
      box-shadow: 0 6px 24px rgba(90, 114, 238, 0.2);
    }
    .help-fab-btn.open {
      transform: scale(1.06) rotate(45deg);
      background: var(--help-fab-open-bg, var(--accent, #5A72EE));
      color: var(--help-fab-open-text, #fff);
      border-color: transparent;
    }

    /* 悬浮标签 */
    .help-fab-label {
      position: absolute;
      right: calc(100% + 10px);
      top: 50%;
      transform: translateY(-50%);
      background: var(--bg-secondary, #fff);
      border: 1px solid var(--border-primary, #E2E5EB);
      border-radius: 6px;
      padding: 5px 10px;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary, #4B5563);
      white-space: nowrap;
      box-shadow: var(--shadow-md);
      pointer-events: none;
      opacity: 0;
      transition: opacity 180ms ease;
    }
    .help-fab-btn:hover .help-fab-label {
      opacity: 1;
    }

    /* ── 展开面板 ── */
    .help-fab-panel {
      background: var(--bg-secondary, #fff);
      border: 1px solid var(--border-primary, #E2E5EB);
      border-radius: 14px;
      box-shadow: var(--help-panel-shadow, 0 8px 32px rgba(15, 23, 42, 0.16));
      width: 280px;
      overflow: hidden;
      transform-origin: bottom right;
      animation: help-panel-in 260ms cubic-bezier(0.34, 1.42, 0.64, 1) forwards;
    }
    @keyframes help-panel-in {
      from { opacity: 0; transform: scale(0.86) translateY(8px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }
    .help-fab-panel.closing {
      animation: help-panel-out 180ms ease-in forwards;
    }
    @keyframes help-panel-out {
      from { opacity: 1; transform: scale(1); }
      to   { opacity: 0; transform: scale(0.88) translateY(6px); }
    }

    .help-panel-header {
      padding: 14px 16px 10px;
      border-bottom: 1px solid var(--border-secondary, #ECEEF2);
    }
    .help-panel-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary, #0F1419);
    }
    .help-panel-subtitle {
      font-size: 11px;
      color: var(--text-tertiary, #9CA3AF);
      margin-top: 2px;
    }

    .help-panel-section {
      padding: 10px 8px;
      border-bottom: 1px solid var(--border-secondary, #ECEEF2);
    }
    .help-panel-section:last-child {
      border-bottom: none;
    }
    .help-panel-section-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--text-tertiary, #9CA3AF);
      padding: 2px 8px 6px;
    }

    .help-panel-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 8px;
      cursor: pointer;
      transition: background 150ms ease;
      text-decoration: none;
    }
    .help-panel-item:hover {
      background: var(--bg-card-hover, #F2F4F7);
    }
    .help-panel-item-icon {
      font-size: 18px;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      background: var(--bg-tertiary, #ECEEF2);
      flex-shrink: 0;
    }
    .help-panel-item-text {
      flex: 1;
      min-width: 0;
    }
    .help-panel-item-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary, #0F1419);
      line-height: 1.3;
    }
    .help-panel-item-desc {
      font-size: 11px;
      color: var(--text-tertiary, #9CA3AF);
      margin-top: 1px;
      line-height: 1.4;
    }
    .help-panel-item-arrow {
      color: var(--text-tertiary, #9CA3AF);
      font-size: 12px;
      flex-shrink: 0;
    }

    /* 键盘快捷键 */
    .help-shortcut-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 10px;
      font-size: 12px;
    }
    .help-shortcut-label {
      color: var(--text-secondary, #4B5563);
    }
    .help-shortcut-keys {
      display: flex;
      gap: 4px;
    }
    .help-shortcut-key {
      background: var(--bg-tertiary, #ECEEF2);
      border: 1px solid var(--border-primary, #E2E5EB);
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 11px;
      font-family: var(--font-mono, monospace);
      color: var(--text-secondary, #4B5563);
    }

    /* 当前页面帮助区 */
    .help-page-hint {
      padding: 10px 16px 12px;
      background: var(--accent-subtle, rgba(151,161,255,0.08));
    }
    .help-page-hint-title {
      font-size: 11px;
      font-weight: 600;
      color: var(--accent, #5A72EE);
      margin-bottom: 4px;
    }
    .help-page-hint-text {
      font-size: 12px;
      color: var(--text-secondary, #4B5563);
      line-height: 1.6;
    }
  `
  document.head.appendChild(style)
}

// 每个路由的页面帮助提示 — 社区版仅核心页
const PAGE_HINT_KEYS = {
  '/models':           { title: 'comp.help.models_title',           text: 'comp.help.models_text' },
  '/agents':           { title: 'comp.help.agents_title',           text: 'comp.help.agents_text' },
  '/channels':         { title: 'comp.help.channels_title',         text: 'comp.help.channels_text' },
  '/chat':             { title: 'comp.help.chat_title',             text: 'comp.help.chat_text' },
  '/gateway':          { title: 'comp.help.gateway_title',          text: 'comp.help.gateway_text' },
  '/setup':            { title: 'comp.help.setup_title',            text: 'comp.help.setup_text' },
}

// 运行时获取翻译后的页面提示
function getPageHints(route) {
  const keys = PAGE_HINT_KEYS[route]
  if (!keys) return null
  return { title: t(keys.title), text: t(keys.text) }
}

// 社区版:无行业模块专属教程

function getPageHint() {
  const hash = window.location.hash.replace('#', '') || '/'
  return getPageHints(hash)
}

let _fabEl = null
let _panelEl = null
let _isOpen = false

function closePanel() {
  if (!_isOpen || !_panelEl) return
  _isOpen = false
  _fabEl?.querySelector('.help-fab-btn')?.classList.remove('open')
  _panelEl.classList.add('closing')
  setTimeout(() => {
    _panelEl?.remove()
    _panelEl = null
  }, 200)
}

function openPanel() {
  if (_isOpen) { closePanel(); return }
  _isOpen = true
  _fabEl?.querySelector('.help-fab-btn')?.classList.add('open')

  const hint = getPageHint()
  const panel = document.createElement('div')
  panel.className = 'help-fab-panel'

  panel.innerHTML = `
    <div class="help-panel-header">
      <div class="help-panel-title">${t('comp.help.title')}</div>
      <div class="help-panel-subtitle">${t('comp.help.subtitle')}</div>
    </div>

    ${hint ? `
    <div class="help-page-hint">
      <div class="help-page-hint-title">${t('comp.help.current_page', { page: hint.title })}</div>
      <div class="help-page-hint-text">${hint.text}</div>
    </div>
    ` : ''}

    <div class="help-panel-section">
      <div class="help-panel-section-label">${t('comp.help.section_guides')}</div>
      <div class="help-panel-item" data-help-action="welcome">
        <div class="help-panel-item-icon" style="color:var(--accent-blue);display:inline-flex;align-items:center;justify-content:center">${icon('target', 20)}</div>
        <div class="help-panel-item-text">
          <div class="help-panel-item-title">${t('comp.help.guide_welcome_title')}</div>
          <div class="help-panel-item-desc">${t('comp.help.guide_welcome_desc')}</div>
        </div>
        <span class="help-panel-item-arrow">›</span>
      </div>
    </div>

    <div class="help-panel-section">
      <div class="help-panel-section-label">${t('comp.help.section_shortcuts')}</div>
      <div class="help-shortcut-row">
        <span class="help-shortcut-label">${t('comp.help.shortcut_toggle_help')}</span>
        <div class="help-shortcut-keys">
          <span class="help-shortcut-key">?</span>
        </div>
      </div>
      <div class="help-shortcut-row">
        <span class="help-shortcut-label">${t('comp.help.shortcut_close')}</span>
        <div class="help-shortcut-keys">
          <span class="help-shortcut-key">Esc</span>
        </div>
      </div>
    </div>
  `

  _fabEl.insertBefore(panel, _fabEl.querySelector('.help-fab-btn'))
  _panelEl = panel

  panel.addEventListener('click', (e) => {
    const item = e.target.closest('[data-help-action]')
    if (!item) return
    const action = item.dataset.helpAction
    closePanel()

    setTimeout(() => {
      if (action === 'welcome') showWelcomeModal()
    }, 200)
  })
}

/**
 * 挂载常驻帮助 FAB
 * 在 app 启动后调用一次
 */
export function mountHelpFab() {
  if (_fabEl) return

  injectStyles()

  const wrap = document.createElement('div')
  wrap.className = 'help-fab-wrap'
  wrap.id = 'help-fab'

  const btn = document.createElement('button')
  btn.className = 'help-fab-btn'
  btn.setAttribute('aria-label', t('comp.help.button'))
  btn.setAttribute('title', t('comp.help.button'))
  btn.innerHTML = `
    <span>?</span>
    <span class="help-fab-label">${t('comp.help.title')}</span>
  `

  wrap.appendChild(btn)
  document.body.appendChild(wrap)
  _fabEl = wrap

  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    openPanel()
  })

  // 点击外部关闭
  document.addEventListener('click', (e) => {
    if (_isOpen && !_fabEl.contains(e.target)) closePanel()
  })

  // 键盘快捷键 "?"
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, [contenteditable]')) return
    if (e.key === '?') {
      e.preventDefault()
      openPanel()
    }
    if (e.key === 'Escape' && _isOpen) closePanel()
  })

  // 路由变化时更新页面提示（关闭面板）
  window.addEventListener('hashchange', () => {
    if (_isOpen) closePanel()
  })
}

/**
 * 卸载帮助 FAB
 */
export function unmountHelpFab() {
  _fabEl?.remove()
  _fabEl = null
  _panelEl = null
  _isOpen = false
}

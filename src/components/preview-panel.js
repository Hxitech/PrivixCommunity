/**
 * 智能预览面板 (v1.5 Agent Studio)
 *
 * 全局单例右侧抽屉,支持四种格式的即时预览:
 *   - markdown: 走 lib/markdown.js 渲染
 *   - code:     走 lib/markdown.js 的 fenced 代码块渲染(自动高亮)
 *   - html:     sandboxed iframe 渲染(防脚本逃逸)
 *   - image:    <img> 标签,支持 data URL / http(s) URL
 *
 * 使用:
 *   import { openPreviewPanel } from '../components/preview-panel.js'
 *   openPreviewPanel({ title: 'AI 产出', type: 'markdown', content: '# Hello' })
 *
 * 同一时间只存在一个面板实例;重复调用复用 DOM。
 */
import { renderMarkdown } from '../lib/markdown.js'
import { t } from '../lib/i18n.js'

const PANEL_ID = 'privix-preview-panel'
const SUPPORTED_TYPES = new Set(['markdown', 'code', 'html', 'image'])

let _panel = null
let _keyHandler = null

/**
 * 打开预览面板
 * @param {Object} opts
 * @param {string} [opts.title] - 面板标题(用户可见)
 * @param {string} opts.type - 'markdown' | 'code' | 'html' | 'image'
 * @param {string} opts.content - 内容(对 image 类型是 URL 或 data URL)
 * @param {string} [opts.language] - code 类型时的语言(如 'javascript')
 */
export function openPreviewPanel({ title = '', type = 'markdown', content = '', language = '' }) {
  if (!SUPPORTED_TYPES.has(type)) {
    console.warn('[preview-panel] 不支持的类型:', type)
    type = 'markdown'
  }
  ensurePanel()
  renderContent({ title, type, content, language })
  openAnimated()
}

export function closePreviewPanel() {
  if (!_panel) return
  _panel.classList.remove('is-open')
  document.body?.classList.remove('has-preview-panel')
  if (_keyHandler) {
    document.removeEventListener('keydown', _keyHandler)
    _keyHandler = null
  }
}

export function isPreviewPanelOpen() {
  return !!_panel?.classList.contains('is-open')
}

function ensurePanel() {
  if (_panel && document.body.contains(_panel)) return _panel
  // 旧面板被外部移除(如路由全量替换),先清理残留的 keyHandler
  if (_keyHandler) {
    document.removeEventListener('keydown', _keyHandler)
    _keyHandler = null
  }
  _panel = null
  const el = document.createElement('aside')
  el.id = PANEL_ID
  el.className = 'preview-panel'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-label', t('comp_preview.aria_label'))
  el.innerHTML = `
    <div class="preview-panel-header">
      <div class="preview-panel-title-wrap">
        <span class="preview-panel-type-badge" data-type="markdown">MD</span>
        <div class="preview-panel-title" data-role="title">${t('comp_preview.default_title')}</div>
      </div>
      <div class="preview-panel-actions">
        <button class="btn btn-secondary btn-sm" data-action="copy" title="${t('comp_preview.btn_copy')}">${t('common.copy')}</button>
        <button class="btn btn-secondary btn-sm" data-action="close" title="${t('common.close')}">✕</button>
      </div>
    </div>
    <div class="preview-panel-tabs">
      <button class="preview-panel-tab is-active" data-tab="rendered">${t('comp_preview.tab_rendered')}</button>
      <button class="preview-panel-tab" data-tab="source">${t('comp_preview.tab_source')}</button>
    </div>
    <div class="preview-panel-body" data-role="body">
      <div class="preview-panel-rendered" data-role="rendered"></div>
      <pre class="preview-panel-source" data-role="source" hidden></pre>
    </div>
  `
  document.body.appendChild(el)
  _panel = el

  // 事件绑定
  el.querySelector('[data-action="close"]').addEventListener('click', closePreviewPanel)
  el.querySelector('[data-action="copy"]').addEventListener('click', async () => {
    const source = el.querySelector('[data-role="source"]')
    try {
      await navigator.clipboard.writeText(source?.textContent || '')
      const btn = el.querySelector('[data-action="copy"]')
      const original = btn.textContent
      btn.textContent = t('common.copied')
      setTimeout(() => { btn.textContent = original }, 1200)
    } catch {
      // fallback: 选中并提示
    }
  })
  el.querySelectorAll('[data-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      el.querySelectorAll('[data-tab]').forEach(t => t.classList.toggle('is-active', t === tab))
      const which = tab.dataset.tab
      el.querySelector('[data-role="rendered"]').hidden = (which !== 'rendered')
      el.querySelector('[data-role="source"]').hidden = (which !== 'source')
    })
  })

  return el
}

function renderContent({ title, type, content, language }) {
  const el = _panel
  if (!el) return

  // 标题与类型 badge
  const titleEl = el.querySelector('[data-role="title"]')
  const badgeEl = el.querySelector('.preview-panel-type-badge')
  titleEl.textContent = title || t('comp_preview.default_title')
  badgeEl.dataset.type = type
  badgeEl.textContent = labelForType(type, language)

  // 渲染区
  const rendered = el.querySelector('[data-role="rendered"]')
  const source = el.querySelector('[data-role="source"]')
  rendered.innerHTML = ''
  source.textContent = String(content ?? '')

  if (type === 'markdown') {
    rendered.innerHTML = renderMarkdown(String(content || ''))
  } else if (type === 'code') {
    const fence = `\`\`\`${language || ''}\n${content || ''}\n\`\`\``
    rendered.innerHTML = renderMarkdown(fence)
  } else if (type === 'html') {
    // sandboxed iframe — 禁用 scripts/forms/top navigation,仅允许同源样式
    const iframe = document.createElement('iframe')
    iframe.className = 'preview-panel-iframe'
    // 严格 sandbox:无 allow-scripts / allow-same-origin,避免 XSS 逃逸
    iframe.setAttribute('sandbox', '')
    iframe.setAttribute('referrerpolicy', 'no-referrer')
    iframe.srcdoc = String(content || '')
    rendered.appendChild(iframe)
  } else if (type === 'image') {
    const img = document.createElement('img')
    img.className = 'preview-panel-image'
    img.alt = title || 'preview'
    img.loading = 'lazy'
    img.src = String(content || '')
    img.addEventListener('error', () => {
      rendered.innerHTML = `<div class="preview-panel-error">${t('comp_preview.image_load_failed')}</div>`
    })
    rendered.appendChild(img)
  }

  // 重置 tab 到 rendered
  el.querySelectorAll('[data-tab]').forEach(tab => {
    tab.classList.toggle('is-active', tab.dataset.tab === 'rendered')
  })
  rendered.hidden = false
  source.hidden = true
}

function openAnimated() {
  if (!_panel) return
  // 强制 reflow 确保初始 translateX(100%) 已应用,再加 is-open 触发 transition
  // (比 requestAnimationFrame 更稳,headless 环境下 rAF 不一定触发)
  // eslint-disable-next-line no-unused-expressions
  _panel.offsetWidth
  _panel.classList.add('is-open')
  document.body?.classList.add('has-preview-panel')
  if (!_keyHandler) {
    _keyHandler = (e) => {
      if (e.key === 'Escape' && isPreviewPanelOpen()) {
        closePreviewPanel()
      }
    }
    document.addEventListener('keydown', _keyHandler)
  }
}

function labelForType(type, language) {
  if (type === 'markdown') return 'MD'
  if (type === 'code') return (language || 'CODE').toUpperCase().slice(0, 6)
  if (type === 'html') return 'HTML'
  if (type === 'image') return 'IMG'
  return type.toUpperCase().slice(0, 4)
}

/* ============================================================
   自动增强:给对话消息中的 <pre> 代码块加预览按钮
   使用 MutationObserver 监听 DOM 增量,无需改现有页面代码
   ============================================================ */

/** 会被增强的容器 CSS 选择器 */
const ENHANCE_CONTAINER_SELECTORS = [
  '.ast-msg-bubble',        // Claw Assistant 消息气泡
  '.chat-message-bubble',   // 实时聊天消息气泡(如存在)
  '.clawswarm-msg-body',    // ClawSwarm 消息
]

// data- 属性用 kebab-case,JS 读取时用 dataset.xxxYyy 驼峰
const ENHANCE_MARKER_ATTR = 'data-privix-preview-enhanced'
const ENHANCE_MARKER_PROP = 'privixPreviewEnhanced'

function enhancePreBlocks(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return
  root.querySelectorAll('pre').forEach(pre => {
    if (pre.dataset[ENHANCE_MARKER_PROP]) return
    const codeEl = pre.querySelector('code')
    if (!codeEl) return

    // 解析语言(hljs 输出的 class: language-xxx 或 hljs language-xxx)
    const langClass = [...codeEl.classList].find(c => c.startsWith('language-'))
    const language = langClass ? langClass.slice(9) : ''

    // 跳过空内容 / 太短的代码块(预览不合算)
    const text = codeEl.textContent || ''
    if (text.trim().length < 40) return

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'preview-pane-launcher'
    btn.title = t('comp_preview.launcher_hint')
    btn.textContent = '👁 ' + t('comp_preview.launcher_label')
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      // HTML / SVG 用 html 类型,其他按 code 类型
      const isHtml = /^(html|svg|xml)$/i.test(language)
      openPreviewPanel({
        title: language ? `${language.toUpperCase()} ${t('comp_preview.default_title')}` : t('comp_preview.default_title'),
        type: isHtml ? 'html' : 'code',
        content: text,
        language,
      })
    })

    // pre 容器需要 position:relative(由全局 CSS 保证)
    pre.appendChild(btn)
    pre.setAttribute(ENHANCE_MARKER_ATTR, '1')
  })
}

let _observer = null

/**
 * 启动全局预览按钮自动增强。
 * 在 main.js 启动后调用一次即可。
 */
export function initPreviewPanelAutoAttach() {
  if (_observer || typeof document === 'undefined') return
  // 初次扫描
  ENHANCE_CONTAINER_SELECTORS.forEach(sel => {
    document.querySelectorAll(sel).forEach(enhancePreBlocks)
  })
  // 监听 DOM 增量
  _observer = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue
        // 如果新增节点本身是 pre 所在的容器,扫描它
        if (ENHANCE_CONTAINER_SELECTORS.some(sel => n.matches?.(sel))) {
          enhancePreBlocks(n)
        }
        // 或者新增节点是容器的子孙
        ENHANCE_CONTAINER_SELECTORS.forEach(sel => {
          n.querySelectorAll?.(sel)?.forEach(enhancePreBlocks)
        })
        // 新增节点本身就是 pre(assistant.js 有时用 innerHTML 全量替换)
        if (n.matches?.('pre')) {
          const container = n.closest(ENHANCE_CONTAINER_SELECTORS.join(','))
          if (container) enhancePreBlocks(container.parentElement || container)
        }
      }
    }
  })
  _observer.observe(document.body, { childList: true, subtree: true })
}

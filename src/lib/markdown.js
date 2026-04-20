/**
 * Markdown 渲染器 - 轻量级，支持代码高亮
 * 从 clawapp 移植，去掉 MEDIA 路径处理
 */

const KEYWORDS = new Set([
  'const','let','var','function','return','if','else','for','while','do',
  'switch','case','break','continue','new','this','class','extends','import',
  'export','from','default','try','catch','finally','throw','async','await',
  'yield','of','in','typeof','instanceof','void','delete','true','false',
  'null','undefined','static','get','set','super','with','debugger',
  'def','print','self','elif','lambda','pass','raise','except','None','True','False',
  'fn','pub','mut','impl','struct','enum','match','use','mod','crate','trait',
  'int','string','bool','float','double','char','byte','long','short','unsigned',
  'package','main','fmt','go','chan','defer','select','type','interface','map','range',
])

function highlightCode(code, lang) {
  const escaped = escapeHtml(code)
  // Two-phase: mark with control chars first, convert to HTML last
  // Prevents keyword regex from matching "class" inside <span class="..."> attributes
  const S = '\x02', E = '\x03'
  const CLS = ['hl-number','hl-comment','hl-string','hl-type','hl-func','hl-keyword']
  return escaped
    .replace(/\b(\d+\.?\d*)\b/g, `${S}0${E}$1${S}c${E}`)
    .replace(/(\/\/.*$|#.*$)/gm, `${S}1${E}$1${S}c${E}`)
    .replace(/(\/\*[\s\S]*?\*\/)/g, `${S}1${E}$1${S}c${E}`)
    .replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;|&#x27;(?:[^&]|&(?!#x27;))*?&#x27;|`[^`]*`)/g,
      `${S}2${E}$1${S}c${E}`)
    .replace(/\b([A-Z][a-zA-Z0-9_]*)\b/g, (m, w) =>
      KEYWORDS.has(w) ? m : `${S}3${E}${w}${S}c${E}`)
    .replace(/\b(\w+)(?=\s*\()/g, (m, w) =>
      KEYWORDS.has(w) ? m : `${S}4${E}${w}${S}c${E}`)
    .replace(/\b(\w+)\b/g, (m, w) =>
      KEYWORDS.has(w) ? `${S}5${E}${w}${S}c${E}` : m)
    .replace(/\x02([0-5])\x03/g, (_, i) => `<span class="${CLS[+i]}">`)
    .replace(/\x02c\x03/g, '</span>')
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/`/g, '&#x60;')
}

// 预加载 Tauri convertFileSrc
let _convertFileSrc = null
if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
  import('@tauri-apps/api/core').then(m => { _convertFileSrc = m.convertFileSrc }).catch(() => {})
}

/** 将本地文件路径转换为可加载的 URL */
function resolveImageSrc(src) {
  if (!src) return src
  // 已经是 http/https/data URL → 直接返回
  if (/^(https?|data|blob):/.test(src)) return src
  // Windows 绝对路径 (C:\... or C:/...)
  const isWinPath = /^[A-Za-z]:[\\/]/.test(src)
  // Unix 绝对路径 (/Users/... /home/... /tmp/...)
  const isUnixPath = /^\/[^/]/.test(src)
  if (isWinPath || isUnixPath) {
    // Tauri 环境：使用 convertFileSrc 转换为 asset protocol URL
    if (_convertFileSrc) {
      try { return _convertFileSrc(src) } catch {}
    }
    // Tauri 未就绪或 Web 模式：返回原始路径（onerror 会处理显示）
    return src
  }
  return src
}

function applyInlineMarks(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
}

function applyLinkFormatting(text) {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const safe = /^https?:|^mailto:/i.test(url.trim()) ? escapeAttr(url.trim()) : '#'
    return `<a href="${safe}" target="_blank" rel="noopener">${label}</a>`
  })
}

function formatInlinePlain(text) {
  return applyInlineMarks(applyLinkFormatting(escapeHtml(text)))
}

/** 将单个文本块渲染为 HTML（流式用：支持标题、加粗、斜体） */
function renderStreamingBlock(block) {
  const headingMatch = block.match(/^(#{1,3})\s+(.+)$/)
  if (headingMatch) {
    const level = headingMatch[1].length
    return `<h${level}>${formatInlinePlain(headingMatch[2])}</h${level}>`
  }
  return `<p>${formatInlinePlain(block).replace(/\n/g, '<br>')}</p>`
}

function renderPlainBlocks(text, { withCursor = false } = {}) {
  if (!text) {
    return withCursor ? '<span class="stream-cursor"></span>' : ''
  }

  const blocks = text
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(renderStreamingBlock)

  if (!blocks.length) {
    return withCursor ? '<span class="stream-cursor"></span>' : ''
  }

  const html = blocks.join('\n')
  return withCursor ? `${html}<span class="stream-cursor"></span>` : html
}

export function renderStreamingText(text) {
  return renderPlainBlocks(text, { withCursor: true })
}

/**
 * 增量更新流式文本容器的 DOM，避免全量 innerHTML 替换。
 * container 内部结构：[<p>|<hN>]... + <span class="stream-cursor">
 * 返回是否成功应用 diff（false 时调用方可回退到全量渲染）。
 */
export function applyStreamingTextDiff(newText, oldText, container, cursorEl) {
  if (!container) return false
  const newBlocks = newText ? newText.split(/\n{2,}/).map(b => b.trim()).filter(Boolean) : []
  const oldBlocks = oldText ? oldText.split(/\n{2,}/).map(b => b.trim()).filter(Boolean) : []

  // 找到第一个不同的块索引
  let firstDiff = 0
  while (firstDiff < oldBlocks.length && firstDiff < newBlocks.length && oldBlocks[firstDiff] === newBlocks[firstDiff]) {
    firstDiff++
  }

  // 获取容器中现有的内容元素（排除 cursor）
  const existingEls = Array.from(container.children).filter(el => !el.classList.contains('stream-cursor'))

  // 如果现有元素数与旧块数不匹配，回退到全量渲染
  if (existingEls.length !== oldBlocks.length && oldBlocks.length > 0) return false

  // 更新变化的块
  if (firstDiff < existingEls.length && firstDiff < newBlocks.length) {
    existingEls[firstDiff].outerHTML = renderStreamingBlock(newBlocks[firstDiff])
  }

  // 删除多余的旧块
  for (let i = existingEls.length - 1; i > firstDiff && i >= newBlocks.length; i--) {
    existingEls[i].remove()
  }

  // 追加新块
  for (let i = Math.max(firstDiff + 1, existingEls.length); i < newBlocks.length; i++) {
    const tmp = document.createElement('div')
    tmp.innerHTML = renderStreamingBlock(newBlocks[i])
    const el = tmp.firstChild
    if (cursorEl && cursorEl.parentNode === container) {
      container.insertBefore(el, cursorEl)
    } else {
      container.appendChild(el)
    }
  }

  // 确保 cursor 在最后
  if (cursorEl && cursorEl.parentNode === container) {
    container.appendChild(cursorEl)
  }

  return true
}

export function renderMarkdown(text, options = {}) {
  if (!text) return ''
  const mode = options?.mode || 'default'
  if (mode === 'plain') return renderPlainBlocks(text)

  let html = text

  // 代码块
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const highlighted = highlightCode(code.trimEnd(), lang)
    const langLabel = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : ''
    return `<pre data-lang="${escapeAttr(lang)}">${langLabel}<button class="code-copy-btn" onclick="window.__copyCode(this)">Copy</button><code>${highlighted}</code></pre>`
  })

  // 行内代码
  html = html.replace(/`([^`\n]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`)

  const lines = html.split('\n')
  const result = []
  let inList = false
  let listType = ''

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]

    // 跳过 pre 块内容
    if (line.startsWith('<pre')) {
      result.push(line)
      while (i < lines.length - 1 && !lines[i].includes('</pre>')) { i++; result.push(lines[i]) }
      continue
    }

    // 标题
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      if (inList) { result.push(`</${listType}>`); inList = false }
      const level = headingMatch[1].length
      result.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`)
      continue
    }

    // 无序列表
    const ulMatch = line.match(/^[\s]*[-*]\s+(.+)$/)
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) result.push(`</${listType}>`)
        result.push('<ul>'); inList = true; listType = 'ul'
      }
      result.push(`<li>${inlineFormat(ulMatch[1])}</li>`)
      continue
    }

    // 有序列表
    const olMatch = line.match(/^[\s]*\d+\.\s+(.+)$/)
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) result.push(`</${listType}>`)
        result.push('<ol>'); inList = true; listType = 'ol'
      }
      result.push(`<li>${inlineFormat(olMatch[1])}</li>`)
      continue
    }

    if (inList) { result.push(`</${listType}>`); inList = false }
    if (line.trim() === '') { result.push(''); continue }
    if (!line.startsWith('<')) { result.push(`<p>${inlineFormat(line)}</p>`) }
    else { result.push(line) }
  }

  if (inList) result.push(`</${listType}>`)
  return result.join('\n')
}

function inlineFormat(text) {
  return applyInlineMarks(escapeHtml(text))
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
      const safeSrc = resolveImageSrc(src.trim())
      return `<img src="${safeSrc}" alt="${escapeAttr(alt)}" class="msg-img" onerror="this.onerror=null;this.style.display='none';this.insertAdjacentHTML('afterend','<span style=\\'color:var(--text-tertiary);font-size:12px\\'>[图片无法加载: ${escapeHtml(src)}]</span>')" />`
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const safe = /^https?:|^mailto:/i.test(url.trim()) ? escapeAttr(url.trim()) : '#'
      return `<a href="${safe}" target="_blank" rel="noopener">${label}</a>`
    })
}

if (typeof window !== 'undefined') {
  window.__copyCode = function(btn) {
    const pre = btn.closest('pre')
    const code = pre.querySelector('code')
    navigator.clipboard.writeText(code.innerText).then(() => {
      btn.textContent = '✓'
      setTimeout(() => { btn.textContent = 'Copy' }, 1500)
    }).catch(() => {
      btn.textContent = '✗'
      setTimeout(() => { btn.textContent = 'Copy' }, 1500)
    })
  }
}

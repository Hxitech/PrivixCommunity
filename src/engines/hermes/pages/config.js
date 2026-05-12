/**
 * Hermes config.yaml 编辑页
 *
 * 简版编辑器: textarea + 加载/保存/重启 Gateway。借鉴上游 v0.14.0 的 .env editor 思路,
 * 适配 Hermes 的 YAML 配置格式。重做了原 v1.4.2 的占位页。
 */
import { api } from '../../../lib/tauri-api.js'
import { toast } from '../../../components/toast.js'
import { reportError } from '../../../lib/error-report.js'
import { showConfirm } from '../../../components/modal.js'
import { wrapAsyncButton } from '../../../lib/async-button.js'

export function render() {
  const el = document.createElement('div')
  el.className = 'page'
  el.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div>
        <h1 class="apple-section">Hermes 配置</h1>
        <p class="apple-body-secondary">编辑 ~/.hermes/config.yaml,保存后自动备份并提示重启 Gateway</p>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0">
        <button class="btn btn-secondary btn-sm" id="btn-reload">重新加载</button>
        <button class="btn btn-primary btn-sm" id="btn-save">保存并重启</button>
      </div>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <textarea id="config-yaml" spellcheck="false" style="
        width:100%;min-height:60vh;border:0;padding:16px 20px;
        font-family:var(--font-mono);font-size:var(--font-size-md);
        line-height:1.6;color:var(--text-primary);background:var(--bg-card);
        resize:vertical;outline:none">加载中...</textarea>
    </div>
    <div id="status-bar" style="margin-top:var(--space-md);font-size:var(--font-size-sm);color:var(--text-tertiary)"></div>
  `

  loadConfig(el)
  bindActions(el)

  return el
}

async function loadConfig(el) {
  const ta = el.querySelector('#config-yaml')
  const status = el.querySelector('#status-bar')
  try {
    const raw = await api.hermesReadConfigRaw()
    ta.value = raw || ''
    status.textContent = raw ? `已加载 ${raw.length} 字符` : 'config.yaml 不存在(首次运行 setup 会创建)'
    focusSection(ta, raw || '')
  } catch (e) {
    reportError(e, { context: '加载 config.yaml' })
    ta.value = ''
    status.textContent = '加载失败,见错误提示'
  }
}

// 解析 hash 中的 ?focus=key 参数,滚动到对应顶层节并选中 key 行
// 支持点号路径(如 platforms.telegram),只匹配第一段顶层 key
function focusSection(ta, raw) {
  if (!raw) return
  const hash = window.location.hash || ''
  const queryIdx = hash.indexOf('?')
  if (queryIdx < 0) return
  const params = new URLSearchParams(hash.slice(queryIdx + 1))
  const focus = params.get('focus')
  if (!focus) return
  const topKey = focus.split('.')[0]
  const lines = raw.split('\n')
  let lineIdx = -1
  let charIdx = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(topKey + ':')) {
      lineIdx = i
      break
    }
    charIdx += lines[i].length + 1
  }
  if (lineIdx < 0) return
  // 选中整段顶层节(直到下一个顶层节)
  let endIdx = charIdx + lines[lineIdx].length
  for (let i = lineIdx + 1; i < lines.length; i++) {
    if (lines[i] && !lines[i].startsWith(' ') && !lines[i].startsWith('\t')) break
    endIdx += 1 + lines[i].length
  }
  ta.focus()
  ta.setSelectionRange(charIdx, endIdx)
  // textarea 没有 native scrollIntoView for selection — 用 line 数估算。
  // 渲染样式中 line-height: 1.6(unitless,跟随 fontSize)。getComputedStyle.lineHeight
  // 在 unset 时返回 'normal' 导致 parseFloat NaN,所以直接用 fontSize * 1.6。
  const fontSize = parseFloat(getComputedStyle(ta).fontSize) || 14
  const lineHeight = fontSize * 1.6
  ta.scrollTop = Math.max(0, lineIdx * lineHeight - 60)
}

function bindActions(el) {
  el.querySelector('#btn-reload').addEventListener('click', async () => {
    const ok = await showConfirm('放弃当前编辑,从磁盘重新加载?')
    if (ok) loadConfig(el)
  })

  // 注:Hermes Gateway 走自己的 hermesGatewayAction(action='restart'),不能复用
  // OpenClaw gateway-restart-queue(那里 hardcode api.restartGateway)。用户在
  // 此页点 "保存并重启" 是显式动作,直接同步执行即可,不需要防抖队列。
  wrapAsyncButton(el.querySelector('#btn-save'), async () => {
    const ta = el.querySelector('#config-yaml')
    const content = ta.value
    if (!content.trim()) {
      toast('内容为空,拒绝写入', 'warning')
      return
    }
    await api.hermesWriteConfigRaw(content)
    toast('已保存,正在重启 Hermes Gateway...', 'info')
    try {
      await api.hermesGatewayAction('restart')
      toast('Gateway 已重启,新配置生效', 'success')
    } catch (restartErr) {
      toast('保存成功但重启失败: ' + (restartErr?.message || restartErr), 'warning', { duration: 6000 })
    }
  }, { context: '保存 config.yaml' })
}

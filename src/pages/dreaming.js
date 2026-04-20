import { showConfirm } from '../components/modal.js'
import { toast } from '../components/toast.js'
import { t } from '../lib/i18n.js'
import { icon } from '../lib/icons.js'
import { wsClient } from '../lib/ws-client.js'
import { navigate } from '../router.js'
import { isFeatureAvailable } from '../lib/feature-gates.js'

let _page = null
let _unsubReady = null
let _state = createState()

function createState() {
  return {
    loading: true,
    actionLoading: false,
    view: 'scene',
    unsupported: false,
    error: '',
    status: null,
    configSnapshot: null,
    pluginId: 'memory-core',
    pluginSupportsDreaming: null,
    toggleBlockedReason: '',
    diaryPath: 'DREAMS.md',
    diaryContent: null,
    diarySupported: true,
    actionsSupported: true,
  }
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function normalizeString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function normalizeInt(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback
}

function normalizeEntries(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    const record = asRecord(entry)
    if (!record) return null
    const snippet = normalizeString(record.snippet)
    const path = normalizeString(record.path)
    const key = normalizeString(record.key || path || snippet)
    if (!snippet && !path) return null
    return {
      key: key || `${path}:${normalizeInt(record.startLine, 1)}`,
      snippet,
      path,
      startLine: normalizeInt(record.startLine, 1),
      endLine: normalizeInt(record.endLine, 1),
      recallCount: normalizeInt(record.recallCount, 0),
      dailyCount: normalizeInt(record.dailyCount, 0),
      groundedCount: normalizeInt(record.groundedCount, 0),
      totalSignalCount: normalizeInt(record.totalSignalCount, 0),
      phaseHitCount: normalizeInt(record.phaseHitCount, 0),
      promotedAt: normalizeString(record.promotedAt || ''),
    }
  }).filter(Boolean)
}

function normalizePhase(raw) {
  const record = asRecord(raw)
  return {
    enabled: record?.enabled === true,
    cron: normalizeString(record?.cron),
    nextRunAtMs: typeof record?.nextRunAtMs === 'number' && Number.isFinite(record.nextRunAtMs) ? record.nextRunAtMs : null,
    limit: normalizeInt(record?.limit, 0),
    lookbackDays: normalizeInt(record?.lookbackDays, 0),
    minScore: typeof record?.minScore === 'number' && Number.isFinite(record.minScore) ? record.minScore : null,
    minPatternStrength: typeof record?.minPatternStrength === 'number' && Number.isFinite(record.minPatternStrength) ? record.minPatternStrength : null,
    minRecallCount: normalizeInt(record?.minRecallCount, 0),
    minUniqueQueries: normalizeInt(record?.minUniqueQueries, 0),
  }
}

function normalizeStatus(raw) {
  const record = asRecord(raw)
  if (!record) return null
  const phases = asRecord(record.phases)
  return {
    enabled: record.enabled === true,
    timezone: normalizeString(record.timezone || ''),
    storageMode: normalizeString(record.storageMode || 'inline'),
    shortTermCount: normalizeInt(record.shortTermCount, 0),
    groundedSignalCount: normalizeInt(record.groundedSignalCount, 0),
    totalSignalCount: normalizeInt(record.totalSignalCount, 0),
    promotedToday: normalizeInt(record.promotedToday, 0),
    promotedTotal: normalizeInt(record.promotedTotal, 0),
    storePath: normalizeString(record.storePath || 'MEMORY.md'),
    shortTermEntries: normalizeEntries(record.shortTermEntries),
    signalEntries: normalizeEntries(record.signalEntries),
    promotedEntries: normalizeEntries(record.promotedEntries),
    phases: {
      light: normalizePhase(phases?.light),
      deep: normalizePhase(phases?.deep),
      rem: normalizePhase(phases?.rem),
    },
  }
}

function isUnsupportedError(error) {
  const msg = String(error?.message || error || '').toLowerCase()
  return msg.includes('unknown method') || msg.includes('not found') || msg.includes('unsupported') || msg.includes('不支持')
}

function errorMessage(error) {
  return String(error?.message || error || '')
}

function lookupIncludesDreamingProperty(value) {
  const lookup = asRecord(value)
  const children = Array.isArray(lookup?.children) ? lookup.children : []
  return children.some((child) => normalizeString(asRecord(child)?.key) === 'dreaming')
}

function lookupDisallowsUnknownProperties(value) {
  const lookup = asRecord(value)
  const schema = asRecord(lookup?.schema)
  return schema?.additionalProperties === false
}

function parseDiarySections(content) {
  if (typeof content !== 'string') return []
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const matches = Array.from(normalized.matchAll(/^(#{1,6})\s+(.+)$/gm))
  if (!matches.length) {
    return [{ title: `${t('pages.dreaming.diarySection')} 1`, body: normalized }]
  }
  const result = []
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i]
    const start = (current.index ?? 0) + current[0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? normalized.length) : normalized.length
    const title = normalizeString(current[2], `${t('pages.dreaming.diarySection')} ${i + 1}`).trim() || `${t('pages.dreaming.diarySection')} ${i + 1}`
    const body = normalized.slice(start, end).trim()
    result.push({ title, body: body || current[0] })
  }
  return result.filter((section) => section.title || section.body)
}

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatNextRun(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return t('pages.dreaming.notScheduled')
  return new Date(ms).toLocaleString()
}

function resolveNextRun(status) {
  if (!status?.phases) return null
  const values = Object.values(status.phases)
    .filter((phase) => phase.enabled && typeof phase.nextRunAtMs === 'number')
    .map((phase) => phase.nextRunAtMs)
    .sort((a, b) => a - b)
  return values[0] ?? null
}

function resolveMemoryPluginId(config) {
  const root = asRecord(config)
  const plugins = asRecord(root?.plugins)
  const slots = asRecord(plugins?.slots)
  const slot = normalizeString(slots?.memory || '').trim()
  if (slot && slot.toLowerCase() !== 'none') return slot
  return 'memory-core'
}

async function ensureGatewayReady(page) {
  if (wsClient.connected && wsClient.gatewayReady) return true
  if (_unsubReady) { _unsubReady(); _unsubReady = null }
  _unsubReady = wsClient.onReady(() => {
    if (_unsubReady) { _unsubReady(); _unsubReady = null }
    if (_page === page) loadAll(page)
  })
  return false
}

export function render() {
  const page = document.createElement('div')
  page.className = 'page'
  _page = page
  _state = createState()
  renderPage(page)
  setTimeout(() => loadAll(page), 0)
  return page
}

export function cleanup() {
  _page = null
  if (_unsubReady) { _unsubReady(); _unsubReady = null }
}

async function loadAll(page) {
  if (_page !== page) return
  if (!(await ensureGatewayReady(page))) {
    _state.loading = false
    _state.actionLoading = false
    renderPage(page)
    return
  }

  _state.loading = true
  _state.error = ''
  _state.unsupported = false
  _state.toggleBlockedReason = ''
  _state.pluginSupportsDreaming = null
  renderPage(page)

  const [statusResult, diaryResult, configResult] = await Promise.allSettled([
    wsClient.request('doctor.memory.status', {}),
    wsClient.request('doctor.memory.dreamDiary', {}),
    wsClient.request('config.get', {}),
  ])

  if (_page !== page) return

  if (statusResult.status === 'fulfilled') {
    _state.status = normalizeStatus(statusResult.value?.dreaming ?? statusResult.value)
    _state.actionsSupported = true
  } else {
    _state.status = null
    _state.error = errorMessage(statusResult.reason)
    _state.unsupported = isUnsupportedError(statusResult.reason)
    _state.actionsSupported = !_state.unsupported
  }

  if (diaryResult.status === 'fulfilled') {
    const payload = diaryResult.value || {}
    _state.diaryPath = normalizeString(payload.path || 'DREAMS.md')
    _state.diaryContent = payload.found === false ? null : (typeof payload.content === 'string' ? payload.content : null)
    _state.diarySupported = true
  } else {
    _state.diarySupported = !isUnsupportedError(diaryResult.reason)
    if (!_state.diarySupported) {
      _state.diaryContent = null
    } else if (!_state.error) {
      _state.error = errorMessage(diaryResult.reason)
    }
  }

  if (configResult.status === 'fulfilled') {
    const snapshot = asRecord(configResult.value)
    _state.configSnapshot = snapshot && typeof snapshot.hash === 'string' ? snapshot : null
    _state.pluginId = resolveMemoryPluginId(_state.configSnapshot?.config)
    if (!_state.configSnapshot?.hash) {
      _state.toggleBlockedReason = t('pages.dreaming.configUnavailable')
    } else {
      try {
        const lookup = await wsClient.request('config.schema.lookup', {
          path: `plugins.entries.${_state.pluginId}.config`,
        })
        const hasDreaming = lookupIncludesDreamingProperty(lookup)
        const strictSchema = lookupDisallowsUnknownProperties(lookup)
        if (hasDreaming) {
          _state.pluginSupportsDreaming = true
        } else if (strictSchema) {
          _state.pluginSupportsDreaming = false
          _state.toggleBlockedReason = t('pages.dreaming.pluginUnsupported')
        }
      } catch (lookupError) {
        if (!isUnsupportedError(lookupError) && !_state.toggleBlockedReason) {
          _state.toggleBlockedReason = ''
        }
      }
    }
  } else {
    _state.configSnapshot = null
    _state.toggleBlockedReason = t('pages.dreaming.configUnavailable')
  }

  _state.loading = false
  _state.actionLoading = false
  renderPage(page)
}

async function runAction(method, successText, options = {}) {
  if (!_page || _state.actionLoading) return
  if (!(wsClient.connected && wsClient.gatewayReady)) {
    toast(t('pages.dreaming.gwWait'), 'warning')
    return
  }
  _state.actionLoading = true
  renderPage(_page)
  try {
    await wsClient.request(method, {})
    toast(successText, 'success')
    await loadAll(_page)
  } catch (e) {
    if (isUnsupportedError(e)) {
      toast(t('pages.dreaming.rpcUnsupported'), 'warning')
    } else {
      toast(`${t('pages.dreaming.loadFailed')}: ${e?.message || e}`, 'error')
    }
    _state.actionLoading = false
    renderPage(_page)
  }
}

async function toggleDreaming() {
  if (!_page || _state.actionLoading) return
  if (!(wsClient.connected && wsClient.gatewayReady)) {
    toast(t('pages.dreaming.gwWait'), 'warning')
    return
  }
  if (_state.toggleBlockedReason) {
    toast(_state.toggleBlockedReason, 'warning')
    return
  }
  if (!_state.configSnapshot?.hash) {
    toast(t('pages.dreaming.configUnavailable'), 'warning')
    return
  }
  if (_state.pluginSupportsDreaming === false) {
    toast(t('pages.dreaming.pluginUnsupported'), 'warning')
    return
  }
  const enabled = _state.status?.enabled === true
  const pluginId = resolveMemoryPluginId(_state.configSnapshot.config)
  _state.actionLoading = true
  renderPage(_page)
  try {
    await wsClient.request('config.patch', {
      baseHash: _state.configSnapshot.hash,
      raw: JSON.stringify({
        plugins: {
          entries: {
            [pluginId]: {
              config: {
                dreaming: {
                  enabled: !enabled,
                },
              },
            },
          },
        },
      }),
      sessionKey: wsClient.sessionKey || undefined,
      note: 'Dreaming settings updated from Privix.',
    })
    toast(!enabled ? t('pages.dreaming.enabled') : t('pages.dreaming.disabled'), 'success')
    await loadAll(_page)
  } catch (e) {
    if (isUnsupportedError(e)) {
      if (!_state.toggleBlockedReason) _state.toggleBlockedReason = t('pages.dreaming.pluginUnsupported')
      toast(t('pages.dreaming.rpcUnsupported'), 'warning')
    } else {
      toast(`${t('pages.dreaming.toggleFailed')}: ${errorMessage(e)}`, 'error')
    }
    _state.actionLoading = false
    renderPage(_page)
  }
}

function renderStatCard(label, value, meta = '') {
  return `
    <div class="stat-card">
      <div class="stat-card-header"><span class="stat-card-label">${esc(label)}</span></div>
      <div class="stat-card-value">${esc(value)}</div>
      ${meta ? `<div class="stat-card-meta">${esc(meta)}</div>` : ''}
    </div>
  `
}

function renderPhaseCard(title, phase) {
  const meta = [
    phase.cron ? `${t('pages.dreaming.cron')}: ${phase.cron}` : t('pages.dreaming.notScheduled'),
    phase.nextRunAtMs ? `${t('pages.dreaming.nextRun')}: ${formatNextRun(phase.nextRunAtMs)}` : '',
  ].filter(Boolean).join(' · ')

  const details = [
    phase.limit ? `limit ${phase.limit}` : '',
    phase.lookbackDays ? `lookback ${phase.lookbackDays}d` : '',
    typeof phase.minScore === 'number' ? `score≥${phase.minScore}` : '',
    typeof phase.minPatternStrength === 'number' ? `pattern≥${phase.minPatternStrength}` : '',
    phase.minRecallCount ? `recalls≥${phase.minRecallCount}` : '',
    phase.minUniqueQueries ? `uniq≥${phase.minUniqueQueries}` : '',
  ].filter(Boolean).join(' · ')

  return `
    <div class="config-section" style="margin:0">
      <div class="config-section-title" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span>${esc(title)}</span>
        <span class="badge${phase.enabled ? ' badge-success' : ''}">${esc(phase.enabled ? t('pages.dreaming.statusEnabled') : t('pages.dreaming.statusDisabled'))}</span>
      </div>
      <div class="form-hint">${esc(meta || t('pages.dreaming.notScheduled'))}</div>
      ${details ? `<div style="margin-top:8px;font-size:12px;color:var(--text-secondary)">${esc(details)}</div>` : ''}
    </div>
  `
}

function renderEntries(title, entries) {
  const content = entries.length
    ? entries.slice(0, 8).map((entry) => `
        <div style="padding:10px 0;border-bottom:1px solid var(--border-primary)">
          <div style="font-size:13px;color:var(--text-primary);line-height:1.6">${esc(entry.snippet || '(empty)')}</div>
          <div style="margin-top:6px;font-size:12px;color:var(--text-secondary)">${esc(entry.path)}${entry.startLine ? ':' + entry.startLine : ''}${entry.endLine && entry.endLine !== entry.startLine ? '-' + entry.endLine : ''}</div>
          <div style="margin-top:4px;font-size:12px;color:var(--text-tertiary)">
            ${esc([
              entry.recallCount ? `${entry.recallCount} recall` : '',
              entry.dailyCount ? `${entry.dailyCount} daily` : '',
              entry.groundedCount ? `${entry.groundedCount} grounded` : '',
              entry.totalSignalCount ? `${entry.totalSignalCount} signals` : '',
              entry.phaseHitCount ? `${entry.phaseHitCount} ${t('pages.dreaming.phaseHits')}` : '',
            ].filter(Boolean).join(' · '))}
          </div>
        </div>
      `).join('')
    : `<div class="form-hint">${esc(t('pages.dreaming.noEntries'))}</div>`

  return `
    <div class="config-section" style="margin:0">
      <div class="config-section-title">${esc(title)}</div>
      ${content}
    </div>
  `
}

function renderActionButtons(enabled, disabledAttr) {
  const toggleText = enabled ? t('pages.dreaming.toggleOff') : t('pages.dreaming.toggleOn')
  const actionsDisabled = !_state.actionsSupported ? 'disabled title="' + esc(t('pages.dreaming.rpcUnsupported')) + '"' : disabledAttr
  const diaryDisabled = !_state.diarySupported ? 'disabled title="' + esc(t('pages.dreaming.rpcUnsupported')) + '"' : disabledAttr
  return `
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-sm ${enabled ? 'btn-warning' : 'btn-primary'}" id="btn-dreaming-toggle" ${disabledAttr}>${esc(_state.actionLoading ? t('pages.dreaming.actionRunning') : toggleText)}</button>
      <button class="btn btn-sm btn-secondary" id="btn-dreaming-backfill" ${diaryDisabled}>${esc(t('pages.dreaming.backfill'))}</button>
      <button class="btn btn-sm btn-secondary" id="btn-dreaming-reset-diary" ${diaryDisabled}>${esc(t('pages.dreaming.resetDiary'))}</button>
      <button class="btn btn-sm btn-secondary" id="btn-dreaming-clear-grounded" ${actionsDisabled}>${esc(t('pages.dreaming.clearGrounded'))}</button>
    </div>
  `
}

function renderStatusHints() {
  const hints = []
  if (_state.toggleBlockedReason) hints.push(`<div class="form-hint" style="margin-top:10px">${esc(_state.toggleBlockedReason)}</div>`)
  if (!_state.diarySupported || !_state.actionsSupported) hints.push(`<div class="form-hint" style="margin-top:8px;color:var(--text-tertiary)">${esc(t('pages.dreaming.rpcUnsupported'))}</div>`)
  if (_state.error && !_state.unsupported) hints.push(`<div style="margin-top:12px;color:var(--warning)">${esc(_state.error)}</div>`)
  return hints.join('')
}

/** ChatGPT 导入消化视图（OpenClaw 4.11+） */
function renderImportView() {
  return `
    <div class="config-section">
      <div class="config-section-title">导入外部对话</div>
      <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-md);line-height:1.6">
        将 ChatGPT、Claude 等平台的对话历史导入 OpenClaw，让 Agent 消化并提取洞察，丰富长期记忆。
      </p>
      <div style="border:2px dashed var(--border-primary);border-radius:var(--radius-lg);padding:32px;text-align:center;color:var(--text-tertiary)">
        <div style="font-size:var(--font-size-lg);margin-bottom:8px">📥</div>
        <div>拖拽 JSON 文件到此处，或点击选择文件</div>
        <div style="font-size:var(--font-size-xs);margin-top:8px">支持 ChatGPT conversations.json 格式</div>
        <input type="file" id="dreaming-import-file" accept=".json" style="display:none">
        <button class="btn btn-primary btn-sm" style="margin-top:var(--space-md)" onclick="this.previousElementSibling.click()">选择文件</button>
      </div>
      <div id="dreaming-import-result" style="margin-top:var(--space-md);display:none"></div>
    </div>
  `
}

/** Memory Palace 视图（OpenClaw 4.11+） */
function renderPalaceView() {
  return `
    <div class="config-section">
      <div class="config-section-title">Memory Palace</div>
      <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-md);line-height:1.6">
        Memory Palace 是 Agent 的长期记忆可视化界面，展示从日常对话和导入内容中提炼的核心知识图谱。
      </p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px" id="palace-rooms">
        <div class="stat-card loading-placeholder" style="height:100px"></div>
        <div class="stat-card loading-placeholder" style="height:100px"></div>
        <div class="stat-card loading-placeholder" style="height:100px"></div>
      </div>
      <div class="form-hint" style="margin-top:var(--space-md)">
        Memory Palace 数据由 Dreaming 自动维护，需要 OpenClaw 2026.4.11 或更高版本。
      </div>
    </div>
  `
}

function renderViewTabs() {
  const hasDreamingImport = isFeatureAvailable('dreaming-import')
  const hasMemoryPalace = isFeatureAvailable('memory-palace')
  return `
    <div class="tab-bar" style="margin-bottom:var(--space-lg)">
      <div class="tab${_state.view === 'scene' ? ' active' : ''}" data-dreaming-view="scene">${esc(t('pages.dreaming.viewScene'))}</div>
      <div class="tab${_state.view === 'diary' ? ' active' : ''}" data-dreaming-view="diary">${esc(t('pages.dreaming.viewDiary'))}</div>
      ${hasDreamingImport ? `<div class="tab${_state.view === 'import' ? ' active' : ''}" data-dreaming-view="import">导入消化</div>` : ''}
      ${hasMemoryPalace ? `<div class="tab${_state.view === 'palace' ? ' active' : ''}" data-dreaming-view="palace">Memory Palace</div>` : ''}
    </div>
  `
}

function renderDreamLane(title, subtitle, entries, accent) {
  const tones = {
    violet: { dot: '#a855f7', border: 'var(--accent, #6366f1)' },
    cyan: { dot: '#22d3ee', border: 'var(--success, #22c55e)' },
    amber: { dot: '#fbbf24', border: 'var(--warning, #f59e0b)' },
  }
  const tone = tones[accent] || tones.violet
  const items = entries.length
    ? entries.slice(0, 4).map((entry, idx) => `
        <div style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;${idx < Math.min(entries.length, 4) - 1 ? 'border-bottom:1px solid var(--border-primary)' : ''}">
          <div style="width:8px;height:8px;border-radius:999px;background:${tone.dot};margin-top:6px;flex-shrink:0"></div>
          <div style="min-width:0">
            <div style="font-size:13px;line-height:1.6;color:var(--text-primary)">${esc(entry.snippet || '(empty)')}</div>
            <div style="margin-top:4px;font-size:12px;color:var(--text-tertiary)">${esc(entry.path)}${entry.startLine ? ':' + entry.startLine : ''}</div>
          </div>
        </div>
      `).join('')
    : `<div class="form-hint">${esc(t('pages.dreaming.noEntries'))}</div>`
  return `
    <div class="config-section" style="margin:0;border-left:3px solid ${tone.border}">
      <div class="config-section-title" style="display:flex;align-items:center;gap:8px">
        <span>${esc(title)}</span>
        <span class="badge" style="font-size:11px">${entries.length}</span>
      </div>
      <div class="form-hint" style="margin-bottom:8px">${esc(subtitle)}</div>
      ${items}
    </div>
  `
}

function renderSceneView(status, enabled, heroText, disabledAttr, nextRun) {
  const STARS = [
    { top: 8, left: 15, size: 3, delay: 0 },
    { top: 12, left: 72, size: 2, delay: 1.4 },
    { top: 22, left: 35, size: 3, delay: 0.6 },
    { top: 18, left: 88, size: 2, delay: 2.1 },
    { top: 35, left: 8, size: 2, delay: 0.9 },
    { top: 45, left: 92, size: 2, delay: 1.7 },
    { top: 55, left: 25, size: 3, delay: 2.5 },
    { top: 65, left: 78, size: 2, delay: 0.3 },
    { top: 75, left: 45, size: 2, delay: 1.1 },
    { top: 82, left: 60, size: 3, delay: 1.8 },
    { top: 30, left: 55, size: 2, delay: 0.4 },
    { top: 88, left: 18, size: 2, delay: 2.3 },
  ]
  const starsHtml = STARS.map(s => `<div class="dream-star" style="top:${s.top}%;left:${s.left}%;width:${s.size}px;height:${s.size}px;animation-delay:${s.delay}s"></div>`).join('')

  return `
    <style>
      @keyframes dream-twinkle { 0%,100% { opacity:.3; transform:scale(1) } 50% { opacity:1; transform:scale(1.6) } }
      @keyframes dream-float { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-6px) } }
      @keyframes dream-z { 0% { opacity:0; transform:translate(0,0) scale(.6) } 30% { opacity:.7 } 100% { opacity:0; transform:translate(18px,-32px) scale(1.1) } }
      .dream-hero { position:relative; overflow:hidden; border-radius:22px; padding:28px 24px 24px; background:radial-gradient(circle at 20% 10%, rgba(139,92,246,0.42), rgba(15,23,42,0.94) 52%), linear-gradient(135deg, #0f172a 0%, #1e1b4b 55%, #312e81 100%); color:#e2e8f0; box-shadow:0 24px 64px rgba(15,23,42,0.35); margin-bottom:var(--space-lg) }
      .dream-star { position:absolute; border-radius:999px; background:rgba(255,255,255,0.85); box-shadow:0 0 12px rgba(255,255,255,0.35); animation:dream-twinkle 3s ease-in-out infinite }
      .dream-moon { position:absolute; top:22px; right:28px; width:100px; height:100px; border-radius:999px; background:radial-gradient(circle at 35% 35%, rgba(255,255,255,0.98), rgba(224,231,255,0.92) 38%, rgba(196,181,253,0.56) 62%, rgba(99,102,241,0.16) 100%); box-shadow:0 0 32px rgba(196,181,253,0.45), 0 0 88px rgba(99,102,241,0.18); animation:dream-float 6s ease-in-out infinite }
      .dream-z { position:absolute; top:28px; right:140px; font-size:16px; font-weight:700; color:rgba(196,181,253,0.6); animation:dream-z 2.5s ease-out infinite }
      .dream-z:nth-child(2) { animation-delay:.8s; font-size:13px; right:148px; top:22px }
      .dream-z:nth-child(3) { animation-delay:1.6s; font-size:20px; right:132px; top:16px }
      .dream-hero .badge { background:rgba(255,255,255,0.1); color:#e2e8f0; border-color:rgba(255,255,255,0.15) }
      .dream-hero .badge-success { background:rgba(74,222,128,0.15); color:#86efac; border-color:rgba(74,222,128,0.25) }
      .dream-hero .btn-primary { background:rgba(99,102,241,0.85) }
      .dream-hero .btn-secondary { background:rgba(255,255,255,0.08); color:#e2e8f0; border-color:rgba(255,255,255,0.15) }
      .dream-hero .btn-secondary:hover { background:rgba(255,255,255,0.14) }
      .dream-hero .btn-secondary:disabled { opacity:.4 }
      .dream-hero .btn-warning { background:rgba(251,191,36,0.2); color:#fbbf24; border-color:rgba(251,191,36,0.3) }
      .dream-hero .form-hint { color:rgba(226,232,240,0.6) }
      .dream-stats-row { position:relative; display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-top:22px }
      .dream-stat-glass { padding:14px 16px; border-radius:16px; background:rgba(255,255,255,0.06); backdrop-filter:blur(8px); border:1px solid rgba(255,255,255,0.08) }
      .dream-stat-glass .ds-label { font-size:12px; color:rgba(226,232,240,0.6) }
      .dream-stat-glass .ds-value { font-size:22px; font-weight:700; margin-top:4px; color:#e2e8f0 }
    </style>
    <div class="dream-hero">
      ${starsHtml}
      <div class="dream-moon"></div>
      <span class="dream-z">z</span>
      <span class="dream-z">z</span>
      <span class="dream-z">Z</span>

      <div style="position:relative;display:flex;justify-content:space-between;gap:18px;align-items:flex-start;flex-wrap:wrap">
        <div style="max-width:600px">
          <div class="badge${enabled ? ' badge-success' : ''}" style="margin-bottom:10px">${esc(enabled ? t('pages.dreaming.statusEnabled') : t('pages.dreaming.statusDisabled'))}</div>
          <div style="font-size:26px;font-weight:700;letter-spacing:-0.02em;margin-bottom:10px">${esc(t('pages.dreaming.sceneTitle'))}</div>
          <div style="font-size:13px;line-height:1.8;color:rgba(226,232,240,0.88);max-width:540px">${esc(t('pages.dreaming.sceneDesc'))}</div>
          <div style="margin-top:12px;font-size:13px;line-height:1.8;color:rgba(255,255,255,0.92)">${esc(heroText)}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
            <span class="badge">${esc(`${t('pages.dreaming.nextRun')}: ${nextRun}`)}</span>
            <span class="badge">${esc(`${t('pages.dreaming.timezone')}: ${status?.timezone || '—'}`)}</span>
            <span class="badge">${esc(`${t('pages.dreaming.memoryPath')}: ${status?.storePath || 'MEMORY.md'}`)}</span>
          </div>
        </div>
        <div style="position:relative;z-index:1;display:flex;flex-direction:column;gap:10px;align-items:flex-end;max-width:420px">
          ${renderActionButtons(enabled, disabledAttr)}
        </div>
      </div>
      ${renderStatusHints()}
      <div class="dream-stats-row">
        <div class="dream-stat-glass"><div class="ds-label">${esc(t('pages.dreaming.sceneConstellation'))}</div><div class="ds-value">${esc(status?.shortTermCount ?? 0)}</div></div>
        <div class="dream-stat-glass"><div class="ds-label">${esc(t('pages.dreaming.sceneSignals'))}</div><div class="ds-value">${esc(status?.totalSignalCount ?? 0)}</div></div>
        <div class="dream-stat-glass"><div class="ds-label">${esc(t('pages.dreaming.scenePromotions'))}</div><div class="ds-value">${esc(status?.promotedTotal ?? 0)}</div></div>
        <div class="dream-stat-glass"><div class="ds-label">${esc(t('pages.dreaming.sceneQueue'))}</div><div class="ds-value">${esc((status?.shortTermEntries || []).length)}</div></div>
      </div>
    </div>

    <div class="stat-cards" style="margin-bottom:var(--space-lg)">
      ${renderStatCard(t('pages.dreaming.promotedToday'), status?.promotedToday ?? 0)}
      ${renderStatCard(t('pages.dreaming.grounded'), status?.groundedSignalCount ?? 0)}
      ${renderStatCard(t('pages.dreaming.storageMode'), status?.storageMode || 'inline')}
      ${renderStatCard(t('pages.dreaming.shortTerm'), status?.shortTermCount ?? 0, `${t('pages.dreaming.memoryPath')}: ${status?.storePath || 'MEMORY.md'}`)}
      ${renderStatCard(t('pages.dreaming.signals'), status?.totalSignalCount ?? 0, `${t('pages.dreaming.diaryPath')}: ${_state.diaryPath || 'DREAMS.md'}`)}
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:var(--space-md);margin-bottom:var(--space-lg)">
      ${renderPhaseCard(t('pages.dreaming.phaseLight'), status?.phases?.light || normalizePhase(null))}
      ${renderPhaseCard(t('pages.dreaming.phaseDeep'), status?.phases?.deep || normalizePhase(null))}
      ${renderPhaseCard(t('pages.dreaming.phaseRem'), status?.phases?.rem || normalizePhase(null))}
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:var(--space-md)">
      ${renderDreamLane(t('pages.dreaming.sceneQueue'), t('pages.dreaming.entriesShortTerm'), status?.shortTermEntries || [], 'violet')}
      ${renderDreamLane(t('pages.dreaming.sceneSignals'), t('pages.dreaming.entriesSignals'), status?.signalEntries || [], 'cyan')}
      ${renderDreamLane(t('pages.dreaming.scenePromotions'), t('pages.dreaming.entriesPromoted'), status?.promotedEntries || [], 'amber')}
    </div>
  `
}

function renderDiaryView(status, enabled, heroText, disabledAttr) {
  const sections = parseDiarySections(_state.diaryContent)
  const diaryUnavailable = !_state.diarySupported

  let diaryBody = ''
  if (diaryUnavailable) {
    diaryBody = `
      <div class="config-section" style="margin:0;border-left:3px solid var(--warning)">
        <div class="config-section-title">${esc(t('pages.dreaming.diary'))}</div>
        <div class="form-hint" style="line-height:1.8">${esc(t('pages.dreaming.rpcUnsupported'))}</div>
      </div>`
  } else {
    diaryBody = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:var(--space-md)">
        <div class="config-section" style="margin:0">
          <div class="config-section-title">${esc(t('pages.dreaming.diarySections'))}</div>
          ${sections.length
            ? sections.map((section, idx) => `
                <div style="padding:14px 0;border-bottom:${idx === sections.length - 1 ? 'none' : '1px solid var(--border-primary)'}">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                    <span class="badge${idx === 0 ? ' badge-success' : ''}">${esc(`${t('pages.dreaming.diarySection')} ${idx + 1}`)}</span>
                    <span style="font-weight:600;color:var(--text-primary)">${esc(section.title)}</span>
                  </div>
                  <div style="font-size:13px;line-height:1.7;color:var(--text-secondary)">${esc(section.body.slice(0, 220) || section.title)}</div>
                </div>
              `).join('')
            : `<div class="form-hint" style="line-height:1.8">${esc(t('pages.dreaming.diaryEmpty'))}<br>${esc(t('pages.dreaming.diaryEmptyHint'))}</div>`}
        </div>

        <div class="config-section" style="margin:0">
          <div class="config-section-title">${esc(t('pages.dreaming.diaryRaw'))}</div>
          ${typeof _state.diaryContent === 'string'
            ? `<pre style="white-space:pre-wrap;word-break:break-word;background:var(--bg-secondary);border-radius:var(--radius);padding:var(--space-md);font-size:12px;line-height:1.7;max-height:560px;overflow:auto">${esc(_state.diaryContent)}</pre>`
            : `<div class="form-hint" style="line-height:1.8">${esc(t('pages.dreaming.diaryEmpty'))}<br>${esc(t('pages.dreaming.diaryEmptyHint'))}</div>`}
        </div>
      </div>`
  }

  return `
    <div class="config-section" style="margin-bottom:var(--space-lg)">
      <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1;min-width:280px">
          <div class="config-section-title">${esc(t('pages.dreaming.diary'))}</div>
          <div style="font-size:13px;line-height:1.8;color:var(--text-secondary)">${esc(heroText)}</div>
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
            <span class="badge${enabled ? ' badge-success' : ''}">${esc(enabled ? t('pages.dreaming.statusEnabled') : t('pages.dreaming.statusDisabled'))}</span>
            <span class="badge">${esc(`${t('pages.dreaming.diaryPath')}: ${_state.diaryPath || 'DREAMS.md'}`)}</span>
            ${!diaryUnavailable ? `<span class="badge">${esc(`${t('pages.dreaming.diarySections')}: ${sections.length}`)}</span>` : ''}
          </div>
        </div>
        ${renderActionButtons(enabled, disabledAttr)}
      </div>
      ${renderStatusHints()}
    </div>

    ${diaryBody}
  `
}

function bindEvents(page) {
  page.querySelectorAll('[data-dreaming-view]').forEach((tab) => {
    tab.addEventListener('click', () => {
      _state.view = tab.dataset.dreamingView || 'scene'
      renderPage(page)
    })
  })
  page.querySelector('#btn-dreaming-refresh')?.addEventListener('click', () => loadAll(page))
  page.querySelector('#btn-dreaming-open-memory')?.addEventListener('click', () => navigate('/memory'))
  page.querySelector('#btn-dreaming-toggle')?.addEventListener('click', () => toggleDreaming())
  page.querySelector('#btn-dreaming-backfill')?.addEventListener('click', () => runAction('doctor.memory.backfillDreamDiary', t('pages.dreaming.backfillDone')))
  page.querySelector('#btn-dreaming-reset-diary')?.addEventListener('click', async () => {
    const yes = await showConfirm(t('pages.dreaming.confirmResetDiary'))
    if (!yes) return
    runAction('doctor.memory.resetDreamDiary', t('pages.dreaming.resetDiaryDone'))
  })
  page.querySelector('#btn-dreaming-clear-grounded')?.addEventListener('click', async () => {
    const yes = await showConfirm(t('pages.dreaming.confirmClearGrounded'))
    if (!yes) return
    runAction('doctor.memory.resetGroundedShortTerm', t('pages.dreaming.clearGroundedDone'))
  })
}

function renderPage(page) {
  const status = _state.status
  const ready = wsClient.connected && wsClient.gatewayReady
  const enabled = status?.enabled === true
  const nextRun = formatNextRun(resolveNextRun(status))
  const heroText = enabled ? t('pages.dreaming.heroActive') : t('pages.dreaming.heroIdle')
  const disabledAttr = _state.actionLoading || !ready ? 'disabled' : ''

  let body = ''

  if (_state.loading) {
    body = `
      <div class="stat-card loading-placeholder" style="height:120px"></div>
      <div class="stat-card loading-placeholder" style="height:220px;margin-top:var(--space-md)"></div>
    `
  } else if (!ready) {
    body = `
      <div class="config-section">
        <div style="color:var(--text-tertiary);margin-bottom:8px">${esc(t('pages.dreaming.gwConnecting'))}</div>
        <div class="form-hint">${esc(t('pages.dreaming.gwWait'))}</div>
      </div>
    `
  } else if (_state.unsupported) {
    body = `
      <div class="config-section" style="border-left:3px solid var(--warning)">
        <div class="config-section-title">${esc(t('pages.dreaming.loadFailed'))}</div>
        <div style="color:var(--warning);line-height:1.7">${esc(_state.error || t('pages.dreaming.unsupportedHint'))}</div>
        <div class="form-hint" style="margin-top:8px">${esc(t('pages.dreaming.loadFailedHint'))}</div>
      </div>
    `
  } else {
    const viewContent = _state.view === 'diary'
      ? renderDiaryView(status, enabled, heroText, disabledAttr)
      : _state.view === 'import'
        ? renderImportView()
        : _state.view === 'palace'
          ? renderPalaceView()
          : renderSceneView(status, enabled, heroText, disabledAttr, nextRun)
    body = renderViewTabs() + viewContent
  }

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title apple-section">${t('pages.dreaming.title')}</h1>
      <p class="page-desc apple-body-secondary">${t('pages.dreaming.desc')}</p>
      <div class="page-actions" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-pill-filled" id="btn-dreaming-refresh">${icon('refresh-cw', 14)} ${t('pages.dreaming.refresh')}</button>
        <button class="btn btn-pill-outline" id="btn-dreaming-open-memory">${t('pages.dreaming.openMemory')}</button>
      </div>
    </div>
    ${body}
  `

  bindEvents(page)
}

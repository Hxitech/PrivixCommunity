/**
 * Hermes Channels — 19 个 messaging platform 启停管理
 *
 * 对齐 Hermes v0.11.0 的 platforms.py(NousResearch/hermes-agent)
 * 数据源:~/.hermes/config.yaml 的 platforms.* 节 + ~/.hermes/.env 的环境变量
 */
import { api } from '../../../lib/tauri-api.js'
import { t } from '../../../lib/i18n.js'
import { toast } from '../../../components/toast.js'
import { reportError } from '../../../lib/error-report.js'
import { wrapAsyncButton } from '../../../lib/async-button.js'
import { scheduleGatewayRestart } from '../../../lib/gateway-restart-queue.js'
import { navigate } from '../../../router.js'
import { escapeHtml } from '../../../lib/escape.js'

export function render() {
  const el = document.createElement('div')
  el.className = 'page'
  el.innerHTML = `
    <div class="page-header">
      <h1>${t('comp.header.page_channels')}</h1>
      <p style="color:var(--text-tertiary);font-size:var(--font-size-sm);margin-top:6px">
        ${t('pages.engine.channelsHeaderHint')}
      </p>
    </div>
    <div class="card">
      <div class="card-body" style="padding:0">
        <div id="hm-channels-list" style="padding:16px"></div>
      </div>
    </div>
  `
  load(el)
  return el
}

async function load(el) {
  const list = el.querySelector('#hm-channels-list')
  list.innerHTML = `<div style="text-align:center;color:var(--text-tertiary);padding:24px">${t('common.loading')}</div>`
  try {
    const data = await api.hermesListChannels()
    renderList(el, data)
  } catch (e) {
    reportError(e, { context: t('pages.engine.channelsLoadError') })
    list.innerHTML = `<div style="color:var(--error);padding:16px;text-align:center">${escapeHtml(String(e))}</div>`
  }
}

function renderList(el, data) {
  const list = el.querySelector('#hm-channels-list')
  const channels = data?.channels || []
  list.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px">
      ${channels.map(ch => renderCard(ch)).join('')}
    </div>
    <div style="margin-top:16px;padding:12px 14px;background:var(--bg-tertiary);border-radius:8px;color:var(--text-tertiary);font-size:var(--font-size-2xs);line-height:1.6">
      📁 config.yaml: <code style="font-family:var(--font-mono)">${escapeHtml(data.config_path || '~/.hermes/config.yaml')}</code><br>
      🔐 .env: <code style="font-family:var(--font-mono)">${escapeHtml(data.env_path || '~/.hermes/.env')}</code><br>
      ${t('pages.engine.channelsHintAdvanced')}
    </div>
  `
  bindActions(el, channels)
}

function renderCard(ch) {
  const required = (ch.required_env || []).length
  const missing = (ch.missing_env || []).length
  const cfgBadge = required === 0
    ? `<span class="hm-ch-badge ok">${t('pages.engine.channelsBadgeNoConfig')}</span>`
    : missing === 0
      ? `<span class="hm-ch-badge ok">✓ ${t('pages.engine.channelsBadgeConfigured')}</span>`
      : `<span class="hm-ch-badge warn">${t('pages.engine.channelsBadgeMissing', { count: missing })}</span>`
  const enabledClass = ch.enabled ? 'on' : 'off'
  const isLocked = ch.key === 'api_server' || ch.key === 'cli'
  return `
    <div class="hm-ch-card ${enabledClass}" data-key="${escapeHtml(ch.key)}">
      <div class="hm-ch-head">
        <div class="hm-ch-label">${escapeHtml(ch.label)}</div>
        ${cfgBadge}
      </div>
      <div class="hm-ch-desc">${escapeHtml(ch.desc)}</div>
      ${(ch.required_env || []).length ? `
        <div class="hm-ch-env">
          ${ch.required_env.map(k => {
            const present = !ch.missing_env.includes(k)
            return `<code class="hm-ch-env-key ${present ? 'present' : 'absent'}" title="${present ? t('pages.engine.channelsEnvPresent') : t('pages.engine.channelsEnvAbsent')}">${escapeHtml(k)}</code>`
          }).join('')}
        </div>
      ` : ''}
      <div class="hm-ch-actions">
        <label class="toggle-switch ${isLocked ? 'disabled' : ''}" title="${isLocked ? t('pages.engine.channelsLockedHint') : ''}">
          <input type="checkbox" data-toggle="${escapeHtml(ch.key)}" ${ch.enabled ? 'checked' : ''} ${isLocked ? 'disabled' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <button class="btn btn-sm btn-secondary" data-edit-yaml="${escapeHtml(ch.key)}">${t('pages.engine.channelsBtnEditYaml')}</button>
      </div>
    </div>
  `
}

function bindActions(el, channels) {
  el.querySelectorAll('input[data-toggle]').forEach(input => {
    input.addEventListener('change', async () => {
      const key = input.dataset.toggle
      const enabled = input.checked
      const ch = channels.find(c => c.key === key)
      if (!ch.configured && enabled && (ch.required_env || []).length) {
        input.checked = false
        toast(t('pages.engine.channelsNeedEnv', { vars: ch.required_env.join(', ') }), 'warning')
        return
      }
      try {
        await api.hermesSetChannelEnabled(key, enabled)
        toast(enabled ? t('pages.engine.channelsToastEnabled', { name: ch.label }) : t('pages.engine.channelsToastDisabled', { name: ch.label }), 'success')
        scheduleGatewayRestart({ delay: 500, reason: `channel ${key} ${enabled ? 'enabled' : 'disabled'}` })
        load(el)
      } catch (e) {
        input.checked = !enabled
        reportError(e, { context: t('pages.engine.channelsToastSaveFailed', { name: ch.label }) })
      }
    })
  })

  el.querySelectorAll('button[data-edit-yaml]').forEach(btn => {
    wrapAsyncButton(btn, async () => {
      navigate(`/h/config?focus=${encodeURIComponent('platforms.' + btn.dataset.editYaml)}`)
    })
  })
}

// 卡片样式 — 注入一次,跨实例复用
if (!document.getElementById('hm-channels-style')) {
  const s = document.createElement('style')
  s.id = 'hm-channels-style'
  s.textContent = `
    .hm-ch-card {
      padding: 14px;
      border: 1px solid var(--border-secondary);
      border-radius: 12px;
      background: var(--bg-card);
      transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }
    .hm-ch-card.on { border-left: 3px solid var(--success); }
    .hm-ch-card.off { border-left: 3px solid var(--border-primary); opacity: 0.85; }
    .hm-ch-card:hover { box-shadow: var(--shadow-sm); border-color: var(--border-primary); }
    .hm-ch-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .hm-ch-label { font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); color: var(--text-primary); }
    .hm-ch-desc { font-size: var(--font-size-2xs); color: var(--text-tertiary); margin-bottom: 10px; line-height: 1.5; }
    .hm-ch-env { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .hm-ch-env-key { font-family: var(--font-mono); font-size: var(--font-size-2xs); padding: 2px 8px; border-radius: 4px; }
    .hm-ch-env-key.present { background: var(--success-muted); color: var(--success); }
    .hm-ch-env-key.absent { background: var(--warning-muted); color: var(--warning); }
    .hm-ch-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 10px; border-top: 1px solid var(--border-secondary); }
    .hm-ch-badge { font-size: var(--font-size-2xs); padding: 2px 8px; border-radius: 999px; font-weight: var(--font-weight-medium); }
    .hm-ch-badge.ok { background: var(--success-muted); color: var(--success); }
    .hm-ch-badge.warn { background: var(--warning-muted); color: var(--warning); }
    .toggle-switch.disabled { opacity: 0.5; cursor: not-allowed; }
  `
  document.head.appendChild(s)
}

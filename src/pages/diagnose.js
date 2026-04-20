/**
 * Gateway 连接诊断页面
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { t } from '../lib/i18n.js'
import { icon, statusIcon } from '../lib/icons.js'

const STEP_LABELS = {
  config: () => t('pages.diagnose.stepConfig'),
  device_key: () => t('pages.diagnose.stepDeviceKey'),
  allowed_origins: () => t('pages.diagnose.stepOrigins'),
  tcp_port: () => t('pages.diagnose.stepTcp'),
  http_health: () => t('pages.diagnose.stepHttp'),
  err_log: () => t('pages.diagnose.stepErrLog'),
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title apple-section">${t('pages.diagnose.title')}</h1>
      <p class="page-desc apple-body-secondary">${t('pages.diagnose.desc')}</p>
    </div>
    <div style="margin-bottom:16px">
      <button class="btn btn-pill-filled" id="btn-diagnose">${t('pages.diagnose.runDiagnose')}</button>
    </div>
    <div id="diagnose-summary" style="margin-bottom:16px"></div>
    <div id="diagnose-steps" class="card-grid" style="margin-bottom:24px">
      <div class="empty-state" style="padding:32px;text-align:center">
        <div class="apple-tile">${t('pages.diagnose.noData')}</div>
      </div>
    </div>
    <div id="diagnose-env" style="display:none">
      <h3 class="apple-tile" style="margin-bottom:12px">${t('pages.diagnose.envInfo')}</h3>
      <div class="stat-card apple-caption" id="env-content" style="overflow-x:auto"></div>
    </div>
  `

  const btnDiagnose = page.querySelector('#btn-diagnose')

  btnDiagnose.onclick = async () => {
    btnDiagnose.disabled = true
    btnDiagnose.textContent = t('pages.diagnose.running')
    page.querySelector('#diagnose-summary').innerHTML = ''
    page.querySelector('#diagnose-steps').innerHTML = '<div class="stat-card loading-placeholder" style="height:40px;margin:8px 0"></div>'.repeat(6)

    try {
      const result = await api.diagnoseGatewayConnection()
      renderResult(page, result)
    } catch (e) {
      toast.error(`${t('pages.diagnose.diagnoseFailed')}: ${e}`)
      page.querySelector('#diagnose-steps').innerHTML = `<div class="empty-state" style="padding:32px;color:var(--text-error)">${t('pages.diagnose.diagnoseFailed')}: ${e}</div>`
    } finally {
      btnDiagnose.disabled = false
      btnDiagnose.textContent = t('pages.diagnose.runDiagnose')
    }
  }

  return page
}

function renderResult(page, result) {
  // Summary
  const summaryEl = page.querySelector('#diagnose-summary')
  if (result.overallOk) {
    summaryEl.innerHTML = `<div class="stat-card" style="background:var(--success-bg,#f0fdf4);border:1px solid var(--success-border,#86efac);padding:12px 16px">${t('pages.diagnose.allPassed')}</div>`
  } else {
    summaryEl.innerHTML = `<div class="stat-card" style="display:flex;align-items:center;gap:8px;background:var(--error-bg,#fef2f2);border:1px solid var(--error-border,#fca5a5);padding:12px 16px">${statusIcon('warn', 18)}<span>${result.summary}</span></div>`
  }

  // Steps
  const stepsEl = page.querySelector('#diagnose-steps')
  stepsEl.innerHTML = result.steps.map(step => {
    const label = STEP_LABELS[step.name]?.() || step.name
    const stepIcon = statusIcon(step.ok ? 'ok' : 'err', 16)
    const status = step.ok ? t('pages.diagnose.passed') : t('pages.diagnose.failed')
    const bgColor = step.ok ? 'var(--bg-secondary,#f9fafb)' : 'var(--error-bg,#fef2f2)'
    return `
      <div class="stat-card" style="background:${bgColor};padding:12px 16px;margin-bottom:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div style="display:flex;align-items:center;gap:8px;min-width:0">
            ${stepIcon}
            <strong style="white-space:nowrap">${label}</strong>
          </div>
          <span style="font-size:var(--font-size-xs);color:var(--text-tertiary);white-space:nowrap">${step.durationMs}ms</span>
        </div>
        <div style="margin-top:6px;font-size:var(--font-size-sm);color:var(--text-secondary);word-break:break-all">${escHtml(step.message)}</div>
      </div>`
  }).join('')

  // Env info
  const envEl = page.querySelector('#diagnose-env')
  envEl.style.display = ''
  const env = result.env
  const rows = [
    [t('pages.diagnose.openclawDir'), env.openclawDir],
    [t('pages.diagnose.port'), env.port],
    [t('pages.diagnose.authMode'), env.authMode],
    [t('pages.diagnose.deviceKey'), env.deviceKeyExists ? statusIcon('ok', 14) : statusIcon('err', 14)],
  ]
  let html = '<table style="width:100%;border-collapse:collapse">'
  for (const [k, v] of rows) {
    // SVG 字符串以 `<svg` 开头,不 escape(deviceKey 状态行);其他纯文本 escape
    const safeV = typeof v === 'string' && v.startsWith('<svg') ? v : escHtml(String(v))
    html += `<tr><td style="padding:4px 12px 4px 0;font-weight:600;white-space:nowrap;color:var(--text-secondary)">${k}</td><td style="padding:4px 0;word-break:break-all">${safeV}</td></tr>`
  }
  html += '</table>'

  if (env.errLogExcerpt) {
    html += `<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:600;color:var(--text-secondary)">${t('pages.diagnose.errLogExcerpt')}</summary><pre style="margin-top:8px;font-size:12px;max-height:200px;overflow:auto;background:var(--bg-tertiary,#1e1e1e);color:var(--text-primary);padding:8px;border-radius:6px">${escHtml(env.errLogExcerpt)}</pre></details>`
  }

  page.querySelector('#env-content').innerHTML = html
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

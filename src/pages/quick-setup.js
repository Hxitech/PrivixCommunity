/**
 * 一键配置 — 社区版精简向导
 * 2 步:OpenClaw 状态 → 完成
 *
 * 设计:Apple 极简风格,每步 56px hero + 17px 描述 + pill CTA
 * 进度:2 个 8px 圆点,activate 用 --accent-blue
 * 内容最大宽 640px(比 Overview 980 更聚焦)
 */
import { navigate } from '../router.js'
import { isOpenclawReady, detectOpenclawStatus } from '../lib/app-state.js'
import { getProfileHomeRoute } from '../lib/product-profile.js'
import { t } from '../lib/i18n.js'

let _state = null
let _root = null
let _clickHandler = null

function defaultState() {
  return {
    step: 1,
    openclaw: { detected: false, ready: false, detecting: false },
  }
}

export function render() {
  const page = document.createElement('div')
  page.className = 'page quick-setup-page'
  _root = page
  _state = defaultState()
  // 初始检测
  _state.openclaw.ready = isOpenclawReady()

  paint(page)
  // 异步刷新 OpenClaw 状态
  refreshOpenclaw()
  return page
}

function refreshOpenclaw() {
  _state.openclaw.detecting = true
  paint(_root)
  detectOpenclawStatus().then(() => {
    _state.openclaw.detected = true
    _state.openclaw.ready = isOpenclawReady()
    _state.openclaw.detecting = false
    paint(_root)
  }).catch(() => {
    _state.openclaw.detecting = false
    paint(_root)
  })
}

function paint(page) {
  if (!page) return
  page.innerHTML = `
    <div class="quick-setup-shell">
      ${renderProgress(_state.step)}
      <div class="quick-setup-stage">
        ${renderStep(_state.step)}
      </div>
    </div>
  `
  // 仅当本次 page 还未绑定时挂 listener — 跨 re-mount 安全
  if (!_clickHandler) bind(page)
}

function renderProgress(current) {
  const dots = [1, 2].map(i => {
    const cls = i === current ? 'qs-dot qs-dot-active'
              : i < current ? 'qs-dot qs-dot-done'
              : 'qs-dot'
    return `<span class="${cls}"></span>`
  }).join('<span class="qs-dot-line"></span>')
  return `<div class="quick-setup-progress" aria-label="step ${current} of 2">${dots}</div>`
}

function renderStep(step) {
  switch (step) {
    case 1: return renderStep1()
    case 2: return renderStep2()
    default: return renderStep1()
  }
}

function renderStep1() {
  const { detecting, ready } = _state.openclaw
  const statusBadge = detecting
    ? `<span class="qs-status qs-status-checking">${esc(t('pages.quick_setup.detecting') || '检测中...')}</span>`
    : ready
      ? `<span class="qs-status qs-status-ok">✓ ${esc(t('pages.quick_setup.openclaw_ready') || 'OpenClaw 已就绪')}</span>`
      : `<span class="qs-status qs-status-warn">⚠ ${esc(t('pages.quick_setup.openclaw_missing') || '尚未检测到 OpenClaw')}</span>`

  const cta = ready
    ? `<button class="btn btn-pill-filled" data-qs-action="next">${esc(t('pages.quick_setup.continue') || '继续')}</button>`
    : `<a class="btn btn-pill-filled" href="#/setup">${esc(t('pages.quick_setup.go_setup') || '前往安装向导')}</a>`

  return `
    <h1 class="apple-hero">${esc(t('pages.quick_setup.step1_title') || 'OpenClaw 状态')}</h1>
    <p class="apple-body-secondary qs-step-desc">${esc(t('pages.quick_setup.step1_desc') || '一键配置首先确认 OpenClaw 后端运行环境。这是其余 AI 能力的基础。')}</p>
    <div class="qs-card">
      <div class="qs-card-row">
        <div>
          <div class="apple-card-title">${esc(t('pages.quick_setup.openclaw_status') || 'OpenClaw 后端')}</div>
          <div class="apple-caption">${esc(t('pages.quick_setup.openclaw_status_desc') || '本地 Node.js 服务,运行 Agent / 工具 / Skills')}</div>
        </div>
        ${statusBadge}
      </div>
    </div>
    <div class="qs-actions">
      <button class="btn btn-pill-outline" data-qs-action="recheck">${esc(t('pages.quick_setup.recheck') || '重新检测')}</button>
      ${cta}
    </div>
  `
}

function renderStep2() {
  const checks = [
    { key: 'openclaw', ok: _state.openclaw.ready, label: t('pages.quick_setup.openclaw_ready') || 'OpenClaw 已就绪' },
  ]
  const summary = checks.map(c => `
    <div class="qs-card-row" style="padding:8px 0">
      <span class="qs-check ${c.ok ? 'qs-check-ok' : 'qs-check-warn'}">${c.ok ? '✓' : '○'}</span>
      <span class="apple-body" style="margin-left:12px">${esc(c.label)}</span>
    </div>
  `).join('')
  return `
    <div class="qs-done-icon">✓</div>
    <h1 class="apple-hero">${esc(t('pages.quick_setup.step4_title') || '配置完成')}</h1>
    <p class="apple-body-secondary qs-step-desc">${esc(t('pages.quick_setup.step4_desc') || '工作台已准备就绪,可以开始使用 AI Agent 能力。')}</p>
    <div class="qs-card">${summary}</div>
    <div class="qs-actions">
      <button class="btn btn-pill-outline" data-qs-action="prev">${esc(t('pages.quick_setup.back') || '返回')}</button>
      <button class="btn btn-pill-filled" data-qs-action="finish">${esc(t('pages.quick_setup.go_workbench') || '进入工作台')}</button>
    </div>
  `
}

function bind(page) {
  _clickHandler = (e) => {
    const btn = e.target.closest('[data-qs-action]')
    if (!btn) return
    const action = btn.dataset.qsAction
    if (action === 'next') {
      _state.step = Math.min(2, _state.step + 1)
      paint(page)
    } else if (action === 'prev') {
      _state.step = Math.max(1, _state.step - 1)
      paint(page)
    } else if (action === 'recheck') {
      refreshOpenclaw()
    } else if (action === 'finish') {
      navigate(getProfileHomeRoute())
    }
  }
  page.addEventListener('click', _clickHandler)
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function cleanup() {
  if (_root && _clickHandler) _root.removeEventListener('click', _clickHandler)
  _state = null
  _root = null
  _clickHandler = null
}

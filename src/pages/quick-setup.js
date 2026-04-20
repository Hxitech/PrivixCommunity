/**
 * 一键配置 — Phase F 统一向导
 * 4 步:OpenClaw 状态 → AI Provider 配置 → 行业模块开启 → 完成
 *
 * 设计:Apple 极简风格,每步 56px hero + 17px 描述 + pill CTA
 * 进度:4 个 8px 圆点,activate 用 --accent-blue
 * 内容最大宽 640px(比 Overview 980 更聚焦)
 */
import { navigate } from '../router.js'
import { isOpenclawReady, detectOpenclawStatus } from '../lib/app-state.js'
import { isModuleEnabled, MODULE_IDS, getProfileHomeRoute } from '../lib/product-profile.js'
import { t } from '../lib/i18n.js'
import { openAiConfigWizard } from './invest-dashboard.js'

let _state = null
let _root = null
let _clickHandler = null

function defaultState() {
  return {
    step: 1,
    openclaw: { detected: false, ready: false, detecting: false },
    industries: { invest: false, knowledge: false, sop: false },
  }
}

export function render() {
  const page = document.createElement('div')
  page.className = 'page quick-setup-page'
  _root = page
  _state = defaultState()
  // 初始检测
  _state.industries.invest = isModuleEnabled(MODULE_IDS.INVEST)
  _state.industries.knowledge = isModuleEnabled(MODULE_IDS.KNOWLEDGE)
  _state.industries.sop = isModuleEnabled(MODULE_IDS.SOP)
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
  const dots = [1, 2, 3, 4].map(i => {
    const cls = i === current ? 'qs-dot qs-dot-active'
              : i < current ? 'qs-dot qs-dot-done'
              : 'qs-dot'
    return `<span class="${cls}"></span>`
  }).join('<span class="qs-dot-line"></span>')
  return `<div class="quick-setup-progress" aria-label="step ${current} of 4">${dots}</div>`
}

function renderStep(step) {
  switch (step) {
    case 1: return renderStep1()
    case 2: return renderStep2()
    case 3: return renderStep3()
    case 4: return renderStep4()
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
  const desc = t('pages.quick_setup.step2_desc') || '配置至少一个 AI 服务商(OpenAI、Anthropic、Ollama 等),Hermes 与各 Agent 将使用此配置。'
  return `
    <h1 class="apple-hero">${esc(t('pages.quick_setup.step2_title') || 'AI Provider')}</h1>
    <p class="apple-body-secondary qs-step-desc">${esc(desc)}</p>
    <div class="qs-card qs-card-action">
      <div>
        <div class="apple-card-title">${esc(t('pages.quick_setup.ai_wizard_title') || '一键 AI 配置向导')}</div>
        <div class="apple-caption">${esc(t('pages.quick_setup.ai_wizard_desc') || '复用现有向导,选择服务商 + 填 Key,完成后回到此页继续。')}</div>
      </div>
      <button class="btn btn-pill-filled" data-qs-action="open-ai-wizard">${esc(t('pages.quick_setup.open_wizard') || '打开向导')}</button>
    </div>
    <div class="qs-actions">
      <button class="btn btn-pill-outline" data-qs-action="prev">${esc(t('pages.quick_setup.back') || '返回')}</button>
      <button class="btn btn-pill-filled" data-qs-action="next">${esc(t('pages.quick_setup.continue') || '继续')}</button>
    </div>
  `
}

function renderStep3() {
  const modules = [
    { key: 'invest', label: t('pages.overview.zone_invest_label') || '投资管理', desc: t('pages.overview.zone_invest_desc') || '项目管道、企业库、文档' },
    { key: 'knowledge', label: t('pages.overview.zone_qa_label') || 'Agent 知识库', desc: t('pages.overview.zone_qa_desc') || '知识库整理与检索' },
    { key: 'sop', label: t('pages.overview.zone_sop_label') || 'Agent SOP', desc: t('pages.overview.zone_sop_desc') || 'SOP 规则与流程' },
  ]
  const anyEnabled = modules.some(m => _state.industries[m.key])
  const cards = modules.map(m => {
    const enabled = _state.industries[m.key]
    const badge = enabled
      ? `<span class="qs-status qs-status-ok">✓ ${esc(t('pages.quick_setup.module_active') || '已激活')}</span>`
      : `<span class="qs-status qs-status-muted">${esc(t('pages.quick_setup.module_inactive') || '未激活')}</span>`
    return `
      <div class="qs-card qs-card-row">
        <div>
          <div class="apple-card-title">${esc(m.label)}</div>
          <div class="apple-caption">${esc(m.desc)}</div>
        </div>
        ${badge}
      </div>
    `
  }).join('')
  const hint = anyEnabled
    ? ''
    : `<p class="apple-caption qs-warn">${esc(t('pages.quick_setup.no_module_hint') || '至少需要激活一个行业模块才能继续。请前往「面板设置 → License」激活。')}</p>`
  return `
    <h1 class="apple-hero">${esc(t('pages.quick_setup.step3_title') || '行业模块')}</h1>
    <p class="apple-body-secondary qs-step-desc">${esc(t('pages.quick_setup.step3_desc') || '选择主营场景。模块由 license 控制,运行时只激活一个。')}</p>
    ${cards}
    ${hint}
    <div class="qs-actions">
      <button class="btn btn-pill-outline" data-qs-action="prev">${esc(t('pages.quick_setup.back') || '返回')}</button>
      <button class="btn btn-pill-filled" data-qs-action="next" ${!anyEnabled ? 'disabled' : ''}>${esc(t('pages.quick_setup.continue') || '继续')}</button>
    </div>
  `
}

function renderStep4() {
  // Step 4 只展示客观可检的条目;AI Provider 的真实状态由 wizard 自身负责,这里不再臆测
  const checks = [
    { key: 'openclaw', ok: _state.openclaw.ready, label: t('pages.quick_setup.openclaw_ready') || 'OpenClaw 已就绪' },
    { key: 'industry', ok: _state.industries.invest || _state.industries.knowledge || _state.industries.sop, label: t('pages.quick_setup.industry_active') || '行业模块已激活' },
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
      _state.step = Math.min(4, _state.step + 1)
      paint(page)
    } else if (action === 'prev') {
      _state.step = Math.max(1, _state.step - 1)
      paint(page)
    } else if (action === 'recheck') {
      refreshOpenclaw()
    } else if (action === 'open-ai-wizard') {
      try {
        openAiConfigWizard()
        // 不立即标记 configured —— 由 step 4 的真实检查代替
      } catch (err) {
        console.warn('[quick-setup] openAiConfigWizard failed:', err)
      }
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

/**
 * 关于页面
 * 版本信息、项目链接、相关项目、系统环境
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { showUpgradeModal, showConfirm } from '../components/modal.js'
import { setUpgrading } from '../lib/app-state.js'
import { icon, statusIcon } from '../lib/icons.js'
import { t } from '../lib/i18n.js'
import { diagnoseInstallError } from '../lib/error-diagnosis.js'
import { runPostInstall, navigateToAIAssistant } from '../lib/post-install.js'
import {
  BRAND_ABOUT_SUBTITLE_HTML,
  BRAND_LOGO_ALT,
  BRAND_LOGO_SRC,
  BRAND_NAME,
  BRAND_SHOW_COMPANY_PROFILE,
  COMPANY_ADDRESS,
  COMPANY_EMAIL,
  COMPANY_INTRO,
  COMPANY_NAME_EN,
  COMPANY_PHONE,
  COMPANY_TAGLINE,
  COMPANY_WEBSITE,
  LEGAL_ABOUT_NOTICE,
  LEGAL_AUTHOR,
  LEGAL_COMMERCIAL_NOTICE,
  LEGAL_COPYRIGHT_OWNER,
  LEGAL_MIT_NOTICE,
} from '../lib/brand.js'

const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__

function escapeHtml(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'
  const companySectionTitle = BRAND_SHOW_COMPANY_PROFILE ? t('pages.about.section_about_us') : t('pages.about.section_copyright')

  page.innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;gap:16px">
      <img src="${BRAND_LOGO_SRC}" alt="${BRAND_LOGO_ALT}" style="height:48px;width:auto">
      <div>
        <h1 class="apple-section" style="margin:0">${BRAND_NAME}</h1>
        <p class="apple-body-secondary" style="margin:0">${BRAND_ABOUT_SUBTITLE_HTML}</p>
      </div>
    </div>
    <div class="stat-cards" id="version-cards">
      <div class="stat-card loading-placeholder"></div>
      <div class="stat-card loading-placeholder"></div>
      <div class="stat-card loading-placeholder"></div>
    </div>
    <div class="config-section">
      <div class="config-section-title">${t('pages.about.section_projects')}</div>
      <div id="projects-list"></div>
    </div>
    <div class="config-section">
      <div class="config-section-title">${companySectionTitle}</div>
      <div id="company-section"></div>
    </div>
    <div class="config-section" style="color:var(--text-tertiary);font-size:var(--font-size-xs)">
      <p>${t('pages.about.tech_footer', { name: BRAND_NAME })}</p>
      <p style="margin-top:8px">${LEGAL_ABOUT_NOTICE}</p>
    </div>
  `

  loadData(page)
  renderProjects(page)
  renderCompany(page)
  return page
}

async function loadData(page) {
  const cards = page.querySelector('#version-cards')
  try {
    const [version, install] = await Promise.all([
      api.getVersionInfo(),
      api.checkInstallation(),
    ])

    // 尝试从 Tauri API 获取 Privix 自身版本号，失败则 fallback
    let panelVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0'
    try {
      const { getVersion } = await import('@tauri-apps/api/app')
      panelVersion = await getVersion()
    } catch {
      // 非 Tauri 环境或 API 不可用，使用构建时注入的版本号
    }

    // 社区版:无远程更新检查
    let panelUpdateHtml = ''

    const isInstalled = !!version.current
    const sourceLabel = version.source === 'official' ? t('pages.about.source_official') : version.source === 'chinese' ? t('pages.about.source_chinese') : t('pages.about.source_unknown')
    const btnSm = 'padding:2px 8px;font-size:var(--font-size-xs)'
    const hasRecommended = !!version.recommended
    const aheadOfRecommended = isInstalled && hasRecommended && !!version.ahead_of_recommended
    const driftFromRecommended = isInstalled && hasRecommended && !version.is_recommended && !aheadOfRecommended
    // 细分版本超前程度：轻微（1-2个补丁）vs 显著
    const policyRiskHint = aheadOfRecommended
      ? (isMinorVersionAhead(version.current, version.recommended)
        ? t('pages.about.policy_minor_ahead', { current: version.current, recommended: version.recommended })
        : t('pages.about.policy_major_ahead', { current: version.current, recommended: version.recommended }))
      : t('pages.about.policy_default')

    cards.innerHTML = `
      <div class="stat-card">
        <div class="stat-card-header"><span class="stat-card-label">${BRAND_NAME}</span></div>
        <div class="stat-card-value">${panelVersion}</div>
        <div class="stat-card-meta" id="panel-update-meta" style="display:flex;align-items:center;gap:8px">${panelUpdateHtml}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header"><span class="stat-card-label">OpenClaw · ${sourceLabel}</span></div>
        <div class="stat-card-value">${version.current || t('pages.about.not_installed')}</div>
        <div class="stat-card-meta" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${isInstalled && hasRecommended
            ? (aheadOfRecommended
              ? `<span style="color:var(--warning,#f59e0b)">${t('pages.about.ahead_of_recommended', { version: version.recommended })}</span>
                 <button class="btn btn-primary btn-sm" id="btn-apply-recommended" style="${btnSm}">${t('pages.about.rollback_to_recommended')}</button>`
              : driftFromRecommended
              ? `<span style="color:var(--accent)">${t('pages.about.recommended_stable', { version: version.recommended })}</span>
                 <button class="btn btn-primary btn-sm" id="btn-apply-recommended" style="${btnSm}">${t('pages.about.switch_to_recommended')}</button>`
              : `<span style="color:var(--success)">${t('pages.about.is_recommended')}</span>`)
            : ''}
          ${version.latest_update_available && version.latest ? `<span style="color:var(--text-tertiary)">${t('pages.about.latest_upstream', { version: version.latest })}</span>` : ''}
          <button class="btn btn-${isInstalled ? 'secondary' : 'primary'} btn-sm" id="btn-version-mgmt" style="${btnSm}">
            ${isInstalled ? t('pages.about.switch_version') : t('pages.about.install_openclaw')}
          </button>
          ${isInstalled ? `<button class="btn btn-secondary btn-sm" id="btn-uninstall" style="${btnSm};color:var(--error)">${t('pages.about.uninstall')}</button>` : ''}
        </div>
        <div style="margin-top:8px;font-size:var(--font-size-xs);color:var(--text-tertiary);line-height:1.6">
          ${policyRiskHint}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header"><span class="stat-card-label">${t('pages.about.install_path')}</span></div>
        <div class="stat-card-value" style="font-size:var(--font-size-sm);word-break:break-all">${install.path || t('pages.about.path_unknown')}</div>
        <div class="stat-card-meta">${install.installed ? t('pages.about.config_exists') : t('pages.about.config_not_found')}</div>
      </div>
    `

    const applyRecommendedBtn = cards.querySelector('#btn-apply-recommended')
    if (applyRecommendedBtn && version.recommended) {
      applyRecommendedBtn.onclick = () => doInstall(page, aheadOfRecommended ? t('pages.about.rollback_to_stable') : t('pages.about.switch_to_stable'), version.source, version.recommended)
    }

    // 版本管理 / 安装
    const versionMgmtBtn = cards.querySelector('#btn-version-mgmt')
    if (versionMgmtBtn) {
      versionMgmtBtn.onclick = () => showVersionPicker(page, version)
    }

    // 卸载
    const uninstallBtn = cards.querySelector('#btn-uninstall')
    if (uninstallBtn) {
      uninstallBtn.onclick = async () => {
        const confirmed = await showConfirm(t('pages.about.confirm_uninstall'))
        if (!confirmed) return
        const modal = showUpgradeModal(t('pages.about.uninstall_title'))
        // 卸载进度标签定制：复用安装进度条，但显示卸载专用文案
        modal.setProgressLabels({
          preparing: t('pages.about.uninstall_stopping'),
          downloading: t('pages.about.uninstall_removing'),
          installing: t('pages.about.uninstall_cleaning'),
          done: t('pages.about.uninstall_done'),
        })
        modal.onClose(() => loadData(page))
        modal.appendLog(t('pages.about.uninstall_start'))
        let unlistenLog, unlistenProgress, unlistenDone, unlistenError
        const cleanup = () => { unlistenLog?.(); unlistenProgress?.(); unlistenDone?.(); unlistenError?.() }
        try {
          if (window.__TAURI_INTERNALS__) {
            const { listen } = await import('@tauri-apps/api/event')
            unlistenLog = await listen('upgrade-log', (e) => modal.appendLog(e.payload))
            unlistenProgress = await listen('upgrade-progress', (e) => modal.setProgress(e.payload))
            unlistenDone = await listen('upgrade-done', (e) => { cleanup(); modal.setDone(typeof e.payload === 'string' ? e.payload : t('pages.about.uninstall_complete')) })
            unlistenError = await listen('upgrade-error', (e) => { cleanup(); modal.setError(t('pages.about.uninstall_failed', { error: e.payload || t('pages.about.error_unknown') })) })
            await api.uninstallOpenclaw(false)
            modal.appendLog(t('pages.about.uninstall_task_started'))
          } else {
            const msg = await api.uninstallOpenclaw(false)
            modal.setDone(typeof msg === 'string' ? msg : t('pages.about.uninstall_complete'))
            cleanup()
          }
        } catch (e) {
          cleanup()
          modal.setError(t('pages.about.uninstall_failed', { error: e?.message || String(e) }))
        }
      }
    }
  } catch {
    cards.innerHTML = `<div class="stat-card"><div class="stat-card-label">${t('pages.about.load_failed')}</div></div>`
  }
}

/**
 * 版本选择器弹窗 — 选择版本（汉化版/原版）+ 版本号
 */
async function showVersionPicker(page, currentVersion) {
  const isInstalled = !!currentVersion.current
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `
    <div class="modal" style="max-width:460px">
      <div class="modal-title">${isInstalled ? t('pages.about.version_picker_title_switch') : t('pages.about.version_picker_title_install')}</div>
      <div style="display:flex;flex-direction:column;gap:16px;margin:16px 0">
        <div>
          <label style="font-size:var(--font-size-sm);color:var(--text-secondary);display:block;margin-bottom:8px">${t('pages.about.version_label')}</label>
          <div style="display:flex;gap:8px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:6px 12px;border-radius:8px;border:1px solid var(--border);font-size:var(--font-size-sm);flex:1;justify-content:center;transition:all .15s" id="lbl-official">
              <input type="radio" name="oc-source" value="official" ${currentVersion.source !== 'chinese' ? 'checked' : ''} style="accent-color:var(--primary)">
              ${t('pages.about.version_official')}
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:6px 12px;border-radius:8px;border:1px solid var(--border);font-size:var(--font-size-sm);flex:1;justify-content:center;transition:all .15s" id="lbl-chinese">
              <input type="radio" name="oc-source" value="chinese" ${currentVersion.source === 'chinese' ? 'checked' : ''} style="accent-color:var(--primary)">
              ${t('pages.about.version_chinese')}
            </label>
          </div>
        </div>
        <div>
          <label style="font-size:var(--font-size-sm);color:var(--text-secondary);display:block;margin-bottom:8px">${t('pages.about.version_select_label')}</label>
          <select id="oc-version-select" class="input" style="width:100%;padding:8px 12px;font-size:var(--font-size-sm)">
            <option value="">${t('pages.about.version_loading')}</option>
          </select>
        </div>
        <div style="font-size:var(--font-size-xs);color:var(--text-tertiary);line-height:1.6;padding:10px 12px;border-radius:8px;background:var(--bg-tertiary)">
          ${t('pages.about.version_picker_hint')}
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;min-height:18px">
          <div id="oc-action-hint" style="font-size:var(--font-size-xs);color:var(--text-tertiary)"></div>
          <div id="nightly-toggle" style="display:none"></div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" data-action="cancel">${t('pages.about.btn_cancel')}</button>
        <button class="btn btn-primary btn-sm" data-action="confirm" disabled id="oc-confirm-btn">${isInstalled ? t('pages.about.btn_switch') : t('pages.about.btn_install')}</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  const select = overlay.querySelector('#oc-version-select')
  const confirmBtn = overlay.querySelector('#oc-confirm-btn')
  const hintEl = overlay.querySelector('#oc-action-hint')
  const radios = overlay.querySelectorAll('input[name="oc-source"]')
  const lblChinese = overlay.querySelector('#lbl-chinese')
  const lblOfficial = overlay.querySelector('#lbl-official')

  const close = () => overlay.remove()
  overlay.querySelector('[data-action="cancel"]').onclick = close
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })

  let versionsCache = {}
  let currentSelect = currentVersion.source === 'chinese' ? 'chinese' : 'official'

  function updateRadioStyle() {
    const sel = currentSelect
    lblChinese.style.borderColor = sel !== 'official' ? 'var(--primary)' : 'var(--border)'
    lblChinese.style.background = sel !== 'official' ? 'var(--primary-bg, rgba(99,102,241,0.06))' : ''
    lblOfficial.style.borderColor = sel === 'official' ? 'var(--primary)' : 'var(--border)'
    lblOfficial.style.background = sel === 'official' ? 'var(--primary-bg, rgba(99,102,241,0.06))' : ''
  }

  function updateHint() {
    const targetSource = currentSelect
    const targetVer = select.value
    if (!targetVer || targetVer === '') { hintEl.textContent = ''; confirmBtn.disabled = true; return }
    const targetTag = select.selectedIndex === 0 ? t('pages.about.tag_recommended') : t('pages.about.tag_self_test')

    const sameSource = targetSource === currentVersion.source

    if (!isInstalled) {
      confirmBtn.textContent = t('pages.about.btn_install')
      const sourceName = targetSource === 'official' ? t('pages.about.version_official') : targetSource === 'chinese' ? t('pages.about.version_chinese') : t('pages.about.source_unknown')
      hintEl.textContent = t('pages.about.hint_will_install', { source: sourceName, version: targetVer, tag: targetTag })
      confirmBtn.disabled = false
      return
    }

    if (!sameSource) {
      confirmBtn.textContent = t('pages.about.btn_switch')
      const curSourceName = currentVersion.source === 'official' ? t('pages.about.version_official') : currentVersion.source === 'chinese' ? t('pages.about.version_chinese') : t('pages.about.source_unknown')
      const tgtSourceName = targetSource === 'official' ? t('pages.about.version_official') : targetSource === 'chinese' ? t('pages.about.version_chinese') : t('pages.about.source_unknown')
      hintEl.innerHTML = `${t('pages.about.hint_current_label')}<strong>${curSourceName} ${currentVersion.current}</strong> → <strong>${tgtSourceName} ${targetVer}</strong>${targetTag}`
      confirmBtn.disabled = false
      return
    }

    // 同源，比较版本
    const parseVer = v => v.split(/[^0-9]/).filter(Boolean).map(Number)
    const cur = parseVer(currentVersion.current)
    const tgt = parseVer(targetVer)
    let cmp = 0
    for (let i = 0; i < Math.max(cur.length, tgt.length); i++) {
      if ((tgt[i] || 0) > (cur[i] || 0)) { cmp = 1; break }
      if ((tgt[i] || 0) < (cur[i] || 0)) { cmp = -1; break }
    }

    if (cmp === 0) {
      confirmBtn.textContent = t('pages.about.btn_reinstall')
      hintEl.textContent = t('pages.about.hint_already_version', { version: targetVer, tag: targetTag })
      confirmBtn.disabled = false
    } else if (cmp > 0) {
      confirmBtn.textContent = t('pages.about.btn_upgrade')
      hintEl.innerHTML = `<span style="color:var(--accent)">${currentVersion.current} → ${targetVer}${targetTag}</span>`
      confirmBtn.disabled = false
    } else {
      confirmBtn.textContent = t('pages.about.btn_downgrade')
      hintEl.innerHTML = `<span style="color:var(--warning,#f59e0b)">${currentVersion.current} → ${targetVer}${targetTag}</span>`
      confirmBtn.disabled = false
    }
  }

  let showNightly = false

  async function loadVersions(source) {
    select.innerHTML = `<option value="">${t('pages.about.version_loading')}</option>`
    confirmBtn.disabled = true
    hintEl.textContent = ''
    try {
      if (!versionsCache[source]) {
        versionsCache[source] = await api.listOpenclawVersions(source)
      }
      const allVersions = versionsCache[source]
      if (!allVersions.length) {
        select.innerHTML = `<option value="">${t('pages.about.version_not_found')}</option>`
        return
      }
      const stable = allVersions.filter(v => !v.includes('nightly') && !v.includes('canary') && !v.includes('alpha') && !v.includes('beta') && !v.includes('rc') && !v.includes('dev') && !v.includes('next'))
      const versions = showNightly ? allVersions : (stable.length > 0 ? stable : allVersions)
      const nightlyCount = allVersions.length - stable.length
      select.innerHTML = versions.map((v, idx) => {
        const isCurrent = isInstalled && v === currentVersion.current && source === currentVersion.source
        return `<option value="${v}">${v}${idx === 0 ? t('pages.about.version_recommended_suffix') : ''}${isCurrent ? t('pages.about.version_current_suffix') : ''}</option>`
      }).join('')
      // nightly 切换提示
      const toggleEl = overlay.querySelector('#nightly-toggle')
      if (toggleEl) {
        if (nightlyCount > 0) {
          toggleEl.style.display = ''
          toggleEl.innerHTML = showNightly
            ? `<a href="#" id="btn-toggle-nightly" style="color:var(--primary);text-decoration:none;font-size:var(--font-size-xs)">${t('pages.about.hide_preview', { count: nightlyCount })}</a>`
            : `<a href="#" id="btn-toggle-nightly" style="color:var(--text-tertiary);text-decoration:none;font-size:var(--font-size-xs)">${t('pages.about.show_preview', { count: nightlyCount })}</a>`
          toggleEl.querySelector('#btn-toggle-nightly').onclick = (e) => { e.preventDefault(); showNightly = !showNightly; loadVersions(source) }
        } else {
          toggleEl.style.display = 'none'
        }
      }
      updateHint()
    } catch (e) {
      select.innerHTML = `<option value="">${t('pages.about.version_load_failed', { error: e.message || String(e) })}</option>`
    }
  }

  radios.forEach(radio => {
    radio.addEventListener('change', () => {
      currentSelect = radio.value
      updateRadioStyle()
      loadVersions(currentSelect)
    })
  })

  select.addEventListener('change', updateHint)

  confirmBtn.onclick = () => {
    const source = currentSelect
    const ver = select.value
    const action = confirmBtn.textContent
    close()
    doInstall(page, `${action} OpenClaw`, source, ver)
  }

  updateRadioStyle()
  loadVersions(currentSelect)
}

/**
 * 执行安装/升级/降级/切换操作（带进度弹窗）
 * method 根据 source 自动决定：official → npm，其他 → auto（先尝试 standalone 再回退 npm）
 */
async function doInstall(page, title, source, version) {
  const method = source === 'official' ? 'npm' : 'auto'
  const modal = showUpgradeModal(title)
  modal.onClose(() => loadData(page))
  let unlistenLog, unlistenProgress, unlistenDone, unlistenError
  setUpgrading(true)

  const cleanup = () => {
    setUpgrading(false)
    unlistenLog?.(); unlistenProgress?.(); unlistenDone?.(); unlistenError?.()
  }

  try {
    if (window.__TAURI_INTERNALS__) {
      const { listen } = await import('@tauri-apps/api/event')
      unlistenLog = await listen('upgrade-log', (e) => modal.appendLog(e.payload))
      unlistenProgress = await listen('upgrade-progress', (e) => modal.setProgress(e.payload))

      unlistenDone = await listen('upgrade-done', async (e) => {
        cleanup()
        modal.setDone(typeof e.payload === 'string' ? e.payload : t('pages.about.operation_complete'))
        await runPostInstall(modal, {
          gatewayMsg: t('pages.about.post_install_gateway'),
          gatewayOk: `${statusIcon('ok', 14)} ${t('pages.about.gateway_ensured')}`,
          gatewayFail: `${statusIcon('warn', 14)} ${t('pages.about.gateway_ensure_failed', { error: '{error}' })}`,
        })
      })

      unlistenError = await listen('upgrade-error', async (e) => {
        cleanup()
        const errStr = String(e.payload || t('pages.about.unknown_error'))
        modal.appendLog(errStr)
        const fullLog = modal.getLogText() + '\n' + errStr
        const diagnosis = diagnoseInstallError(fullLog)
        modal.setError(diagnosis.title, { helpContext: diagnosis.helpContext, logText: fullLog })
        if (diagnosis.hint) modal.appendLog('')
        if (diagnosis.hint) modal.appendHtmlLog(`${statusIcon('info', 14)} ${diagnosis.hint}`)
        if (diagnosis.command) modal.appendHtmlLog(`${icon('clipboard', 14)} ${diagnosis.command}`)
        if (window.__openAIDrawerWithError) {
          window.__openAIDrawerWithError({ title: diagnosis.title, error: fullLog, scene: title, hint: diagnosis.hint })
        }
      })

      await api.upgradeOpenclaw(source, version, method)
      modal.appendLog(t('pages.about.backend_task_started'))
    } else {
      modal.appendLog(t('pages.about.web_mode_log_unavailable'))
      const msg = await api.upgradeOpenclaw(source, version, method)
      modal.setDone(typeof msg === 'string' ? msg : (msg?.message || t('pages.about.operation_complete')))
      cleanup()
    }
  } catch (e) {
    cleanup()
    const errStr = String(e)
    modal.appendLog(errStr)
    const fullLog = modal.getLogText() + '\n' + errStr
    const diagnosis = diagnoseInstallError(fullLog)
    modal.setError(diagnosis.title, { helpContext: diagnosis.helpContext, logText: fullLog })
  }
}

// 社区版:远程热更新检查已移除

function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

/** 判断 current 是否仅略高于 recommended（同年月，日差 ≤ 2） */
function isMinorVersionAhead(current, recommended) {
  if (!current || !recommended) return false
  const pc = current.replace(/^v/, '').replace(/-.*$/, '').split('.').map(Number)
  const pr = recommended.replace(/^v/, '').replace(/-.*$/, '').split('.').map(Number)
  // 年和月必须相同
  if (pc[0] !== pr[0] || pc[1] !== pr[1]) return false
  // 日差 ≤ 2 视为轻微超前
  return (pc[2] || 0) - (pr[2] || 0) <= 2
}


function getProjects() {
  return [
    {
      name: 'OpenClaw',
      desc: t('pages.about.project_openclaw_desc'),
      url: 'https://github.com/openclaw/openclaw',
    },
    {
      name: 'OpenClaw-zh',
      desc: t('pages.about.project_openclaw_zh_desc'),
      url: 'https://github.com/1186258278/OpenClawChineseTranslation',
    },
    {
      name: 'Privix',
      desc: t('pages.about.project_privix_community_desc'),
      url: COMPANY_WEBSITE,
      actionLabel: t('pages.about.btn_website'),
    },
  ]
}

// 社区版已移除授权管理与模块列表

function renderProjects(page) {
  const el = page.querySelector('#projects-list')
  const PROJECTS = getProjects()
  el.innerHTML = PROJECTS.map(p => `
    <div class="service-card">
      <div class="service-info">
        <div>
          <div class="service-name">${p.name}</div>
          <div class="service-desc">${p.desc}</div>
        </div>
      </div>
      <div class="service-actions">
        <a class="btn btn-secondary btn-sm" href="${p.url}" target="_blank" rel="noopener">${p.actionLabel || 'GitHub'}</a>
        ${p.gitee ? `<a class="btn btn-secondary btn-sm" href="${p.gitee}" target="_blank" rel="noopener">${t('pages.about.btn_domestic_mirror')}</a>` : ''}
      </div>
    </div>
  `).join('')
}


function renderCompany(page) {
  const el = page.querySelector('#company-section')
  if (!BRAND_SHOW_COMPANY_PROFILE) {
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
        <div style="padding:14px 16px;border-radius:var(--radius-md);border:1px solid var(--border-primary);background:var(--bg-secondary)">
          <div style="color:var(--text-tertiary);font-size:var(--font-size-xs);margin-bottom:6px">${t('pages.about.label_author')}</div>
          <div style="color:var(--text-primary);font-weight:600">${LEGAL_AUTHOR}</div>
        </div>
        <div style="padding:14px 16px;border-radius:var(--radius-md);border:1px solid var(--border-primary);background:var(--bg-secondary)">
          <div style="color:var(--text-tertiary);font-size:var(--font-size-xs);margin-bottom:6px">${t('pages.about.label_copyright')}</div>
          <div style="color:var(--text-primary);font-weight:600">${LEGAL_COPYRIGHT_OWNER}</div>
        </div>
      </div>
      <div style="margin-top:14px;font-size:var(--font-size-sm);color:var(--text-secondary);line-height:1.8;padding:14px 16px;border-radius:var(--radius-md);background:var(--bg-secondary);border:1px solid var(--border-primary)">
        <p style="margin:0 0 8px">${LEGAL_COMMERCIAL_NOTICE}</p>
        <p style="margin:0">${LEGAL_MIT_NOTICE}</p>
      </div>
    `
    return
  }

  const introHtml = COMPANY_INTRO
    .map((paragraph, index) => `<p style="margin:${index === COMPANY_INTRO.length - 1 ? '0' : '0 0 8px'}">${paragraph}</p>`)
    .join('')

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;align-items:center;gap:14px">
        <img src="${BRAND_LOGO_SRC}" alt="${BRAND_LOGO_ALT}" style="width:52px;height:52px;border-radius:12px;flex-shrink:0">
        <div>
          <div style="font-weight:700;font-size:var(--font-size-lg)">${LEGAL_COPYRIGHT_OWNER}</div>
          <div style="font-size:var(--font-size-sm);color:var(--text-secondary)">${COMPANY_NAME_EN}</div>
          <div style="font-size:var(--font-size-xs);color:var(--accent);margin-top:2px">${COMPANY_TAGLINE}</div>
        </div>
      </div>
      <div style="font-size:var(--font-size-sm);color:var(--text-secondary);line-height:1.8;padding:14px 16px;border-radius:var(--radius-md);background:var(--bg-secondary);border:1px solid var(--border-primary)">
        ${introHtml}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;font-size:var(--font-size-sm)">
        <div style="padding:12px;border-radius:var(--radius-md);border:1px solid var(--border-primary);background:var(--bg-secondary)">
          <div style="color:var(--text-tertiary);font-size:var(--font-size-xs);margin-bottom:4px">${t('pages.about.label_website')}</div>
          <a href="${COMPANY_WEBSITE}" target="_blank" rel="noopener" style="color:var(--accent)">${COMPANY_WEBSITE.replace(/^https?:\/\//, '')}</a>
        </div>
        <div style="padding:12px;border-radius:var(--radius-md);border:1px solid var(--border-primary);background:var(--bg-secondary)">
          <div style="color:var(--text-tertiary);font-size:var(--font-size-xs);margin-bottom:4px">${t('pages.about.label_phone')}</div>
          <span style="color:var(--text-primary)">${COMPANY_PHONE}</span>
        </div>
        <div style="padding:12px;border-radius:var(--radius-md);border:1px solid var(--border-primary);background:var(--bg-secondary)">
          <div style="color:var(--text-tertiary);font-size:var(--font-size-xs);margin-bottom:4px">${t('pages.about.label_email')}</div>
          <a href="mailto:${COMPANY_EMAIL}" style="color:var(--accent)">${COMPANY_EMAIL}</a>
        </div>
        <div style="padding:12px;border-radius:var(--radius-md);border:1px solid var(--border-primary);background:var(--bg-secondary)">
          <div style="color:var(--text-tertiary);font-size:var(--font-size-xs);margin-bottom:4px">${t('pages.about.label_address')}</div>
          <span style="color:var(--text-primary)">${COMPANY_ADDRESS}</span>
        </div>
      </div>
    </div>
  `
}

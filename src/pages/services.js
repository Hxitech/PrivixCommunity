/**
 * 服务管理页面
 * 服务启停 + 更新检测 + 配置备份管理
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { showConfirm, showUpgradeModal } from '../components/modal.js'
import { isMacPlatform, isInDocker, setUpgrading, setUserStopped, resetAutoRestart } from '../lib/app-state.js'
import { diagnoseInstallError } from '../lib/error-diagnosis.js'
import { icon, statusIcon } from '../lib/icons.js'
import { isFeatureAvailable, FEATURE_CONTAINER_MODE } from '../lib/openclaw-feature-gates.js'
import { t } from '../lib/i18n.js'

// HTML 转义，防止 XSS
function escapeHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <h1 class="apple-section">${t('pages.services.title')}</h1>
      <p class="apple-body-secondary">${t('pages.services.page_desc')}</p>
    </div>
    <div id="version-bar"><div class="stat-card loading-placeholder" style="height:80px;margin-bottom:var(--space-lg)"></div></div>
    <div id="container-mode-section"></div>
    <div id="services-list"><div class="stat-card loading-placeholder" style="height:64px"></div></div>
    <div class="config-section" id="config-editor-section" style="display:none">
      <div class="config-section-title">${t('pages.services.config_editor_title')}</div>
      <div class="form-hint" style="margin-bottom:var(--space-sm)">${t('pages.services.config_editor_desc')}</div>
      <div style="display:flex;gap:8px;margin-bottom:var(--space-sm)">
        <button class="btn btn-pill-filled" data-action="save-config" disabled>${t('pages.services.btn_save_restart')}</button>
        <button class="btn btn-secondary btn-sm" data-action="save-config-only" disabled>${t('pages.services.btn_save_only')}</button>
        <button class="btn btn-secondary btn-sm" data-action="reload-config">${t('pages.services.btn_reload')}</button>
      </div>
      <div id="config-editor-status" style="font-size:var(--font-size-xs);margin-bottom:6px;min-height:18px"></div>
      <textarea id="config-editor-area" class="form-input" style="font-family:var(--font-mono);font-size:12px;min-height:320px;resize:vertical;tab-size:2;white-space:pre;overflow-x:auto" spellcheck="false" disabled></textarea>
    </div>
    <div class="config-section" id="backup-section">
      <div class="config-section-title">${t('pages.services.backup_title')}</div>
      <div class="form-hint" style="margin-bottom:var(--space-sm)">${t('pages.services.backup_desc')}</div>
      <div id="backup-actions" style="margin-bottom:var(--space-md)">
        <button class="btn btn-pill-filled" data-action="create-backup">${t('pages.services.btn_create_backup')}</button>
      </div>
      <div id="backup-list"><div class="stat-card loading-placeholder" style="height:48px"></div></div>
    </div>
  `

  bindEvents(page)
  loadAll(page)
  return page
}

async function loadAll(page) {
  const tasks = [loadVersion(page), loadServices(page), loadBackups(page), loadConfigEditor(page), loadContainerMode(page)]
  await Promise.all(tasks)
}

// ===== 版本检测 =====

/** 判断 current 是否仅略高于 recommended（同年月，日差 ≤ 2） */
function isMinorVersionAhead(current, recommended) {
  if (!current || !recommended) return false
  const pc = current.replace(/^v/, '').replace(/-.*$/, '').split('.').map(Number)
  const pr = recommended.replace(/^v/, '').replace(/-.*$/, '').split('.').map(Number)
  if (pc[0] !== pr[0] || pc[1] !== pr[1]) return false
  return (pc[2] || 0) - (pr[2] || 0) <= 2
}

// 后端检测到的当前安装源
let detectedSource = 'chinese'
let lastVersionInfo = null

async function loadVersion(page) {
  const bar = page.querySelector('#version-bar')
  try {
    const info = await api.getVersionInfo()
    lastVersionInfo = info
    detectedSource = info.source || 'chinese'
    const ver = info.current || t('pages.services.no_recommended')
    const hasRecommended = !!info.recommended
    const aheadOfRecommended = !!info.current && hasRecommended && !!info.ahead_of_recommended
    const driftFromRecommended = !!info.current && hasRecommended && !info.is_recommended && !aheadOfRecommended
    const isChinese = detectedSource === 'chinese'
    const sourceTag = isChinese ? t('pages.services.chinese_edition') : t('pages.services.official_edition')
    const switchLabel = isChinese ? t('pages.services.switch_to_official') : t('pages.services.switch_to_chinese')
    const switchTarget = isChinese ? 'official' : 'chinese'
    // 细分版本超前程度
    const isMinorAhead = aheadOfRecommended && isMinorVersionAhead(ver, info.recommended)
    const policyNote = aheadOfRecommended
      ? (isMinorAhead
        ? t('pages.services.policy_minor_ahead', { current: ver, recommended: info.recommended })
        : t('pages.services.policy_major_ahead', { current: ver, recommended: info.recommended }))
      : t('pages.services.policy_default')

    if (isInDocker()) {
      bar.innerHTML = `
        <div class="stat-cards" style="margin-bottom:var(--space-lg)">
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">${t('pages.services.version_label')} · <span style="color:var(--accent)">${t('pages.services.docker_deploy')}</span></span>
            </div>
            <div class="stat-card-value">${ver}</div>
            <div class="stat-card-meta">${info.latest_update_available ? t('pages.services.latest_upstream', { version: info.latest }) + t('pages.services.pull_image_to_update') : t('pages.services.is_current_image')}</div>
            ${info.latest_update_available ? `<div style="margin-top:var(--space-sm)">
              <code style="font-size:var(--font-size-xs);background:var(--bg-tertiary);padding:4px 8px;border-radius:4px;user-select:all">docker pull ghcr.io/qingchencloud/openclaw:latest</code>
            </div>` : ''}
          </div>
        </div>
      `
    } else {
      bar.innerHTML = `
        <div class="stat-cards" style="margin-bottom:var(--space-lg)">
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">${t('pages.services.version_label')} · <span style="color:var(--accent)">${sourceTag}</span></span>
            </div>
            <div class="stat-card-value">${ver}</div>
            <div class="stat-card-meta">
              ${hasRecommended
                ? (aheadOfRecommended ? t('pages.services.ahead_of_recommended', { version: info.recommended }) : driftFromRecommended ? t('pages.services.recommended_stable', { version: info.recommended }) : t('pages.services.aligned_recommended', { version: info.recommended }))
                : t('pages.services.no_recommended')}
              ${info.latest_update_available && info.latest ? ` · ${t('pages.services.latest_upstream', { version: info.latest })}` : ''}
            </div>
            <div style="display:flex;gap:var(--space-sm);margin-top:var(--space-sm);flex-wrap:wrap">
              ${aheadOfRecommended ? `<button class="btn btn-primary btn-sm" data-action="upgrade">${t('pages.services.rollback_to_recommended')}</button>` : driftFromRecommended ? `<button class="btn btn-primary btn-sm" data-action="upgrade">${t('pages.services.switch_to_recommended')}</button>` : ''}
              <button class="btn btn-secondary btn-sm" data-action="switch-source" data-source="${switchTarget}">${switchLabel}</button>
            </div>
            <div style="margin-top:8px;font-size:var(--font-size-xs);color:var(--text-tertiary);line-height:1.6">
              ${policyNote}
            </div>
          </div>
        </div>
      `
    }
  } catch (e) {
    bar.innerHTML = `<div class="stat-card" style="margin-bottom:var(--space-lg)"><div class="stat-card-label">${t('pages.services.version_load_failed')}</div></div>`
  }
}

// ===== Container 模式 (OpenClaw 3.24+) =====

async function loadContainerMode(page) {
  const section = page.querySelector('#container-mode-section')
  if (!section) return

  const available = await isFeatureAvailable(FEATURE_CONTAINER_MODE)
  if (!available) {
    section.innerHTML = ''
    return
  }

  // 从 openclaw.json 读取当前 container 设置
  let containerEnabled = false
  try {
    const config = await api.readOpenclawConfig()
    containerEnabled = config?.container === true
  } catch { /* 配置不存在则默认关闭 */ }

  section.innerHTML = `
    <div class="config-section" style="margin-bottom:var(--space-lg)">
      <div class="config-section-title" style="display:flex;align-items:center;gap:8px">
        ${icon('box', 16)} ${t('pages.services.container_mode')}
        <span style="font-size:var(--font-size-xs);color:var(--accent);font-weight:normal">3.24+</span>
      </div>
      <div class="form-hint" style="margin-bottom:var(--space-sm)">
        ${t('pages.services.container_mode_desc')}
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="container-mode-toggle" ${containerEnabled ? 'checked' : ''} style="width:16px;height:16px">
        <span style="font-size:var(--font-size-sm)">${containerEnabled ? t('pages.services.container_enabled') : t('pages.services.container_disabled')}</span>
      </label>
    </div>
  `

  const toggle = section.querySelector('#container-mode-toggle')
  toggle?.addEventListener('change', async () => {
    const enabled = toggle.checked
    try {
      const config = await api.readOpenclawConfig().catch(() => ({}))
      if (enabled) {
        config.container = true
      } else {
        delete config.container
      }
      await api.writeOpenclawConfig(config)
      const label = toggle.parentElement?.querySelector('span')
      if (label) label.textContent = enabled ? t('pages.services.container_enabled') : t('pages.services.container_disabled')
      toast(t('pages.services.container_toggle_toast', { action: enabled ? t('pages.services.container_action_enabled') : t('pages.services.container_action_disabled') }), 'success')
    } catch (e) {
      toast(t('pages.services.config_save_failed', { error: String(e) }), 'error')
      toggle.checked = !enabled
    }
  })
}

// ===== 服务列表 =====

async function loadServices(page) {
  const container = page.querySelector('#services-list')
  try {
    const [services, guardianInfo] = await Promise.all([
      api.getServicesStatus(),
      api.guardianStatus().catch(() => null),
    ])
    renderServices(container, services, guardianInfo)
  } catch (e) {
    container.innerHTML = `<div style="color:var(--error)">${t('pages.services.load_services_failed', { error: escapeHtml(String(e)) })}</div>`
  }
}

function renderServices(container, services, guardianInfo) {
  const gw = services.find(s => s.label === 'ai.openclaw.gateway')
  const guardianGaveUp = guardianInfo && guardianInfo.giveUp

  let html = ''
  if (gw) {
    // 检测 CLI 是否安装
    const cliMissing = gw.cli_installed === false
    const foreignGateway = gw.running && gw.owned_by_current_instance === false

    html += `
    <div class="service-card" data-label="${gw.label}">
      <div class="service-info">
        <span class="status-dot ${cliMissing ? 'stopped' : foreignGateway ? 'warning' : gw.running ? 'running' : 'stopped'}"></span>
        <div>
          <div class="service-name">${gw.label}</div>
          <div class="service-desc">${cliMissing
            ? t('pages.services.cli_not_installed')
            : (gw.description || '') + (gw.pid ? ' (PID: ' + gw.pid + ')' : '')
          }</div>
        </div>
      </div>
      <div class="service-actions">
        ${cliMissing
          ? `<div style="display:flex;flex-direction:column;gap:var(--space-xs);align-items:flex-end">
               <div style="color:var(--text-tertiary);font-size:var(--font-size-xs)">${t('pages.services.install_cli_hint')}</div>
               <code style="font-size:var(--font-size-xs);background:var(--bg-tertiary);padding:2px 8px;border-radius:4px;user-select:all">npm install -g @qingchencloud/openclaw-zh</code>
               <button class="btn btn-secondary btn-sm" data-action="refresh-services" style="margin-top:4px">${t('pages.services.refresh_status')}</button>
             </div>`
          : foreignGateway
            ? `<div style="display:flex;flex-direction:column;gap:var(--space-xs);align-items:flex-end">
                 <div style="color:var(--warning);font-size:var(--font-size-xs);max-width:320px;text-align:right">${t('pages.services.gateway_external_detected')}</div>
                 <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
                   <button class="btn btn-primary btn-sm" data-action="claim-gateway">${t('pages.services.btn_claim_gateway')}</button>
                   <button class="btn btn-secondary btn-sm" data-action="refresh-services">${t('pages.services.refresh_status')}</button>
                 </div>
               </div>`
          : gw.running
            ? `<button class="btn btn-secondary btn-sm" data-action="restart" data-label="${gw.label}">${t('pages.services.btn_restart')}</button>
               <button class="btn btn-danger btn-sm" data-action="stop" data-label="${gw.label}">${t('pages.services.btn_stop')}</button>
               ${isMacPlatform() ? `<button class="btn btn-danger btn-sm" data-action="uninstall-gateway">${t('pages.services.btn_uninstall')}</button>` : ''}`
            : `${guardianGaveUp
                ? `<div style="display:flex;flex-direction:column;gap:var(--space-xs);align-items:flex-end">
                     <div style="color:var(--error);font-size:var(--font-size-xs);max-width:360px;text-align:right">${t('pages.services.guardian_gave_up')}</div>
                     <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
                       <button class="btn btn-primary btn-sm" data-action="reset-guardian">${t('pages.services.btn_reset_guardian')}</button>
                       <button class="btn btn-secondary btn-sm" data-action="start" data-label="${gw.label}">${t('pages.services.btn_start')}</button>
                     </div>
                   </div>`
                : `<button class="btn btn-primary btn-sm" data-action="start" data-label="${gw.label}">${t('pages.services.btn_start')}</button>`}
               ${isMacPlatform() ? `<button class="btn btn-primary btn-sm" data-action="install-gateway">${t('pages.services.btn_install')}</button><button class="btn btn-danger btn-sm" data-action="uninstall-gateway">${t('pages.services.btn_uninstall')}</button>` : ''}`
        }
      </div>
    </div>`
  } else {
    html += `
    <div class="service-card">
      <div class="service-info">
        <span class="status-dot stopped"></span>
        <div>
          <div class="service-name">ai.openclaw.gateway</div>
          <div class="service-desc">${t('pages.services.gateway_not_installed')}</div>
        </div>
      </div>
      <div class="service-actions">
        <button class="btn btn-primary btn-sm" data-action="install-gateway">${t('pages.services.btn_install')}</button>
      </div>
    </div>`
  }

  container.innerHTML = html
}

// ===== 备份管理 =====

async function loadBackups(page) {
  const list = page.querySelector('#backup-list')
  try {
    const backups = await api.listBackups()
    renderBackups(list, backups)
  } catch (e) {
    list.innerHTML = `<div style="color:var(--error)">${t('pages.services.backup_load_failed', { error: String(e) })}</div>`
  }
}

function renderBackups(container, backups) {
  if (!backups || !backups.length) {
    container.innerHTML = `<div class="apple-caption" style="padding:var(--space-md) 0">${t('pages.services.backup_empty')}</div>`
    return
  }
  container.innerHTML = backups.map(b => {
    const date = b.created_at ? new Date(b.created_at * 1000).toLocaleString() : '—'
    const size = b.size ? (b.size / 1024).toFixed(1) + ' KB' : ''
    return `
      <div class="service-card" data-backup="${b.name}">
        <div class="service-info">
          <div>
            <div class="service-name">${b.name}</div>
            <div class="service-desc">${date}${size ? ' · ' + size : ''}</div>
          </div>
        </div>
        <div class="service-actions">
          <button class="btn btn-primary btn-sm" data-action="restore-backup" data-name="${b.name}">${t('pages.services.btn_restore')}</button>
          <button class="btn btn-danger btn-sm" data-action="delete-backup" data-name="${b.name}">${t('common.delete')}</button>
        </div>
      </div>`
  }).join('')
}

// ===== 事件绑定（事件委托） =====

function bindEvents(page) {
  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    btn.disabled = true

    try {
      switch (action) {
        case 'start':
        case 'stop':
        case 'restart':
          await handleServiceAction(action, btn.dataset.label, page)
          break
        case 'save-config':
          await handleSaveConfig(page, true)
          break
        case 'save-config-only':
          await handleSaveConfig(page, false)
          break
        case 'reload-config':
          await loadConfigEditor(page)
          break
        case 'create-backup':
          await handleCreateBackup(page)
          break
        case 'restore-backup':
          await handleRestoreBackup(btn.dataset.name, page)
          break
        case 'delete-backup':
          await handleDeleteBackup(btn.dataset.name, page)
          break
        case 'upgrade':
          await handleUpgrade(btn, page)
          break
        case 'switch-source':
          await handleSwitchSource(btn.dataset.source, page)
          break
        case 'install-gateway':
          await handleInstallGateway(btn, page)
          break
        case 'uninstall-gateway':
          await handleUninstallGateway(btn, page)
          break
        case 'refresh-services':
          await loadServices(page)
          break
        case 'claim-gateway':
          await handleClaimGateway(btn, page)
          break
        case 'reset-guardian':
          await handleResetGuardian(btn, page)
          break
      }
    } catch (e) {
      toast(e.toString(), 'error')
    } finally {
      btn.disabled = false
    }
  })
}

// ===== 服务操作 =====

function getActionLabel(action) {
  const map = {
    start: t('pages.services.action_start'),
    stop: t('pages.services.action_stop'),
    restart: t('pages.services.action_restart'),
  }
  return map[action] || action
}
const POLL_INTERVAL = 1500  // 轮询间隔 ms
const POLL_TIMEOUT = 30000  // 最长等待 30s

async function handleServiceAction(action, label, page) {
  const fn = { start: api.startService, stop: api.stopService, restart: api.restartService }[action]
  const actionLabel = getActionLabel(action)
  const expectRunning = action !== 'stop'

  // 通知守护模块：用户主动操作
  if (action === 'stop') setUserStopped(true)
  if (action === 'start') resetAutoRestart()

  // 找到触发按钮所在的 service-card，替换按钮区域为加载状态
  const card = page.querySelector(`.service-card[data-label="${label}"]`)
  const actionsEl = card?.querySelector('.service-actions')
  const origHtml = actionsEl?.innerHTML || ''

  let cancelled = false
  if (actionsEl) {
    actionsEl.innerHTML = `
      <div class="service-loading">
        <div class="service-spinner"></div>
        <span class="service-loading-text">${t('pages.services.action_in_progress', { action: actionLabel })}</span>
        <button class="btn btn-sm btn-ghost service-cancel-btn" style="display:none">${t('common.cancel')}</button>
      </div>`
    const cancelBtn = actionsEl.querySelector('.service-cancel-btn')
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => { cancelled = true })
    }
  }

  // 更新状态点为加载中
  const dot = card?.querySelector('.status-dot')
  if (dot) { dot.className = 'status-dot loading' }

  try {
    await fn(label)
  } catch (e) {
    toast(t('pages.services.action_cmd_failed', { action: actionLabel, error: e.message || String(e) }), 'error')
    if (actionsEl) actionsEl.innerHTML = origHtml
    if (dot) dot.className = 'status-dot stopped'
    return
  }

  // 轮询等待实际状态变化
  const startTime = Date.now()
  let showedCancel = false
  const loadingText = actionsEl?.querySelector('.service-loading-text')
  const cancelBtn = actionsEl?.querySelector('.service-cancel-btn')

  while (!cancelled) {
    const elapsed = Date.now() - startTime

    // 5 秒后显示取消按钮
    if (!showedCancel && elapsed > 5000 && cancelBtn) {
      cancelBtn.style.display = ''
      showedCancel = true
    }

    // 更新等待时间
    if (loadingText) {
      const sec = Math.floor(elapsed / 1000)
      loadingText.textContent = t('pages.services.action_in_progress_sec', { action: actionLabel, sec })
    }

    // 超时
    if (elapsed > POLL_TIMEOUT) {
      toast(t('pages.services.action_timeout', { action: actionLabel }), 'warning')
      break
    }

    // 检查实际状态
    try {
      const services = await api.getServicesStatus()
      const svc = services?.find?.(s => s.label === label) || services?.[0]
      if (svc && svc.running === expectRunning) {
        toast(t('pages.services.action_done', { label, action: actionLabel, pid: svc.pid ? ' (PID: ' + svc.pid + ')' : '' }), 'success')
        // 立刻同步全局 Gateway 状态（顶部 banner + WS 连接）
        import('../lib/app-state.js').then(m => m.refreshGatewayStatus()).catch(() => {})
        await loadServices(page)
        return
      }
    } catch {}

    await new Promise(r => setTimeout(r, POLL_INTERVAL))
  }

  if (cancelled) {
    toast(t('pages.services.action_cancelled'), 'info')
  }
  await loadServices(page)
}

// ===== 备份操作 =====

async function handleCreateBackup(page) {
  const result = await api.createBackup()
  toast(t('pages.services.backup_created', { name: result.name }), 'success')
  await loadBackups(page)
}

async function handleRestoreBackup(name, page) {
  const yes = await showConfirm(t('pages.services.backup_restore_confirm', { name }))
  if (!yes) return
  await api.restoreBackup(name)
  toast(t('pages.services.backup_restored'), 'success')
  await loadBackups(page)
}

async function handleDeleteBackup(name, page) {
  const yes = await showConfirm(t('pages.services.backup_delete_confirm', { name }))
  if (!yes) return
  await api.deleteBackup(name)
  toast(t('pages.services.backup_deleted'), 'success')
  await loadBackups(page)
}

// ===== 配置文件编辑器 =====

let _configOriginal = ''

async function loadConfigEditor(page) {
  const section = page.querySelector('#config-editor-section')
  const area = page.querySelector('#config-editor-area')
  const status = page.querySelector('#config-editor-status')
  const btnSave = page.querySelector('[data-action="save-config"]')
  const btnSaveOnly = page.querySelector('[data-action="save-config-only"]')

  try {
    const config = await api.readOpenclawConfig()
    const json = JSON.stringify(config, null, 2)
    _configOriginal = json
    area.value = json
    area.disabled = false
    btnSave.disabled = false
    btnSaveOnly.disabled = false
    section.style.display = ''
    status.innerHTML = `<span style="color:var(--text-tertiary)">${t('pages.services.config_loaded', { size: (json.length / 1024).toFixed(1) })}</span>`

    // 实时检测 JSON 语法
    area.oninput = () => {
      try {
        JSON.parse(area.value)
        const changed = area.value !== _configOriginal
        status.innerHTML = changed
          ? `<span style="color:var(--warning)">${t('pages.services.config_unsaved')}</span>`
          : `<span style="color:var(--text-tertiary)">${t('pages.services.config_no_change')}</span>`
        btnSave.disabled = !changed
        btnSaveOnly.disabled = !changed
      } catch (e) {
        status.innerHTML = `<span style="color:var(--error)">${t('pages.services.config_json_error', { error: e.message.split(' at ')[0] })}</span>`
        btnSave.disabled = true
        btnSaveOnly.disabled = true
      }
    }
  } catch {
    // openclaw.json 不存在，隐藏编辑器
    section.style.display = 'none'
  }
}

async function handleSaveConfig(page, restart) {
  const area = page.querySelector('#config-editor-area')
  const status = page.querySelector('#config-editor-status')

  let config
  try {
    config = JSON.parse(area.value)
  } catch (e) {
    toast(t('pages.services.config_json_invalid'), 'error')
    return
  }

  status.innerHTML = `<span style="color:var(--text-tertiary)">${t('pages.services.auto_backup_in_progress')}</span>`

  try {
    // 保存前自动备份
    await api.createBackup()
  } catch (e) {
    const yes = await showConfirm(t('pages.services.auto_backup_failed_confirm', { error: String(e) }))
    if (!yes) return
  }

  status.innerHTML = `<span style="color:var(--text-tertiary)">${t('pages.services.saving')}</span>`

  try {
    await api.writeOpenclawConfig(config)
    _configOriginal = area.value
    toast(restart ? t('pages.services.config_saved_restarting') : t('pages.services.config_saved'), 'success')
    status.innerHTML = `<span style="color:var(--success)">${t('pages.services.config_saved_label')}</span>`

    page.querySelector('[data-action="save-config"]').disabled = true
    page.querySelector('[data-action="save-config-only"]').disabled = true

    if (restart) {
      try {
        await api.restartGateway()
        toast(t('pages.services.gateway_restarted'), 'success')
      } catch (e) {
        toast(t('pages.services.config_saved_restart_failed', { error: String(e) }), 'warning')
      }
      await loadServices(page)
    }

    await loadBackups(page)
  } catch (e) {
    toast(t('pages.services.config_save_failed', { error: String(e) }), 'error')
    status.innerHTML = `<span style="color:var(--error)">${t('pages.services.config_save_failed', { error: String(e) })}</span>`
  }
}

// ===== 升级操作 =====

async function doUpgradeWithModal(source, page, version = null) {
  const modal = showUpgradeModal(t('pages.services.upgrade_title'))
  let unlistenLog, unlistenProgress, unlistenDone, unlistenError
  setUpgrading(true)

  // 清理所有监听
  const cleanup = () => {
    setUpgrading(false)
    unlistenLog?.()
    unlistenProgress?.()
    unlistenDone?.()
    unlistenError?.()
  }

  try {
    if (window.__TAURI_INTERNALS__) {
      const { listen } = await import('@tauri-apps/api/event')
      unlistenLog = await listen('upgrade-log', (e) => modal.appendLog(e.payload))
      unlistenProgress = await listen('upgrade-progress', (e) => modal.setProgress(e.payload))

      // 后台任务完成事件
      unlistenDone = await listen('upgrade-done', (e) => {
        cleanup()
        modal.setDone(typeof e.payload === 'string' ? e.payload : t('pages.services.upgrade_done_default'))
        loadVersion(page)
      })

      // 后台任务失败事件
      unlistenError = await listen('upgrade-error', (e) => {
        cleanup()
        const errStr = String(e.payload || t('pages.services.error_unknown'))
        modal.appendLog(errStr)
        const fullLog = modal.getLogText() + '\n' + errStr
        const diagnosis = diagnoseInstallError(fullLog)
        modal.setError(diagnosis.title)
        if (diagnosis.hint) modal.appendLog('')
        if (diagnosis.hint) modal.appendHtmlLog(`${statusIcon('info', 14)} ${diagnosis.hint}`)
        if (diagnosis.command) modal.appendHtmlLog(`${icon('clipboard', 14)} ${diagnosis.command}`)
        if (window.__openAIDrawerWithError) {
          window.__openAIDrawerWithError({ title: diagnosis.title, error: fullLog, scene: t('pages.services.scene_upgrade'), hint: diagnosis.hint })
        }
      })

      // 发起后台任务（立即返回）
      await api.upgradeOpenclaw(source, version)
      modal.appendLog(t('pages.services.upgrade_bg_started'))
    } else {
      // Web 模式：仍然同步等待（dev-api 后端没有 spawn）
      modal.appendLog(t('pages.services.upgrade_web_hint'))
      const msg = await api.upgradeOpenclaw(source, version)
      modal.setDone(typeof msg === 'string' ? msg : (msg?.message || t('pages.services.upgrade_done_web_default')))
      await loadVersion(page)
      cleanup()
    }
  } catch (e) {
    cleanup()
    const errStr = String(e)
    modal.appendLog(errStr)
    const fullLog = modal.getLogText() + '\n' + errStr
    const diagnosis = diagnoseInstallError(fullLog)
    modal.setError(diagnosis.title)
  }
}

async function handleUpgrade(btn, page) {
  const sourceLabel = detectedSource === 'official' ? t('pages.services.official_edition') : detectedSource === 'chinese' ? t('pages.services.chinese_edition') : t('pages.services.source_current')
  const recommended = lastVersionInfo?.recommended
  const yes = await showConfirm(t('pages.services.upgrade_confirm', { source: sourceLabel, version: recommended ? `（${recommended}）` : '' }))
  if (!yes) return
  await doUpgradeWithModal(detectedSource, page, recommended || null)
}

async function handleSwitchSource(target, page) {
  const targetLabel = target === 'official' ? t('pages.services.official_edition') : t('pages.services.chinese_edition')
  const recommended = target === 'official'
    ? (lastVersionInfo?.source === 'official' ? lastVersionInfo?.recommended : null)
    : (lastVersionInfo?.source === 'chinese' ? lastVersionInfo?.recommended : null)
  const versionHint = recommended ? t('pages.services.switch_source_recommended', { version: recommended }) : t('pages.services.switch_source_auto')
  const yes = await showConfirm(t('pages.services.switch_source_confirm', { target: targetLabel, version: versionHint }))
  if (!yes) return
  await doUpgradeWithModal(target, page, null)
}

// ===== 认领外部 Gateway =====

async function handleClaimGateway(btn, page) {
  btn.classList.add('btn-loading')
  btn.textContent = t('pages.services.btn_processing')
  try {
    await api.claimGateway()
    toast(t('pages.services.gateway_claimed'), 'success')
    // 立刻刷新全局 Gateway 状态
    const { refreshGatewayStatus } = await import('../lib/app-state.js')
    await refreshGatewayStatus()
    await loadServices(page)
  } catch (e) {
    toast(t('pages.services.error_claim_failed', { error: e }), 'error')
    btn.classList.remove('btn-loading')
    btn.textContent = t('pages.services.btn_claim_gateway')
  }
}

// ===== 重置 Guardian 守护 =====

async function handleResetGuardian(btn, page) {
  btn.classList.add('btn-loading')
  btn.textContent = t('pages.services.resetting_guardian')
  try {
    await api.resetGuardian()
    resetAutoRestart()
    toast(t('pages.services.guardian_reset_success'), 'success')
    // 重置后自动尝试启动 Gateway
    try {
      await api.startService('ai.openclaw.gateway')
      const { refreshGatewayStatus } = await import('../lib/app-state.js')
      await refreshGatewayStatus()
    } catch { /* 启动失败由 Guardian 继续管理 */ }
    await loadServices(page)
  } catch (e) {
    toast(t('pages.services.guardian_reset_failed', { error: String(e) }), 'error')
    btn.classList.remove('btn-loading')
    btn.textContent = t('pages.services.btn_reset_guardian')
  }
}

// ===== Gateway 安装/卸载 =====

async function handleInstallGateway(btn, page) {
  btn.classList.add('btn-loading')
  btn.textContent = t('pages.services.installing')
  try {
    await api.installGateway()
    toast(t('pages.services.gateway_installed'), 'success')
    await loadServices(page)
  } catch (e) {
    toast(t('pages.services.install_failed', { error: String(e) }), 'error')
    btn.classList.remove('btn-loading')
    btn.textContent = t('pages.services.btn_install')
  }
}

async function handleUninstallGateway(btn, page) {
  const yes = await showConfirm(t('pages.services.uninstall_confirm'))
  if (!yes) return
  btn.classList.add('btn-loading')
  btn.textContent = t('pages.services.uninstalling')
  try {
    await api.uninstallGateway()
    toast(t('pages.services.gateway_uninstalled'), 'success')
    await loadServices(page)
  } catch (e) {
    toast(t('pages.services.uninstall_failed', { error: String(e) }), 'error')
    btn.classList.remove('btn-loading')
    btn.textContent = t('pages.services.btn_uninstall')
  }
}

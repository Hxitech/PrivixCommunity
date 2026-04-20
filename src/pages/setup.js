/**
 * 初始设置页面 — openclaw 未安装时的引导
 * 自动检测环境 → 版本选择 → 一键安装 → 自动跳转
 */
import { api, invalidate } from '../lib/tauri-api.js'
import { showUpgradeModal } from '../components/modal.js'
import { toast } from '../components/toast.js'
import { setUpgrading, isMacPlatform } from '../lib/app-state.js'
import { diagnoseInstallError } from '../lib/error-diagnosis.js'
import { icon, statusIcon } from '../lib/icons.js'
import { BRAND_DESCRIPTION, BRAND_LOGO_ALT, BRAND_LOGO_SRC, BRAND_NAME, BRAND_SETUP_TAGLINE } from '../lib/brand.js'
import { getProfileHomeRoute } from '../lib/product-profile.js'
import { t } from '../lib/i18n.js'
import { runPostInstall } from '../lib/post-install.js'

const SETUP_DESCRIPTION = BRAND_DESCRIPTION
const PROFILE_HOME_ROUTE = getProfileHomeRoute()
const DEPLOY_SCRIPT_URL = 'https://raw.githubusercontent.com/privix-community/privix/main/deploy.sh'

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div style="max-width:560px;margin:48px auto;text-align:center">
      <div style="margin-bottom:var(--space-lg)">
        <img src="${BRAND_LOGO_SRC}" alt="${BRAND_LOGO_ALT}" style="width:64px;height:64px;border-radius:14px;object-fit:contain">
      </div>
      <h1 style="font-size:var(--font-size-xl);margin-bottom:var(--space-xs)">${t('pages.setup.welcome', { name: BRAND_NAME })}</h1>
      <p style="color:var(--text-tertiary);font-size:12px;letter-spacing:1px;margin-top:-2px;margin-bottom:var(--space-lg)">${BRAND_SETUP_TAGLINE}</p>
      <p style="color:var(--text-secondary);margin-bottom:var(--space-xl);line-height:1.6">
        ${SETUP_DESCRIPTION}
      </p>

      <div id="setup-steps"></div>

      <div style="margin-top:var(--space-lg)">
        <button class="btn btn-secondary btn-sm" id="btn-recheck" style="min-width:120px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="margin-right:4px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          ${t('pages.setup.btn_recheck')}
        </button>
      </div>
    </div>
  `

  page.querySelector('#btn-recheck').addEventListener('click', () => runDetect(page))
  runDetect(page)
  return page
}

async function runDetect(page) {
  const stepsEl = page.querySelector('#setup-steps')
  stepsEl.innerHTML = `
    <div class="stat-card loading-placeholder" style="height:48px"></div>
    <div class="stat-card loading-placeholder" style="height:48px;margin-top:8px"></div>
    <div class="stat-card loading-placeholder" style="height:48px;margin-top:8px"></div>
    <div class="stat-card loading-placeholder" style="height:48px;margin-top:8px"></div>
  `
  // 清除缓存，确保拿到最新检测结果
  invalidate('get_version_info', 'check_node', 'check_git', 'get_services_status', 'check_installation')
  // 并行检测 Node.js、Git、OpenClaw CLI、配置文件
  const [nodeRes, gitRes, clawRes, configRes, versionRes] = await Promise.allSettled([
    api.checkNode(),
    api.checkGit(),
    api.getServicesStatus(),
    api.checkInstallation(),
    api.getVersionInfo(),
  ])

  const node = nodeRes.status === 'fulfilled' ? nodeRes.value : { installed: false }
  const git = gitRes.status === 'fulfilled' ? gitRes.value : { installed: false }
  const cliOk = clawRes.status === 'fulfilled'
    && clawRes.value?.length > 0
    && clawRes.value[0]?.cli_installed !== false
  let config = configRes.status === 'fulfilled' ? configRes.value : { installed: false }
  const version = versionRes.status === 'fulfilled' ? versionRes.value : null

  // CLI 已装但配置缺失 → 自动创建默认配置
  if (cliOk && !config.installed) {
    try {
      const initResult = await api.initOpenclawConfig()
      if (initResult?.created) {
        config = await api.checkInstallation()
      }
    } catch (e) {
      console.warn('[setup] 自动初始化配置失败:', e)
    }
  }

  // Git 已安装时，自动配置 HTTPS 替代 SSH（静默执行）
  if (git.installed) {
    api.configureGitHttps().catch(() => {})
  }

  renderSteps(page, { node, git, cliOk, config, version })
}

function stepIcon(ok) {
  const color = ok ? 'var(--success)' : 'var(--text-tertiary)'
  return `<span style="color:${color};font-weight:700;width:18px;display:inline-flex;align-items:center;justify-content:center">${icon(ok ? 'check' : 'x', 14)}</span>`
}

function renderSteps(page, { node, git, cliOk, config, version }) {
  const stepsEl = page.querySelector('#setup-steps')
  const nodeOk = node.installed
  const gitOk = git?.installed || false
  const allOk = nodeOk && cliOk && config.installed

  let html = ''

  // 第一步：Node.js
  html += `
    <div class="config-section setup-phase" data-phase="1">
      <div class="config-section-title setup-phase-header">
        ${stepIcon(nodeOk)} ${t('pages.setup.step_node')}
      </div>
      ${nodeOk
        ? `<p style="color:var(--success);font-size:var(--font-size-sm)">${t('pages.setup.node_installed', { version: node.version || '' })}</p>
           ${node.meets_minimum === false
             ? `<p style="color:var(--warning);font-size:var(--font-size-xs);margin-top:4px">${t('pages.setup.node_min_version_warning')}</p>`
             : ''}
           ${node.recommended_upgrade
             ? `<p style="font-size:var(--font-size-xs);color:var(--text-tertiary);margin-top:4px;display:inline-flex;align-items:center;gap:4px">${icon('lightbulb', 12)} ${node.recommended_upgrade}</p>`
             : ''}`
        : `<p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-sm)">
            ${t('pages.setup.node_not_installed_desc')}
          </p>
          <a class="btn btn-primary btn-sm" href="https://nodejs.org/" target="_blank" rel="noopener">${t('pages.setup.btn_download_node')}</a>
          <span class="form-hint" style="margin-left:8px">${t('pages.setup.after_install_hint')}</span>
          <div style="margin-top:var(--space-sm);padding:8px 12px;background:var(--bg-tertiary);border-radius:var(--radius-sm);font-size:var(--font-size-xs);color:var(--text-secondary);line-height:1.6">
            <strong>${t('pages.setup.node_detect_hint_title')}</strong>
            ${isMacPlatform()
              ? `${t('pages.setup.node_detect_hint_mac', { name: BRAND_NAME })}<br>
                 <code style="background:var(--bg-secondary);padding:2px 6px;border-radius:3px;user-select:all">open /Applications/${BRAND_NAME}.app</code>`
              : t('pages.setup.node_detect_hint_other')
            }
            <div style="margin-top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <button class="btn btn-secondary btn-sm" id="btn-scan-node" style="font-size:11px;padding:3px 10px">${icon('search', 12)} ${t('pages.setup.btn_auto_scan')}</button>
              <span style="color:var(--text-tertiary)">${t('pages.setup.manual_path_hint')}</span>
            </div>
            <div style="margin-top:6px;display:flex;gap:6px">
              <input id="input-node-path" type="text" placeholder="${isMacPlatform() ? '/usr/local/bin' : 'F:\\\\AI\\\\Node'}"
                style="flex:1;padding:4px 8px;border:1px solid var(--border-primary);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-size:11px;font-family:monospace">
              <button class="btn btn-primary btn-sm" id="btn-check-path" style="font-size:11px;padding:3px 10px">${t('pages.setup.btn_detect')}</button>
            </div>
            <div id="scan-result" style="margin-top:6px;display:none"></div>
          </div>`
      }
    </div>
  `

  // 第二步：Git
  html += `
    <div class="config-section setup-phase${nodeOk ? '' : ' phase-disabled'}" data-phase="2">
      <div class="config-section-title setup-phase-header">
        ${stepIcon(gitOk)} ${t('pages.setup.step_git')}
      </div>
      ${gitOk
        ? `<p style="color:var(--success);font-size:var(--font-size-sm)">${t('pages.setup.git_installed', { version: git.version || '' })}</p>
           <p style="font-size:var(--font-size-xs);color:var(--text-tertiary);margin-top:4px">${t('pages.setup.git_https_configured')}</p>`
        : `<p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-sm);line-height:1.5">
            ${t('pages.setup.git_not_installed_desc')}
          </p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" id="btn-auto-install-git">${t('pages.setup.btn_auto_install_git')}</button>
            <a class="btn btn-secondary btn-sm" href="https://git-scm.com/downloads" target="_blank" rel="noopener">${t('pages.setup.btn_manual_download')}</a>
          </div>
          <div id="git-install-result" style="margin-top:var(--space-sm);display:none"></div>
          <div style="margin-top:8px;font-size:var(--font-size-xs);color:var(--text-tertiary);line-height:1.5">
            <strong>${t('pages.setup.git_optional_hint_title')}</strong> ${t('pages.setup.git_optional_hint_desc')}
          </div>`
      }
    </div>
  `

  // 第三步：OpenClaw CLI
  // standalone 安装自带 Node.js 运行时，即使系统无 Node.js 也可安装
  const canInstallStandalone = !nodeOk && !!window.__TAURI_INTERNALS__
  html += `
    <div class="config-section setup-phase${(nodeOk || canInstallStandalone) ? '' : ' phase-disabled'}" data-phase="3">
      <div class="config-section-title setup-phase-header">
        ${stepIcon(cliOk)} ${t('pages.setup.step_cli')}
      </div>
      ${cliOk
        ? `<p style="color:var(--success);font-size:var(--font-size-sm)">${t('pages.setup.cli_available')}</p>
           ${version?.ahead_of_recommended && version?.recommended
             ? `<div style="margin-top:8px;padding:8px 12px;background:var(--bg-tertiary);border-radius:var(--radius-sm);font-size:var(--font-size-xs);color:var(--warning,#f59e0b);line-height:1.6">
                  ${t('pages.setup.cli_version_ahead_warning', { current: version.current || '', recommended: version.recommended })}
                </div>`
             : ''}`
        : canInstallStandalone
          ? renderStandaloneOnlySection()
          : renderInstallSection()
      }
    </div>
  `
  // 第四步：配置文件
  html += `
    <div class="config-section setup-phase${cliOk ? '' : ' phase-disabled'}" data-phase="4">
      <div class="config-section-title setup-phase-header">
        ${stepIcon(config.installed)} ${t('pages.setup.step_config')}
      </div>
      ${config.installed
        ? `<p style="color:var(--success);font-size:var(--font-size-sm)">${t('pages.setup.config_located', { path: config.path || '' })}</p>`
        : `<p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-sm)">
            ${t('pages.setup.config_not_exist_desc')}
          </p>
          <button class="btn btn-primary btn-sm" id="btn-init-config">${t('pages.setup.btn_init_config')}</button>`
      }
    </div>
  `

  // AI 助手入口
  html += `
    <div class="config-section" style="text-align:left;margin-top:var(--space-md)">
      <div class="config-section-title" style="display:flex;align-items:center;gap:6px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>
        ${t('pages.setup.section_assistant')}
      </div>
      <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-sm);line-height:1.5">
        ${t('pages.setup.assistant_desc', { suffix: !allOk ? t('pages.setup.assistant_desc_suffix_error') : '' })}
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" id="btn-goto-assistant">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="margin-right:4px"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>
          ${t('pages.setup.btn_open_assistant')}
        </button>
        ${!allOk ? `<button class="btn btn-primary btn-sm" id="btn-ask-ai-help">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="margin-right:4px"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          ${t('pages.setup.btn_ask_ai')}
        </button>` : ''}
      </div>
    </div>
  `

  // 全部就绪 → 进入面板
  if (allOk) {
    html += `
      <div class="config-section" style="text-align:left;margin-top:var(--space-md)">
        <div class="config-section-title">${t('pages.setup.section_next_step')}</div>
        <div style="color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.7">
          ${t('pages.setup.next_step_desc')}
          <div style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px">
            ${[
              t('pages.setup.guide_step_1'),
              t('pages.setup.guide_step_2'),
              t('pages.setup.guide_step_3'),
              t('pages.setup.guide_step_4'),
              t('pages.setup.guide_step_5'),
            ].map(item => `
              <div style="padding:10px;border-radius:10px;background:var(--bg-tertiary);border:1px solid var(--border-primary);font-size:11px;color:var(--text-secondary);line-height:1.5">${item}</div>
            `).join('')}
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="btn btn-primary btn-sm" id="btn-open-openclaw-guide">${t('pages.setup.btn_open_guide')}</button>
          <button class="btn btn-secondary btn-sm" id="btn-goto-models">${t('pages.setup.btn_config_models')}</button>
          <button class="btn btn-secondary btn-sm" id="btn-goto-agents">${t('pages.setup.btn_create_agent')}</button>
          <button class="btn btn-secondary btn-sm" id="btn-goto-chat">${t('pages.setup.btn_goto_chat')}</button>
          <button class="btn btn-secondary btn-sm" id="btn-goto-gateway">${t('pages.setup.btn_gateway_settings')}</button>
          <button class="btn btn-secondary btn-sm" id="btn-goto-channels">${t('pages.setup.btn_channels')}</button>
        </div>
      </div>
      <div style="margin-top:var(--space-lg)">
        <button class="btn btn-primary" id="btn-enter" style="min-width:200px">${t('pages.setup.btn_enter_panel')}</button>
      </div>
    `
  }

  stepsEl.innerHTML = html
  bindEvents(page, nodeOk, { node, git, cliOk, config })
}

function renderInstallSection() {
  const isWin = navigator.platform?.startsWith('Win') || navigator.userAgent?.includes('Windows')
  const isMac = navigator.platform?.startsWith('Mac') || navigator.userAgent?.includes('Macintosh')
  const isDesktop = !!window.__TAURI_INTERNALS__

  let envHint = ''
  const customDirSection = isDesktop ? `
    <details id="custom-dir-details" style="margin-bottom:var(--space-sm);text-align:left">
      <summary style="cursor:pointer;font-size:var(--font-size-xs);color:var(--text-tertiary)">${t('pages.setup.custom_dir_title')}</summary>
      <div style="margin-top:8px;padding:10px 12px;background:var(--bg-tertiary);border-radius:var(--radius-sm)">
        <div style="font-size:var(--font-size-xs);color:var(--text-secondary);line-height:1.6;margin-bottom:8px">
          ${t('pages.setup.custom_dir_desc')}
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="input-openclaw-dir" type="text" placeholder="/data/openclaw" style="flex:1;min-width:220px;padding:6px 8px;border:1px solid var(--border-primary);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-size:12px;font-family:var(--font-mono)">
          <button class="btn btn-primary btn-sm" id="btn-save-openclaw-dir">${t('pages.setup.btn_save_path')}</button>
          <button class="btn btn-secondary btn-sm" id="btn-reset-openclaw-dir">${t('pages.setup.btn_reset_default')}</button>
        </div>
        <div id="openclaw-dir-result" style="margin-top:8px;display:none;font-size:var(--font-size-xs)"></div>
      </div>
    </details>
  ` : ''
  if (isDesktop) {
    envHint = `
      <div style="margin-top:var(--space-sm);padding:10px 12px;background:var(--bg-tertiary);border-radius:var(--radius-sm);border-left:3px solid var(--warning);font-size:var(--font-size-xs);color:var(--text-secondary);line-height:1.7">
        <strong style="color:var(--text-primary)">${t('pages.setup.env_hint_title')}</strong>
        <p style="margin:6px 0 2px">${t('pages.setup.env_hint_desc', { name: BRAND_NAME })}</p>
        <ul style="margin:4px 0 8px 16px;padding:0">
          ${isWin ? `
            <li>${t('pages.setup.env_hint_wsl')}</li>
            <li>${t('pages.setup.env_hint_docker')}</li>
          ` : ''}
          ${isMac ? `
            <li>${t('pages.setup.env_hint_docker')}</li>
            <li>${t('pages.setup.env_hint_remote')}</li>
          ` : ''}
          ${!isWin && !isMac ? `
            <li>${t('pages.setup.env_hint_docker')}</li>
          ` : ''}
        </ul>
        <details style="cursor:pointer">
          <summary style="font-weight:600;color:var(--primary);margin-bottom:6px">
            ${t('pages.setup.env_hint_install_guide')}
          </summary>
          <div style="margin-top:8px">
            ${isWin ? `
              <div style="margin-bottom:10px">
                <div style="font-weight:600;margin-bottom:4px">${t('pages.setup.env_hint_wsl_title')}</div>
                <div style="margin-bottom:2px;opacity:0.8">${t('pages.setup.env_hint_wsl_desc', { name: BRAND_NAME })}</div>
                <code style="display:block;background:var(--bg-secondary);padding:6px 10px;border-radius:4px;user-select:all;word-break:break-all">curl -fsSL ${DEPLOY_SCRIPT_URL} | bash</code>
                <div style="margin-top:4px;opacity:0.7">${t('pages.setup.env_hint_wsl_after')}</div>
              </div>
            ` : ''}
            <div style="margin-bottom:10px">
              <div style="font-weight:600;margin-bottom:4px">${t('pages.setup.env_hint_docker_title')}</div>
              <div style="margin-bottom:2px;opacity:0.8">${t('pages.setup.env_hint_docker_desc', { name: BRAND_NAME })}</div>
              <code style="display:block;background:var(--bg-secondary);padding:6px 10px;border-radius:4px;user-select:all;word-break:break-all;margin-bottom:4px">npm i -g @qingchencloud/openclaw-zh</code>
              <code style="display:block;background:var(--bg-secondary);padding:6px 10px;border-radius:4px;user-select:all;word-break:break-all">curl -fsSL ${DEPLOY_SCRIPT_URL} | bash</code>
            </div>
            <div>
              <div style="font-weight:600;margin-bottom:4px">${t('pages.setup.env_hint_remote_title')}</div>
              <div style="margin-bottom:2px;opacity:0.8">${t('pages.setup.env_hint_remote_desc')}</div>
              <code style="display:block;background:var(--bg-secondary);padding:6px 10px;border-radius:4px;user-select:all;word-break:break-all">curl -fsSL ${DEPLOY_SCRIPT_URL} | bash</code>
            </div>
          </div>
        </details>
        <div style="margin-top:6px;opacity:0.7">
          ${t('pages.setup.env_hint_local_fallback')}
        </div>
      </div>`
  }

  return `
    <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-sm)">
      ${t('pages.setup.install_desc', { name: BRAND_NAME })}
    </p>
    <p style="color:var(--text-tertiary);font-size:var(--font-size-xs);line-height:1.6;margin:-4px 0 var(--space-sm)">
      ${t('pages.setup.install_tip')}
    </p>
    <div style="display:flex;gap:var(--space-sm);margin-bottom:var(--space-sm)">
      <label class="setup-source-option" style="flex:1;cursor:pointer">
        <input type="radio" name="install-source" value="chinese" checked style="margin-right:6px">
        <div>
          <div style="font-weight:600;font-size:var(--font-size-sm)">${t('pages.setup.source_chinese_optimized')}</div>
          <div style="font-size:var(--font-size-xs);color:var(--text-tertiary)">@qingchencloud/openclaw-zh</div>
        </div>
      </label>
      <label class="setup-source-option" style="flex:1;cursor:pointer">
        <input type="radio" name="install-source" value="official" style="margin-right:6px">
        <div>
          <div style="font-weight:600;font-size:var(--font-size-sm)">${t('pages.setup.source_official_original')}</div>
          <div style="font-size:var(--font-size-xs);color:var(--text-tertiary)">openclaw</div>
        </div>
      </label>
    </div>
    <div style="margin-bottom:var(--space-sm)" id="install-method-section">
      <label style="font-size:var(--font-size-xs);color:var(--text-tertiary);display:block;margin-bottom:4px">${t('pages.setup.install_method_label')}</label>
      <select id="install-method" style="width:100%;padding:6px 8px;border-radius:var(--radius-sm);border:1px solid var(--border-primary);background:var(--bg-secondary);color:var(--text-primary);font-size:var(--font-size-sm)">
        <option value="auto">${t('pages.setup.method_auto')}</option>
        <option value="standalone-r2">${t('pages.setup.method_standalone_r2')}</option>
        <option value="standalone-github">${t('pages.setup.method_standalone_github')}</option>
        <option value="npm">${t('pages.setup.method_npm')}</option>
      </select>
      <div id="method-hint" style="font-size:var(--font-size-xs);color:var(--text-tertiary);margin-top:4px;line-height:1.5"></div>
    </div>
    <div style="margin-bottom:var(--space-sm)" id="registry-section">
      <label style="font-size:var(--font-size-xs);color:var(--text-tertiary);display:block;margin-bottom:4px">${t('pages.setup.npm_registry_label')}</label>
      <select id="registry-select" style="width:100%;padding:6px 8px;border-radius:var(--radius-sm);border:1px solid var(--border-primary);background:var(--bg-secondary);color:var(--text-primary);font-size:var(--font-size-sm)">
        <option value="https://registry.npmmirror.com">${t('pages.setup.registry_taobao')}</option>
        <option value="https://registry.npmjs.org">${t('pages.setup.registry_npm')}</option>
        <option value="https://repo.huaweicloud.com/repository/npm/">${t('pages.setup.registry_huawei')}</option>
      </select>
    </div>
    ${customDirSection}
    <button class="btn btn-primary btn-sm" id="btn-install">${t('pages.setup.btn_one_click_install')}</button>
    ${envHint}
  `
}

function postInstallMsgs() {
  return {
    gatewayMsg: t('pages.setup.installing_gateway'),
    gatewayOk: `${statusIcon('ok', 14)} ${t('pages.setup.gateway_installed')}`,
    gatewayFail: `${statusIcon('warn', 14)} ${t('pages.setup.gateway_install_failed', { error: '{error}' })}`,
  }
}

/**
 * Node.js 未安装时的简化安装区域 — 仅提供 standalone 安装（自带 Node.js 运行时）
 */
function renderStandaloneOnlySection() {
  return `
    <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-sm);line-height:1.6">
      ${t('pages.setup.standalone_only_desc')}
    </p>
    <div style="padding:10px 12px;background:var(--bg-tertiary);border-radius:var(--radius-sm);font-size:var(--font-size-xs);color:var(--text-tertiary);line-height:1.6;margin-bottom:var(--space-sm)">
      ${t('pages.setup.standalone_only_hint')}
    </div>
    <button class="btn btn-primary btn-sm" id="btn-install-standalone">${t('pages.setup.btn_one_click_install_standalone')}</button>
  `
}

function buildSetupProblemPrompt({ node, git, cliOk, config }) {
  const problems = []
  if (!node.installed) problems.push('- Node.js 未安装或未检测到')
  else problems.push(`- Node.js 已安装: ${node.version || '版本未知'}`)
  if (!git?.installed) problems.push('- Git 未安装')
  else problems.push(`- Git 已安装: ${git.version || '版本未知'}`)
  if (!cliOk) problems.push('- OpenClaw CLI 未安装')
  else problems.push('- OpenClaw CLI 已安装')
  if (!config.installed) problems.push('- 配置文件不存在')
  else problems.push(`- 配置文件正常: ${config.path || ''}`)

  return `我在安装 OpenClaw 时遇到问题，以下是当前检测状态：

${problems.join('\n')}

请帮我分析问题并给出解决步骤。如果需要，请使用工具帮我检查系统环境。`
}

function bindEvents(page, nodeOk, detectState) {
  page.querySelectorAll('.setup-phase-header').forEach(header => {
    header.addEventListener('click', () => {
      const phase = header.closest('.setup-phase')
      if (!phase || phase.classList.contains('phase-disabled')) return
      const children = Array.from(phase.children).filter(el => !el.classList.contains('setup-phase-header') && !el.classList.contains('config-section-title'))
      const isCollapsed = phase.classList.toggle('phase-collapsed')
      children.forEach(el => { el.style.display = isCollapsed ? 'none' : '' })
    })
  })

  // 打开 AI 助手
  page.querySelector('#btn-goto-assistant')?.addEventListener('click', () => {
    window.location.hash = '/assistant'
  })

  // 让 AI 帮我解决（带问题上下文）
  page.querySelector('#btn-ask-ai-help')?.addEventListener('click', () => {
    if (detectState) {
      const prompt = buildSetupProblemPrompt(detectState)
      sessionStorage.setItem('assistant-auto-prompt', prompt)
    }
    window.location.hash = '/assistant'
  })

  // 进入面板
  page.querySelector('#btn-enter')?.addEventListener('click', () => {
    window.location.hash = PROFILE_HOME_ROUTE
  })
  page.querySelector('#btn-goto-models')?.addEventListener('click', () => {
    window.location.hash = '/models'
  })
  page.querySelector('#btn-goto-agents')?.addEventListener('click', () => {
    window.location.hash = '/agents'
  })
  page.querySelector('#btn-goto-chat')?.addEventListener('click', () => {
    window.location.hash = '/chat'
  })
  page.querySelector('#btn-goto-gateway')?.addEventListener('click', () => {
    window.location.hash = '/gateway'
  })
  page.querySelector('#btn-goto-channels')?.addEventListener('click', () => {
    window.location.hash = '/channels'
  })

  // 一键安装 Git
  page.querySelector('#btn-auto-install-git')?.addEventListener('click', async () => {
    const btn = page.querySelector('#btn-auto-install-git')
    const resultEl = page.querySelector('#git-install-result')
    btn.disabled = true
    btn.textContent = t('pages.setup.installing_git')
    if (resultEl) {
      resultEl.style.display = 'block'
      resultEl.innerHTML = `<span style="color:var(--text-tertiary)">${t('pages.setup.git_installing_wait')}</span>`
    }
    try {
      const msg = await api.autoInstallGit()
      if (resultEl) resultEl.innerHTML = `<span style="color:var(--success);display:inline-flex;align-items:center;gap:4px">${icon('check', 14)} ${msg}</span>`
      toast(t('pages.setup.toast_git_install_success'), 'success')
      // 安装成功后自动配置 HTTPS
      api.configureGitHttps().catch(() => {})
      setTimeout(() => runDetect(page), 1000)
    } catch (e) {
      const errMsg = String(e.message || e)
      if (resultEl) {
        resultEl.innerHTML = `<div>
          <span style="color:var(--danger)">${t('pages.setup.git_install_failed_auto', { error: errMsg })}</span>
          <p style="margin-top:6px;font-size:var(--font-size-xs);color:var(--text-secondary);line-height:1.5">
            ${t('pages.setup.git_install_manual_hint_win')}<br>
            <strong>Windows:</strong> 下载 <a href="https://git-scm.com/downloads" target="_blank" style="color:var(--accent)">git-scm.com</a> 安装包<br>
            <strong>macOS:</strong> 在终端执行 <code style="background:var(--bg-secondary);padding:2px 4px;border-radius:3px">xcode-select --install</code> 或 <code style="background:var(--bg-secondary);padding:2px 4px;border-radius:3px">brew install git</code><br>
            <strong>Linux:</strong> <code style="background:var(--bg-secondary);padding:2px 4px;border-radius:3px">sudo apt install git</code> 或 <code style="background:var(--bg-secondary);padding:2px 4px;border-radius:3px">sudo yum install git</code>
          </p>
        </div>`
      }
      toast(t('pages.setup.toast_git_install_failed'), 'warning')
    } finally {
      btn.disabled = false
      btn.textContent = t('pages.setup.btn_auto_install_git')
    }
  })

  // 一键初始化配置
  page.querySelector('#btn-init-config')?.addEventListener('click', async () => {
    const btn = page.querySelector('#btn-init-config')
    btn.disabled = true
    btn.textContent = t('pages.setup.initializing')
    try {
      const result = await api.initOpenclawConfig()
      if (result?.created) {
        toast(t('pages.setup.toast_config_created'), 'success')
      } else {
        toast(result?.message || t('pages.setup.toast_config_exists'), 'info')
      }
      setTimeout(() => runDetect(page), 500)
    } catch (e) {
      toast(t('pages.setup.toast_init_failed', { error: String(e) }), 'error')
      btn.disabled = false
      btn.textContent = t('pages.setup.btn_init_config')
    }
  })

  // 自动扫描 Node.js
  page.querySelector('#btn-scan-node')?.addEventListener('click', async () => {
    const btn = page.querySelector('#btn-scan-node')
    const resultEl = page.querySelector('#scan-result')
    btn.disabled = true
    btn.textContent = t('pages.setup.scanning')
    resultEl.style.display = 'block'
    resultEl.innerHTML = `<span style="color:var(--text-tertiary)">${t('pages.setup.scanning_paths')}</span>`
    try {
      const results = await api.scanNodePaths()
      if (results.length === 0) {
        resultEl.innerHTML = `<span style="color:var(--warning)">${t('pages.setup.node_not_found_scan')}</span>`
      } else {
        resultEl.innerHTML = results.map(r =>
          `<div style="display:flex;align-items:center;gap:6px;margin-top:4px">
            <span style="color:var(--success);display:inline-flex;align-items:center">${icon('check', 14)}</span>
            <code style="flex:1;background:var(--bg-secondary);padding:2px 6px;border-radius:3px;font-size:11px">${r.path}</code>
            <span style="font-size:11px;color:var(--text-tertiary)">${r.version}</span>
            <button class="btn btn-primary btn-sm btn-use-path" data-path="${r.path}" style="font-size:10px;padding:2px 8px">${t('pages.setup.btn_use')}</button>
          </div>`
        ).join('')
        resultEl.querySelectorAll('.btn-use-path').forEach(b => {
          b.addEventListener('click', async () => {
            await api.saveCustomNodePath(b.dataset.path)
            toast(t('pages.setup.toast_node_path_saved'), 'success')
            setTimeout(() => runDetect(page), 300)
          })
        })
      }
    } catch (e) {
      resultEl.innerHTML = `<span style="color:var(--danger)">扫描失败: ${e}</span>`
    } finally {
      btn.disabled = false
      btn.innerHTML = `${icon('search', 12)} ${t('pages.setup.btn_auto_scan')}`
    }
  })

  // 手动指定路径检测
  page.querySelector('#btn-check-path')?.addEventListener('click', async () => {
    const input = page.querySelector('#input-node-path')
    const resultEl = page.querySelector('#scan-result')
    const dir = input?.value?.trim()
    if (!dir) { toast(t('pages.setup.enter_node_dir_hint'), 'warning'); return }
    resultEl.style.display = 'block'
    resultEl.innerHTML = `<span style="color:var(--text-tertiary)">${t('pages.setup.detecting')}</span>`
    try {
      const result = await api.checkNodeAtPath(dir)
      if (result.installed) {
        await api.saveCustomNodePath(dir)
        resultEl.innerHTML = `<span style="color:var(--success)">${t('pages.setup.node_found_saved', { version: result.version })}</span>`
        toast(t('pages.setup.toast_node_path_saved'), 'success')
        setTimeout(() => runDetect(page), 300)
      } else {
        resultEl.innerHTML = `<span style="color:var(--warning)">${t('pages.setup.node_not_found_at_path')}</span>`
      }
    } catch (e) {
      resultEl.innerHTML = `<span style="color:var(--danger)">检测失败: ${e}</span>`
    }
  })

  const dirInput = page.querySelector('#input-openclaw-dir')
  const dirResultEl = page.querySelector('#openclaw-dir-result')
  if (dirInput) {
    api.getOpenclawDir().then(info => {
      if (info?.isCustom) {
        dirInput.value = info.path || info.custom || ''
        const details = page.querySelector('#custom-dir-details')
        if (details) details.open = true
      }
    }).catch(() => {})
  }

  page.querySelector('#btn-save-openclaw-dir')?.addEventListener('click', async () => {
    const value = dirInput?.value?.trim()
    if (!value) { toast(t('pages.setup.enter_path_hint'), 'warning'); return }
    const btn = page.querySelector('#btn-save-openclaw-dir')
    btn.disabled = true
    if (dirResultEl) {
      dirResultEl.style.display = 'block'
      dirResultEl.innerHTML = `<span style="color:var(--text-tertiary)">${t('pages.setup.saving')}</span>`
    }
    try {
      const cfg = await api.readPanelConfig()
      cfg.openclawDir = value
      await api.writePanelConfig(cfg)
      invalidate('check_installation', 'get_services_status', 'read_openclaw_config')
      if (dirResultEl) dirResultEl.innerHTML = `<span style="color:var(--success)">${t('pages.setup.path_saved_redetect')}</span>`
      toast(t('pages.setup.toast_custom_path_saved'), 'success')
      setTimeout(() => runDetect(page), 500)
    } catch (e) {
      if (dirResultEl) dirResultEl.innerHTML = `<span style="color:var(--error)">${t('pages.setup.toast_save_failed', { error: String(e) })}</span>`
      toast(t('pages.setup.toast_save_failed', { error: String(e) }), 'error')
    } finally {
      btn.disabled = false
    }
  })

  page.querySelector('#btn-reset-openclaw-dir')?.addEventListener('click', async () => {
    const btn = page.querySelector('#btn-reset-openclaw-dir')
    btn.disabled = true
    try {
      const cfg = await api.readPanelConfig()
      delete cfg.openclawDir
      await api.writePanelConfig(cfg)
      invalidate('check_installation', 'get_services_status', 'read_openclaw_config')
      if (dirInput) dirInput.value = ''
      if (dirResultEl) {
        dirResultEl.style.display = 'block'
        dirResultEl.innerHTML = `<span style="color:var(--success)">${t('pages.setup.default_restored_redetect')}</span>`
      }
      toast(t('pages.setup.toast_default_restored'), 'success')
      setTimeout(() => runDetect(page), 500)
    } catch (e) {
      toast(t('pages.setup.toast_restore_failed', { error: String(e) }), 'error')
    } finally {
      btn.disabled = false
    }
  })

  const methodSection = page.querySelector('#install-method-section')
  const registrySection = page.querySelector('#registry-section')
  const methodSelect = page.querySelector('#install-method')
  const methodHint = page.querySelector('#method-hint')
  const sourceRadios = page.querySelectorAll('input[name="install-source"]')

  // 安装方式提示（在函数内部调用 t()）
  function getMethodHints() {
    return {
      auto: t('pages.setup.method_hint_auto'),
      'standalone-r2': t('pages.setup.method_hint_standalone_r2'),
      'standalone-github': t('pages.setup.method_hint_standalone_github'),
      npm: t('pages.setup.method_hint_npm'),
    }
  }

  function updateMethodVisibility() {
    const source = page.querySelector('input[name="install-source"]:checked')?.value || 'chinese'
    if (source === 'official') {
      if (methodSection) methodSection.style.display = 'none'
      if (registrySection) registrySection.style.display = ''
    } else {
      if (methodSection) methodSection.style.display = ''
      const method = methodSelect?.value || 'auto'
      if (registrySection) registrySection.style.display = method === 'npm' ? '' : 'none'
    }
    if (methodHint && methodSelect) methodHint.textContent = getMethodHints()[methodSelect.value] || ''
  }

  sourceRadios.forEach(r => r.addEventListener('change', updateMethodVisibility))
  methodSelect?.addEventListener('change', updateMethodVisibility)
  updateMethodVisibility()

  // standalone 快捷安装（Node.js 未安装时）
  page.querySelector('#btn-install-standalone')?.addEventListener('click', async () => {
    const modal = showUpgradeModal(t('pages.setup.install_openclaw_title'))
    let unlistenLog, unlistenProgress, unlistenDone, unlistenError
    setUpgrading(true)

    const cleanup = () => {
      setUpgrading(false)
      unlistenLog?.(); unlistenProgress?.(); unlistenDone?.(); unlistenError?.()
    }

    try {
      const { listen } = await import('@tauri-apps/api/event')
      unlistenLog = await listen('upgrade-log', (e) => modal.appendLog(e.payload))
      unlistenProgress = await listen('upgrade-progress', (e) => modal.setProgress(e.payload))

      unlistenDone = await listen('upgrade-done', async (e) => {
        cleanup()
        modal.setDone(typeof e.payload === 'string' ? e.payload : t('pages.setup.install_complete'))
        await runPostInstall(modal, postInstallMsgs())
        toast(t('pages.setup.toast_openclaw_install_success'), 'success')
        setTimeout(() => window.location.reload(), 1500)
      })

      unlistenError = await listen('upgrade-error', async (e) => {
        cleanup()
        const errStr = String(e.payload || t('pages.setup.unknown_error'))
        modal.appendLog(errStr)
        const fullLog = modal.getLogText() + '\n' + errStr
        const diagnosis = diagnoseInstallError(fullLog)
        modal.setError(diagnosis.title, { helpContext: diagnosis.helpContext, logText: fullLog })
        if (diagnosis.hint) modal.appendLog('')
        if (diagnosis.hint) modal.appendHtmlLog(`${statusIcon('info', 14)} ${diagnosis.hint}`)
        if (diagnosis.command) modal.appendHtmlLog(`${icon('clipboard', 14)} ${diagnosis.command}`)
        if (window.__openAIDrawerWithError) {
          window.__openAIDrawerWithError({ title: diagnosis.title, error: fullLog, scene: t('pages.setup.initial_install_scene'), hint: diagnosis.hint })
        }
      })

      // standalone 安装：汉化版 + auto（优先 standalone）
      await api.upgradeOpenclaw('chinese', null, 'auto')
      modal.appendLog(t('pages.setup.backend_install_started'))
    } catch (e) {
      cleanup()
      const errStr = String(e)
      modal.appendLog(errStr)
      const fullLog = modal.getLogText() + '\n' + errStr
      const diagnosis = diagnoseInstallError(fullLog)
      modal.setError(diagnosis.title, { helpContext: diagnosis.helpContext, logText: fullLog })
    }
  })

  // 一键安装（完整版，Node.js 已安装时）
  const installBtn = page.querySelector('#btn-install')
  if (!installBtn || !nodeOk) return

  installBtn.addEventListener('click', async () => {
    const source = page.querySelector('input[name="install-source"]:checked')?.value || 'chinese'
    const method = source === 'official' ? 'npm' : (page.querySelector('#install-method')?.value || 'auto')
    const registry = page.querySelector('#registry-select')?.value
    const modal = showUpgradeModal(t('pages.setup.install_openclaw_title'))
    let unlistenLog, unlistenProgress

    setUpgrading(true)

    const cleanup = () => {
      setUpgrading(false)
      unlistenLog?.()
      unlistenProgress?.()
      unlistenDone?.()
      unlistenError?.()
    }

    let unlistenDone, unlistenError

    try {
      if (window.__TAURI_INTERNALS__) {
        const { listen } = await import('@tauri-apps/api/event')
        unlistenLog = await listen('upgrade-log', (e) => modal.appendLog(e.payload))
        unlistenProgress = await listen('upgrade-progress', (e) => modal.setProgress(e.payload))

        unlistenDone = await listen('upgrade-done', async (e) => {
          cleanup()
          modal.setDone(typeof e.payload === 'string' ? e.payload : t('pages.setup.install_complete'))
          await runPostInstall(modal, postInstallMsgs())
          toast(t('pages.setup.toast_openclaw_install_success'), 'success')
          setTimeout(() => window.location.reload(), 1500)
        })

        unlistenError = await listen('upgrade-error', async (e) => {
          cleanup()
          const errStr = String(e.payload || t('pages.setup.unknown_error'))
          modal.appendLog(errStr)
          const fullLog = modal.getLogText() + '\n' + errStr
          const diagnosis = diagnoseInstallError(fullLog)
          modal.setError(diagnosis.title, { helpContext: diagnosis.helpContext, logText: fullLog })
          if (diagnosis.hint) modal.appendLog('')
          if (diagnosis.hint) modal.appendHtmlLog(`${statusIcon('info', 14)} ${diagnosis.hint}`)
          if (diagnosis.command) modal.appendHtmlLog(`${icon('clipboard', 14)} ${diagnosis.command}`)
          if (window.__openAIDrawerWithError) {
            window.__openAIDrawerWithError({ title: diagnosis.title, error: fullLog, scene: t('pages.setup.initial_install_scene'), hint: diagnosis.hint })
          }
        })

        // 先设置镜像源
        if (registry) {
          modal.appendLog(t('pages.setup.setting_registry', { registry }))
          try { await api.setNpmRegistry(registry) } catch (e) { console.warn('[setup] setNpmRegistry:', e) }
        }

        // 发起后台任务（立即返回）
        await api.upgradeOpenclaw(source, null, method)
        modal.appendLog(t('pages.setup.backend_install_started'))
      } else {
        // Web 模式：同步等待
        modal.appendLog(t('pages.setup.web_mode_log_unavailable'))
        if (registry) {
          modal.appendLog(t('pages.setup.setting_registry', { registry }))
          try { await api.setNpmRegistry(registry) } catch (e) { console.warn('[setup] setNpmRegistry:', e) }
        }
        const msg = await api.upgradeOpenclaw(source, null, method)
        modal.setDone(msg)
        toast(t('pages.setup.toast_openclaw_install_success'), 'success')
        setTimeout(() => window.location.reload(), 1500)
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
  })
}

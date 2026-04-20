/**
 * Skills 页面
 * 本地扫描已安装 Skills + SkillHub SDK 技能商店
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { t } from '../lib/i18n.js'
import { wsClient } from '../lib/ws-client.js'
import { icon } from '../lib/icons.js'

let _loadSeq = 0
let _selectedAgentId = null // null = default (main)

function esc(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  // 加载 Agent 列表
  let agents = []
  try {
    const list = await api.listAgents()
    if (Array.isArray(list)) agents = list
  } catch {}

  const agentOptions = agents.length > 1
    ? `<div class="skills-agent-selector" style="display:flex;align-items:center;gap:var(--space-xs);margin-bottom:var(--space-sm)">
        <label style="font-size:var(--font-size-sm);color:var(--text-secondary);white-space:nowrap">${t('pages.skills.agent_label')}</label>
        <select id="skills-agent-select" class="input" style="max-width:220px;font-size:var(--font-size-sm);padding:4px 8px">
          ${agents.map(a => {
            const id = a.id || 'main'
            const name = a.name || a.id || 'main'
            const isDefault = a.default ? ` (${t('pages.skills.all_agents').split('(')[0].trim()})` : ''
            return `<option value="${esc(id)}"${id === (_selectedAgentId || 'main') ? ' selected' : ''}>${esc(name)}${isDefault}</option>`
          }).join('')}
        </select>
      </div>`
    : ''

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title apple-section">${t('pages.skills.title')}</h1>
      <p class="page-desc apple-body-secondary">${t('pages.skills.desc')}</p>
    </div>
    ${agentOptions}
    <div class="tab-bar" id="skills-main-tabs">
      <div class="tab active" data-main-tab="installed">${t('pages.skills.tab_installed')}</div>
      <div class="tab" data-main-tab="store">${t('pages.skills.tab_store')}</div>
    </div>
    <div id="skills-tab-installed" class="config-section">
      <div class="stat-card loading-placeholder" style="height:96px"></div>
    </div>
    <div id="skills-tab-store" class="config-section" style="display:none">
      <div class="clawhub-toolbar" style="margin-bottom:var(--space-sm)">
        <input class="input clawhub-search-input" id="skill-store-search" placeholder="${t('pages.skills.store_search_placeholder')}" type="text" style="flex:1">
        <button class="btn btn-primary btn-sm" data-action="store-search">${t('pages.skills.store_search_btn')}</button>
        <a class="btn btn-secondary btn-sm" href="https://skillhub.tencent.com" target="_blank" rel="noopener">${t('pages.skills.store_browse')}</a>
      </div>
      <div id="store-results" class="clawhub-list" style="max-height:calc(100vh - 300px);overflow-y:auto">
        <div class="form-hint" style="padding:var(--space-xl);text-align:center">${t('pages.skills.store_loading')}</div>
      </div>
    </div>
  `
  bindEvents(page)
  loadSkills(page)

  // Agent 选择器变化时刷新
  const agentSelect = page.querySelector('#skills-agent-select')
  if (agentSelect) {
    agentSelect.addEventListener('change', () => {
      const val = agentSelect.value
      _selectedAgentId = (val === 'main') ? null : val
      _storeIndex = null
      _installedNames = new Set()
      loadSkills(page)
    })
  }


  return page
}

async function loadSkills(page) {
  const el = page.querySelector('#skills-tab-installed')
  if (!el) return
  const seq = ++_loadSeq

  el.innerHTML = `<div class="skills-loading-panel">
    <div class="stat-card loading-placeholder" style="height:96px"></div>
    <div class="form-hint" style="margin-top:8px">${t('pages.skills.loading')}</div>
  </div>`

  try {
    const data = await api.skillsList(_selectedAgentId)
    if (seq !== _loadSeq) return
    renderSkills(el, data)
  } catch (e) {
    if (seq !== _loadSeq) return
    el.innerHTML = `<div class="skills-load-error">
      <div style="color:var(--error);margin-bottom:8px">${t('pages.skills.load_fail', { error: String(e?.message || e) })}</div>
      <div class="form-hint" style="margin-bottom:10px">${t('pages.skills.load_fail_hint')}</div>
      <button class="btn btn-secondary btn-sm" data-action="skill-retry">${t('pages.skills.btn_retry')}</button>
    </div>`
  }
}

function renderSkills(el, data) {
  const skills = data?.skills || []
  const cliAvailable = data?.cliAvailable !== false
  const eligible = skills.filter(s => s.eligible && !s.disabled)
  const missing = skills.filter(s => !s.eligible && !s.disabled && !s.blockedByAllowlist)
  const disabled = skills.filter(s => s.disabled)
  const blocked = skills.filter(s => s.blockedByAllowlist && !s.disabled)

  const summaryDetail = t('pages.skills.summary_detail', {
    eligible: eligible.length,
    missing: missing.length,
    disabled: disabled.length,
  })

  el.innerHTML = `
    <div class="clawhub-toolbar">
      <input class="input clawhub-search-input" id="skill-filter-input" placeholder="${t('pages.skills.filter_placeholder')}" type="text">
      <button class="btn btn-secondary btn-sm" data-action="skill-retry">${t('pages.skills.btn_refresh')}</button>
    </div>

    <div class="skills-summary" style="margin-bottom:var(--space-lg);color:var(--text-secondary);font-size:var(--font-size-sm)">
      ${t('pages.skills.summary', { total: skills.length, detail: summaryDetail })}
    </div>

    ${eligible.length ? `
    <div class="clawhub-panel" style="margin-bottom:var(--space-lg)">
      <div class="clawhub-panel-title" style="display:flex;align-items:center;gap:6px;color:var(--success)">${icon('check-circle', 16)} ${t('pages.skills.group_eligible')} (${eligible.length})</div>
      <div class="clawhub-list skills-scroll-area skills-trending-scroll" id="skills-eligible">
        ${eligible.map(s => renderSkillCard(s, 'eligible')).join('')}
      </div>
    </div>` : ''}

    ${missing.length ? `
    <div class="clawhub-panel" style="margin-bottom:var(--space-lg)">
      <div class="clawhub-panel-title" style="color:var(--warning);display:flex;align-items:center;gap:var(--space-sm)">
        <span style="display:inline-flex;align-items:center;gap:6px">${icon('x-circle', 16)} ${t('pages.skills.group_missing')} (${missing.length})</span>
        <button class="btn btn-secondary btn-sm" data-action="skill-ai-fix" style="font-size:var(--font-size-xs);padding:2px 8px">${t('pages.skills.btn_ai_fix')}</button>
      </div>
      <div class="clawhub-list skills-scroll-area skills-installed-scroll" id="skills-missing">
        ${missing.map(s => renderSkillCard(s, 'missing')).join('')}
      </div>
    </div>` : ''}

    ${disabled.length ? `
    <div class="clawhub-panel" style="margin-bottom:var(--space-lg)">
      <div class="clawhub-panel-title" style="display:flex;align-items:center;gap:6px;color:var(--text-tertiary)">${icon('pause-circle', 16)} ${t('pages.skills.group_disabled')} (${disabled.length})</div>
      <div class="clawhub-list skills-scroll-area skills-search-scroll" id="skills-disabled">
        ${disabled.map(s => renderSkillCard(s, 'disabled')).join('')}
      </div>
    </div>` : ''}

    ${blocked.length ? `
    <div class="clawhub-panel" style="margin-bottom:var(--space-lg)">
      <div class="clawhub-panel-title" style="display:flex;align-items:center;gap:6px;color:var(--text-tertiary)">${icon('ban', 16)} ${t('pages.skills.group_blocked')} (${blocked.length})</div>
      <div class="clawhub-list">
        ${blocked.map(s => renderSkillCard(s, 'blocked')).join('')}
      </div>
    </div>` : ''}

    ${!skills.length ? `
    <div class="clawhub-panel">
      <div class="clawhub-empty" style="text-align:center;padding:var(--space-xl)">
        <div style="margin-bottom:var(--space-sm)">${t('pages.skills.no_skills')}</div>
        <div class="form-hint">${t('pages.skills.no_skills_hint')}</div>
      </div>
    </div>` : ''}

    <div id="skill-detail-area"></div>
  `

  // 实时过滤
  const input = el.querySelector('#skill-filter-input')
  if (input) {
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase()
      el.querySelectorAll('.skill-card-item').forEach(card => {
        const name = (card.dataset.name || '').toLowerCase()
        const desc = (card.dataset.desc || '').toLowerCase()
        card.style.display = (!q || name.includes(q) || desc.includes(q)) ? '' : 'none'
      })
    })
  }
}

function renderSkillCard(skill, status) {
  // skill.emoji 来自 Skill YAML frontmatter(用户数据),若存在保留在 fallback;图标容器用 SVG
  const skillIcon = skill.emoji
    ? `<span class="skill-icon-fallback" style="font-family:'Apple Color Emoji',sans-serif">${skill.emoji}</span>`
    : icon('package', 16)
  const name = skill.name || ''
  const desc = skill.description || ''
  const source = skill.bundled ? t('pages.skills.source_bundled') : (skill.source || t('pages.skills.source_custom'))
  const missingBins = skill.missing?.bins || []
  const missingEnv = skill.missing?.env || []
  const missingConfig = skill.missing?.config || []
  const installOpts = skill.install || []

  let statusBadge = ''
  if (status === 'eligible') statusBadge = `<span class="clawhub-badge installed">${t('pages.skills.badge_eligible')}</span>`
  else if (status === 'missing') statusBadge = `<span class="clawhub-badge" style="background:rgba(245,158,11,0.14);color:#d97706">${t('pages.skills.badge_missing')}</span>`
  else if (status === 'disabled') statusBadge = `<span class="clawhub-badge" style="background:rgba(107,114,128,0.14);color:#6b7280">${t('pages.skills.badge_disabled')}</span>`
  else if (status === 'blocked') statusBadge = `<span class="clawhub-badge" style="background:rgba(239,68,68,0.14);color:#ef4444">${t('pages.skills.badge_blocked')}</span>`

  let missingHtml = ''
  if (missingBins.length) missingHtml += `<div class="form-hint" style="margin-top:4px">${t('pages.skills.missing_bins')} ${missingBins.map(b => `<code>${esc(b)}</code>`).join(', ')}</div>`
  if (missingEnv.length) missingHtml += `<div class="form-hint" style="margin-top:4px">${t('pages.skills.missing_env')} ${missingEnv.map(e => `<code>${esc(e)}</code>`).join(', ')} <span style="color:var(--text-tertiary);font-size:var(--font-size-xs)">${t('pages.skills.missing_env_hint')}</span></div>`
  if (missingConfig.length) missingHtml += `<div class="form-hint" style="margin-top:4px">${t('pages.skills.missing_config')} ${missingConfig.map(c => `<code>${esc(c)}</code>`).join(', ')} <span style="color:var(--text-tertiary);font-size:var(--font-size-xs)">${t('pages.skills.missing_config_hint')}</span></div>`

  let installHtml = ''
  if (status === 'missing') {
    if (installOpts.length) {
      installHtml = `<div style="margin-top:6px">${installOpts.map(opt =>
        `<button class="btn btn-primary btn-sm" style="margin-right:6px;margin-top:4px" data-action="skill-install-dep" data-kind="${esc(opt.kind)}" data-install='${esc(JSON.stringify(opt))}' data-skill-name="${esc(name)}">${esc(opt.label)}</button>`
      ).join('')}</div>`
    } else if (missingBins.length && !missingEnv.length && !missingConfig.length) {
      installHtml = `<div class="form-hint" style="margin-top:6px;color:var(--text-tertiary);font-size:var(--font-size-xs)">${t('pages.skills.no_auto_install')} ${missingBins.map(b => `<code>brew install ${esc(b)}</code> 或 <code>npm i -g ${esc(b)}</code>`).join(' / ')}</div>`
    }
  }

  return `
    <div class="clawhub-item skill-card-item" data-name="${esc(name)}" data-desc="${esc(desc)}">
      <div class="clawhub-item-main">
        <div class="clawhub-item-title" style="display:flex;align-items:center;gap:6px">${skillIcon} ${esc(name)}</div>
        <div class="clawhub-item-meta">${esc(source)}${skill.homepage ? ` · <a href="${esc(skill.homepage)}" target="_blank" rel="noopener" style="color:var(--accent)">${esc(skill.homepage)}</a>` : ''}</div>
        <div class="clawhub-item-desc">${esc(desc)}</div>
        ${missingHtml}
        ${installHtml}
      </div>
      <div class="clawhub-item-actions">
        <button class="btn btn-secondary btn-sm" data-action="skill-info" data-name="${esc(name)}">${t('pages.skills.btn_detail')}</button>
        ${!skill.bundled ? `<button class="btn btn-sm" style="color:var(--error);border:1px solid var(--error);background:transparent;font-size:var(--font-size-xs)" data-action="skill-uninstall" data-name="${esc(name)}">${t('pages.skills.uninstall')}</button>` : ''}
        ${statusBadge}
      </div>
    </div>
  `
}

async function handleInfo(page, name) {
  const detail = page.querySelector('#skill-detail-area')
  if (!detail) return
  detail.innerHTML = `<div class="form-hint" style="margin-top:var(--space-md)">${t('pages.skills.loading_detail')}</div>`
  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  try {
    // 优先 Gateway RPC（可获取 ClawHub 远程详情），回退 Tauri 本地
    let skill = null
    if (wsClient.connected && wsClient.gatewayReady) {
      try { skill = await wsClient.skillsDetail(name) } catch {}
    }
    if (!skill) skill = await api.skillsInfo(name, _selectedAgentId)
    const s = skill || {}
    const reqs = s.requirements || {}
    const miss = s.missing || {}

    let reqsHtml = ''
    const reqIcon = (ok) => icon(ok ? 'check' : 'x', 12)
    if (reqs.bins?.length) {
      reqsHtml += `<div style="margin-top:8px"><strong>${t('pages.skills.detail_requires_bins')}</strong> ${reqs.bins.map(b => {
        const ok = !(miss.bins || []).includes(b)
        return `<code style="display:inline-flex;align-items:center;gap:4px;color:var(--${ok ? 'success' : 'error'})">${reqIcon(ok)} ${esc(b)}</code>`
      }).join(' ')}</div>`
    }
    if (reqs.env?.length) {
      reqsHtml += `<div style="margin-top:4px"><strong>${t('pages.skills.detail_requires_env')}</strong> ${reqs.env.map(e => {
        const ok = !(miss.env || []).includes(e)
        return `<code style="display:inline-flex;align-items:center;gap:4px;color:var(--${ok ? 'success' : 'error'})">${reqIcon(ok)} ${esc(e)}</code>`
      }).join(' ')}</div>`
    }

    const detailIcon = s.emoji
      ? `<span style="font-family:'Apple Color Emoji',sans-serif">${esc(s.emoji)}</span>`
      : icon('package', 18)

    detail.innerHTML = `
      <div class="clawhub-detail-card">
        <div class="clawhub-detail-title" style="display:flex;align-items:center;gap:8px">${detailIcon} ${esc(s.name || name)}</div>
        <div class="clawhub-detail-meta">
          ${t('pages.skills.detail_source')} ${esc(s.source || '')} · ${t('pages.skills.detail_path')} <code>${esc(s.filePath || '')}</code>
          ${s.homepage ? ` · <a href="${esc(s.homepage)}" target="_blank" rel="noopener">${esc(s.homepage)}</a>` : ''}
        </div>
        <div class="clawhub-detail-desc" style="margin-top:8px">${esc(s.description || '')}</div>
        ${reqsHtml}
        ${(s.install || []).length && !s.eligible ? `<div style="margin-top:8px"><strong>${t('pages.skills.detail_install_opts')}</strong> ${s.install.map(i => `<span class="form-hint">→ ${esc(i.label)}</span>`).join(' ')}</div>` : ''}
      </div>
    `
  } catch (e) {
    detail.innerHTML = `<div style="color:var(--error);margin-top:var(--space-md)">${t('pages.skills.detail_load_fail', { error: String(e?.message || e) })}</div>`
  }
}

async function handleInstallDep(page, btn) {
  const kind = btn.dataset.kind
  let spec
  try { spec = JSON.parse(btn.dataset.install) } catch { spec = {} }
  const skillName = btn.dataset.skillName || ''
  btn.disabled = true
  btn.textContent = t('pages.skills.installing')
  try {
    await api.skillsInstallDep(kind, spec)
    toast(t('pages.skills.install_success', { name: skillName }), 'success')
    await loadSkills(page)
  } catch (e) {
    toast(t('pages.skills.install_fail', { error: String(e?.message || e) }), 'error')
    btn.disabled = false
    btn.textContent = spec.label || t('pages.skills.btn_retry')
  }
}

// ===== 技能商店（SkillHub SDK）=====
let _storeIndex = null // 缓存的全量索引
let _installedNames = new Set() // 已安装的 skill 名称

async function loadStore(page) {
  const results = page.querySelector('#store-results')
  if (!results) return
  results.innerHTML = `<div class="form-hint" style="padding:var(--space-xl);text-align:center">${t('pages.skills.store_loading')}</div>`
  try {
    _storeIndex = await api.skillhubIndex()
    try {
      const data = await api.skillsList(_selectedAgentId)
      _installedNames = new Set((data?.skills || []).map(s => s.name))
    } catch { _installedNames = new Set() }
    renderStoreItems(results, _storeIndex)
  } catch (e) {
    results.innerHTML = `<div style="color:var(--error);padding:var(--space-lg);text-align:center">${t('pages.skills.store_load_failed')}: ${esc(e?.message || e)}</div>`
  }
}

function renderStoreItems(el, items) {
  if (!items?.length) {
    el.innerHTML = `<div class="clawhub-empty" style="padding:var(--space-xl);text-align:center">${t('pages.skills.store_no_results')}</div>`
    return
  }
  el.innerHTML = items.map(item => {
    const slug = item.slug || ''
    const name = item.display_name || item.displayName || item.name || slug
    const desc = item.summary || item.description || ''
    const installed = _installedNames.has(slug)
    return `
      <div class="clawhub-item store-item" data-slug="${esc(slug)}" data-name="${esc(name)}" data-desc="${esc(desc)}">
        <div class="clawhub-item-main">
          <div class="clawhub-item-title" style="display:flex;align-items:center;gap:6px;color:var(--accent-blue)">${icon('package', 16)} <span style="color:var(--text-primary)">${esc(name)}</span></div>
          <div class="clawhub-item-desc">${esc(desc)}</div>
          ${item.version ? `<div class="clawhub-item-meta">v${esc(item.version)}${item.author ? ` · ${esc(item.author)}` : ''}</div>` : ''}
        </div>
        <div class="clawhub-item-actions">
          ${installed
            ? `<span class="clawhub-badge installed">${t('pages.skills.store_installed')}</span>`
            : `<button class="btn btn-primary btn-sm" data-action="store-install" data-slug="${esc(slug)}">${t('pages.skills.store_install_btn')}</button>`
          }
        </div>
      </div>
    `
  }).join('')
}

async function handleStoreSearch(page) {
  const input = page.querySelector('#skill-store-search')
  const results = page.querySelector('#store-results')
  if (!input || !results) return
  const q = input.value.trim().toLowerCase()
  if (!q && _storeIndex) {
    renderStoreItems(results, _storeIndex)
    return
  }
  if (!q) return
  // 客户端过滤已有索引
  if (_storeIndex) {
    const filtered = _storeIndex.filter(item => {
      const slug = (item.slug || '').toLowerCase()
      const name = (item.display_name || item.displayName || '').toLowerCase()
      const desc = (item.summary || item.description || '').toLowerCase()
      const tags = (item.tags || []).join(' ').toLowerCase()
      return slug.includes(q) || name.includes(q) || desc.includes(q) || tags.includes(q)
    })
    renderStoreItems(results, filtered)
    return
  }
  // 没有索引时走服务端搜索（优先 Gateway RPC，回退 Tauri）
  results.innerHTML = `<div class="form-hint" style="padding:var(--space-sm)">${t('pages.skills.store_searching')}</div>`
  try {
    let items
    if (wsClient.connected && wsClient.gatewayReady) {
      try {
        const res = await wsClient.skillsSearch(input.value.trim(), 30)
        items = res?.results || []
      } catch {
        items = await api.skillhubSearch(input.value.trim())
      }
    } else {
      items = await api.skillhubSearch(input.value.trim())
    }
    renderStoreItems(results, items)
  } catch (e) {
    results.innerHTML = `<div style="color:var(--error);padding:var(--space-sm)">${t('pages.skills.store_search_failed')}: ${esc(e?.message || e)}</div>`
  }
}

async function handleStoreInstall(page, btn) {
  const slug = btn.dataset.slug
  btn.disabled = true
  btn.textContent = t('pages.skills.installing')
  try {
    await api.skillhubInstall(slug, _selectedAgentId)
    toast(t('pages.skills.install_success', { name: slug }), 'success')
    btn.textContent = t('pages.skills.store_installed')
    btn.classList.remove('btn-primary')
    btn.classList.add('btn-secondary')
    _installedNames.add(slug)
    loadSkills(page).catch(() => {})
  } catch (e) {
    toast(t('pages.skills.install_fail', { error: String(e?.message || e) }), 'error')
    btn.disabled = false
    btn.textContent = t('pages.skills.store_install_btn')
  }
}

async function handleSkillUninstall(page, btn) {
  const name = btn.dataset.name
  if (!name) return
  if (!confirm(t('pages.skills.confirm_uninstall', { name }))) return
  btn.disabled = true
  btn.textContent = t('pages.skills.uninstalling')
  try {
    await api.skillsUninstall(name, _selectedAgentId)
    toast(t('pages.skills.uninstalled', { name }), 'success')
    await loadSkills(page)
  } catch (e) {
    toast(t('pages.skills.uninstall_failed', { error: String(e?.message || e) }), 'error')
    btn.disabled = false
    btn.textContent = t('pages.skills.uninstall')
  }
}

function bindEvents(page) {
  // 主 Tab 切换（已安装 / 搜索安装）
  page.querySelectorAll('#skills-main-tabs .tab').forEach(tab => {
    tab.onclick = () => {
      page.querySelectorAll('#skills-main-tabs .tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      const key = tab.dataset.mainTab
      page.querySelector('#skills-tab-installed').style.display = key === 'installed' ? '' : 'none'
      page.querySelector('#skills-tab-store').style.display = key === 'store' ? '' : 'none'
      // 切到商店 tab 时加载全量索引
      if (key === 'store') loadStore(page)
    }
  })

  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    switch (btn.dataset.action) {
      case 'skill-retry':
        await loadSkills(page)
        break
      case 'skill-info':
        await handleInfo(page, btn.dataset.name)
        break
      case 'skill-install-dep':
        await handleInstallDep(page, btn)
        break
      case 'store-search':
        await handleStoreSearch(page)
        break
      case 'store-install':
        await handleStoreInstall(page, btn)
        break
      case 'skill-uninstall':
        await handleSkillUninstall(page, btn)
        break
      case 'skill-ai-fix':
        window.location.hash = '#/assistant'
        setTimeout(() => {
          const skillBtn = document.querySelector('.ast-skill-card[data-skill="skills-manager"]')
          if (skillBtn) skillBtn.click()
        }, 500)
        break
    }
  })

  page.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && e.target?.id === 'skill-store-search') {
      e.preventDefault()
      await handleStoreSearch(page)
    }
  })
}

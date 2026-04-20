#!/usr/bin/env node
// 临时脚本：对 skills.js, cron.js, usage.js, chat-debug.js 做 i18n 替换
import { readFileSync, writeFileSync } from 'fs'

// ── skills.js ──
{
  let src = readFileSync('src/pages/skills.js', 'utf8')

  // 添加 i18n 导入
  src = src.replace(
    "import { handleInvestGuideAction } from '../components/invest-guide.js'",
    "import { handleInvestGuideAction } from '../components/invest-guide.js'\nimport { t } from '../lib/i18n.js'"
  )

  // page header
  src = src.replace(
    `<h1 class="page-title">Skills</h1>\n      <p class="page-desc">查看 OpenClaw 可用的 Skills 及其依赖状态</p>`,
    `<h1 class="page-title">\${t('pages.skills.title')}</h1>\n      <p class="page-desc">\${t('pages.skills.desc')}</p>`
  )

  // loading text
  src = src.replace(
    `<div class="form-hint" style="margin-top:8px">正在加载 Skills...</div>`,
    `<div class="form-hint" style="margin-top:8px">\${t('pages.skills.loading')}</div>`
  )

  // load error
  src = src.replace(
    `<div style="color:var(--error);margin-bottom:8px">加载失败: \${esc(e?.message || e)}</div>`,
    `<div style="color:var(--error);margin-bottom:8px">\${t('pages.skills.load_fail', { error: esc(e?.message || e) })}</div>`
  )
  src = src.replace(
    `<div class="form-hint" style="margin-bottom:10px">请确认 OpenClaw 已安装并可用</div>`,
    `<div class="form-hint" style="margin-bottom:10px">\${t('pages.skills.load_fail_hint')}</div>`
  )
  src = src.replace(
    `<button class="btn btn-secondary btn-sm" data-action="skill-retry">重试</button>`,
    `<button class="btn btn-secondary btn-sm" data-action="skill-retry">\${t('pages.skills.btn_retry')}</button>`
  )

  // toolbar in renderSkills
  src = src.replace(
    `placeholder="过滤 Skills..."`,
    `placeholder="\${t('pages.skills.filter_placeholder')}"`
  )
  src = src.replace(
    `<button class="btn btn-secondary btn-sm" data-action="skill-retry">刷新</button>`,
    `<button class="btn btn-secondary btn-sm" data-action="skill-retry">\${t('pages.skills.btn_refresh')}</button>`
  )
  src = src.replace(
    `<a class="btn btn-secondary btn-sm" href="https://clawhub.openclaw.ai" target="_blank" rel="noopener">ClawHub 市场</a>`,
    `<a class="btn btn-secondary btn-sm" href="https://clawhub.openclaw.ai" target="_blank" rel="noopener">\${t('pages.skills.clawhub_market')}</a>`
  )
  src = src.replace(
    `<span class="form-hint" style="margin-left:auto;color:var(--warning)">CLI 不可用，仅显示本地扫描结果</span>`,
    `<span class="form-hint" style="margin-left:auto;color:var(--warning)">\${t('pages.skills.cli_unavailable')}</span>`
  )

  // summary
  src = src.replace(
    "const summary = `${eligible.length} 可用 / ${missing.length} 缺依赖 / ${disabled.length} 已禁用`",
    "const summary = t('pages.skills.summary_detail', { eligible: eligible.length, missing: missing.length, disabled: disabled.length })"
  )
  src = src.replace(
    "共 ${skills.length} 个 Skills: ${summary}",
    "${t('pages.skills.summary', { total: skills.length, detail: summary })}"
  )

  // group titles
  src = src.replace(`<div class="clawhub-panel-title" style="color:var(--success)">✓ 可用 (\${eligible.length})</div>`,
    `<div class="clawhub-panel-title" style="color:var(--success)">✓ \${t('pages.skills.group_eligible')} (\${eligible.length})</div>`)
  src = src.replace(`<span>✗ 缺少依赖 (\${missing.length})</span>`,
    `<span>✗ \${t('pages.skills.group_missing')} (\${missing.length})</span>`)
  src = src.replace(`<button class="btn btn-secondary btn-sm" data-action="skill-ai-fix" style="font-size:var(--font-size-xs);padding:2px 8px">让 AI 助手帮我安装</button>`,
    `<button class="btn btn-secondary btn-sm" data-action="skill-ai-fix" style="font-size:var(--font-size-xs);padding:2px 8px">\${t('pages.skills.btn_ai_fix')}</button>`)
  src = src.replace(`<div class="clawhub-panel-title" style="color:var(--text-tertiary)">⏸ 已禁用 (\${disabled.length})</div>`,
    `<div class="clawhub-panel-title" style="color:var(--text-tertiary)">⏸ \${t('pages.skills.group_disabled')} (\${disabled.length})</div>`)
  src = src.replace(`<div class="clawhub-panel-title" style="color:var(--text-tertiary)">🚫 白名单阻止 (\${blocked.length})</div>`,
    `<div class="clawhub-panel-title" style="color:var(--text-tertiary)">🚫 \${t('pages.skills.group_blocked')} (\${blocked.length})</div>`)

  // empty state
  src = src.replace(`<div style="margin-bottom:var(--space-sm)">未检测到任何 Skills</div>`,
    `<div style="margin-bottom:var(--space-sm)">\${t('pages.skills.no_skills')}</div>`)
  src = src.replace(
    `<div class="form-hint">请确认 OpenClaw 已正确安装。Skills 随 OpenClaw 捆绑提供，也可自定义放置在 <code>~/.openclaw/skills/</code> 目录下。</div>`,
    `<div class="form-hint">\${t('pages.skills.no_skills_hint')}</div>`
  )

  // ClawHub section
  src = src.replace(`<div class="clawhub-panel-title">从 ClawHub 安装新 Skill</div>`,
    `<div class="clawhub-panel-title">\${t('pages.skills.clawhub_install_title')}</div>`)
  src = src.replace(
    /也可直接访问 <a href="https:\/\/clawhub\.openclaw\.ai"[^>]*>ClawHub 市场<\/a> 浏览全部社区 Skills。/,
    `\${t('pages.skills.clawhub_install_hint')}`
  )
  src = src.replace(`placeholder="搜索 ClawHub，如 weather / github / summarize"`,
    `placeholder="\${t('pages.skills.clawhub_search_placeholder')}"`)
  src = src.replace(`<button class="btn btn-primary btn-sm" data-action="clawhub-search">搜索</button>`,
    `<button class="btn btn-primary btn-sm" data-action="clawhub-search">\${t('pages.skills.clawhub_search_btn')}</button>`)
  src = src.replace(`<div class="clawhub-empty">输入关键词搜索 ClawHub 社区 Skills</div>`,
    `<div class="clawhub-empty">\${t('pages.skills.clawhub_empty')}</div>`)

  // Search tools section
  src = src.replace(`<div class="clawhub-panel-title">内置搜索工具快捷配置</div>`,
    `<div class="clawhub-panel-title">\${t('pages.skills.search_tools_title')}</div>`)
  src = src.replace(
    `<div style="font-size:var(--font-size-xs);color:var(--text-secondary);margin-bottom:var(--space-sm)">以下搜索工具可作为 MCP 挂载，在 Agent 中直接使用。配置对应 API Key 后需重启 Gateway 生效。</div>`,
    `<div style="font-size:var(--font-size-xs);color:var(--text-secondary);margin-bottom:var(--space-sm)">\${t('pages.skills.search_tools_hint')}</div>`
  )
  src = src.replaceAll(`>获取 Key</a>`, `>\${t('pages.skills.btn_get_key')}</a>`)

  // About Skills section
  src = src.replace(`<div class="clawhub-panel-title">关于 Skills</div>`,
    `<div class="clawhub-panel-title">\${t('pages.skills.about_title')}</div>`)
  src = src.replace(
    `<div class="skills-tip-item"><strong>捆绑 Skills</strong>：随 OpenClaw 安装包自带，无需额外安装</div>`,
    `<div class="skills-tip-item">\${t('pages.skills.about_bundled')}</div>`
  )
  src = src.replace(
    /<div class="skills-tip-item"><strong>自定义 Skills<\/strong>：将 SKILL\.md 放入 <code>~\/\.openclaw\/skills\/&lt;name&gt;\/<\/code> 目录即可<\/div>/,
    `<div class="skills-tip-item">\${t('pages.skills.about_custom')}</div>`
  )
  src = src.replace(
    `<div class="skills-tip-item"><strong>依赖检查</strong>：某些 Skills 需要特定命令行工具（如 gh、curl）才能使用</div>`,
    `<div class="skills-tip-item">\${t('pages.skills.about_deps')}</div>`
  )
  src = src.replace(
    /<div class="skills-tip-item"><strong>浏览更多<\/strong>：访问 <a href="https:\/\/clawhub\.openclaw\.ai" target="_blank" rel="noopener">ClawHub 市场<\/a> 发现社区共享的 Skills<\/div>/,
    `<div class="skills-tip-item">\${t('pages.skills.about_browse')}</div>`
  )

  // renderSkillCard - source label
  src = src.replace(
    "const source = skill.bundled ? '捆绑' : (skill.source || '自定义')",
    "const source = skill.bundled ? t('pages.skills.source_bundled') : (skill.source || t('pages.skills.source_custom'))"
  )

  // badges
  src = src.replace(`if (status === 'eligible') statusBadge = '<span class="clawhub-badge installed">可用</span>'`,
    `if (status === 'eligible') statusBadge = '<span class="clawhub-badge installed">' + t('pages.skills.badge_eligible') + '</span>'`)
  src = src.replace(`else if (status === 'missing') statusBadge = '<span class="clawhub-badge" style="background:rgba(245,158,11,0.14);color:#d97706">缺依赖</span>'`,
    `else if (status === 'missing') statusBadge = '<span class="clawhub-badge" style="background:rgba(245,158,11,0.14);color:#d97706">' + t('pages.skills.badge_missing') + '</span>'`)
  src = src.replace(`else if (status === 'disabled') statusBadge = '<span class="clawhub-badge" style="background:rgba(107,114,128,0.14);color:#6b7280">已禁用</span>'`,
    `else if (status === 'disabled') statusBadge = '<span class="clawhub-badge" style="background:rgba(107,114,128,0.14);color:#6b7280">' + t('pages.skills.badge_disabled') + '</span>'`)
  src = src.replace(`else if (status === 'blocked') statusBadge = '<span class="clawhub-badge" style="background:rgba(239,68,68,0.14);color:#ef4444">已阻止</span>'`,
    `else if (status === 'blocked') statusBadge = '<span class="clawhub-badge" style="background:rgba(239,68,68,0.14);color:#ef4444">' + t('pages.skills.badge_blocked') + '</span>'`)

  // missing dependencies
  src = src.replace(
    `if (missingBins.length) missingHtml += \`<div class="form-hint" style="margin-top:4px">缺少命令:`,
    `if (missingBins.length) missingHtml += \`<div class="form-hint" style="margin-top:4px">\${t('pages.skills.missing_bins')}`
  )
  src = src.replace(
    `if (missingEnv.length) missingHtml += \`<div class="form-hint" style="margin-top:4px">缺少环境变量:`,
    `if (missingEnv.length) missingHtml += \`<div class="form-hint" style="margin-top:4px">\${t('pages.skills.missing_env')}`
  )
  src = src.replace(
    `<span style="color:var(--text-tertiary);font-size:var(--font-size-xs)">— 需在系统环境变量中配置</span>`,
    `<span style="color:var(--text-tertiary);font-size:var(--font-size-xs)">\${t('pages.skills.missing_env_hint')}</span>`
  )
  src = src.replace(
    `if (missingConfig.length) missingHtml += \`<div class="form-hint" style="margin-top:4px">缺少配置:`,
    `if (missingConfig.length) missingHtml += \`<div class="form-hint" style="margin-top:4px">\${t('pages.skills.missing_config')}`
  )
  src = src.replace(
    `<span style="color:var(--text-tertiary);font-size:var(--font-size-xs)">— 需在 openclaw.json 中配置</span>`,
    `<span style="color:var(--text-tertiary);font-size:var(--font-size-xs)">\${t('pages.skills.missing_config_hint')}</span>`
  )

  // no auto install
  src = src.replace(
    `installHtml = \`<div class="form-hint" style="margin-top:6px;color:var(--text-tertiary);font-size:var(--font-size-xs)">无自动安装选项，请手动安装:`,
    `installHtml = \`<div class="form-hint" style="margin-top:6px;color:var(--text-tertiary);font-size:var(--font-size-xs)">\${t('pages.skills.no_auto_install')}`
  )

  // detail button
  src = src.replace(
    `<button class="btn btn-secondary btn-sm" data-action="skill-info" data-name="\${esc(name)}">详情</button>`,
    `<button class="btn btn-secondary btn-sm" data-action="skill-info" data-name="\${esc(name)}">\${t('pages.skills.btn_detail')}</button>`
  )

  // handleInfo
  src = src.replace(
    `detail.innerHTML = '<div class="form-hint" style="margin-top:var(--space-md)">正在加载详情...</div>'`,
    `detail.innerHTML = '<div class="form-hint" style="margin-top:var(--space-md)">' + t('pages.skills.loading_detail') + '</div>'`
  )
  src = src.replace(
    `reqsHtml += \`<div style="margin-top:8px"><strong>需要命令:</strong>`,
    `reqsHtml += \`<div style="margin-top:8px"><strong>\${t('pages.skills.detail_requires_bins')}</strong>`
  )
  src = src.replace(
    `reqsHtml += \`<div style="margin-top:4px"><strong>环境变量:</strong>`,
    `reqsHtml += \`<div style="margin-top:4px"><strong>\${t('pages.skills.detail_requires_env')}</strong>`
  )
  src = src.replace(
    `来源: \${esc(s.source || '')} · 路径:`,
    `\${t('pages.skills.detail_source')} \${esc(s.source || '')} · \${t('pages.skills.detail_path')}`
  )
  src = src.replace(
    `<div style="margin-top:8px"><strong>安装选项:</strong>`,
    `<div style="margin-top:8px"><strong>\${t('pages.skills.detail_install_opts')}</strong>`
  )
  src = src.replace(
    `detail.innerHTML = \`<div style="color:var(--error);margin-top:var(--space-md)">加载详情失败: \${esc(e?.message || e)}</div>\``,
    `detail.innerHTML = \`<div style="color:var(--error);margin-top:var(--space-md)">\${t('pages.skills.detail_load_fail', { error: esc(e?.message || e) })}</div>\``
  )

  // handleInstallDep
  src = src.replace(`btn.textContent = '安装中...'`, `btn.textContent = t('pages.skills.installing')`)
  src = src.replace(
    "toast(`${skillName} 依赖安装成功`, 'success')",
    "toast(t('pages.skills.install_success', { name: skillName }), 'success')"
  )
  src = src.replace(
    "toast(`安装失败: ${e?.message || e}`, 'error')",
    "toast(t('pages.skills.install_fail', { error: e?.message || e }), 'error')"
  )

  // handleClawHubSearch
  src = src.replace(
    `results.innerHTML = '<div class="clawhub-empty">输入关键词搜索 ClawHub 社区 Skills</div>'; return`,
    `results.innerHTML = '<div class="clawhub-empty">' + t('pages.skills.clawhub_empty') + '</div>'; return`
  )
  src = src.replace(
    `results.innerHTML = '<div class="form-hint">正在搜索...</div>'`,
    `results.innerHTML = '<div class="form-hint">' + t('pages.skills.clawhub_searching') + '</div>'`
  )
  src = src.replace(
    `results.innerHTML = '<div class="clawhub-empty">没有找到匹配的 Skill</div>'; return`,
    `results.innerHTML = '<div class="clawhub-empty">' + t('pages.skills.clawhub_no_result') + '</div>'; return`
  )
  src = src.replace(
    `<button class="btn btn-primary btn-sm" data-action="clawhub-install" data-slug="\${esc(item.slug || item.name || '')}">安装</button>`,
    `<button class="btn btn-primary btn-sm" data-action="clawhub-install" data-slug="\${esc(item.slug || item.name || '')}">\${t('pages.skills.clawhub_install_btn')}</button>`
  )
  src = src.replace(
    `results.innerHTML = \`<div style="color:var(--error)">搜索失败: \${esc(e?.message || e)}</div>\``,
    `results.innerHTML = \`<div style="color:var(--error)">\${t('pages.skills.clawhub_search_fail', { error: esc(e?.message || e) })}</div>\``
  )

  // handleClawHubInstall
  src = src.replace(
    /btn\.textContent = '安装中\.\.\.'/,
    `btn.textContent = t('pages.skills.clawhub_installing')`
  )
  src = src.replace(
    "toast(`Skill ${slug} 安装成功`, 'success')",
    "toast(t('pages.skills.clawhub_install_success', { slug }), 'success')"
  )
  src = src.replace(
    "toast(`安装失败: ${e?.message || e}`, 'error')\n    btn.disabled = false\n    btn.textContent = '安装'",
    "toast(t('pages.skills.clawhub_install_fail', { error: e?.message || e }), 'error')\n    btn.disabled = false\n    btn.textContent = t('pages.skills.clawhub_install_btn')"
  )

  writeFileSync('src/pages/skills.js', src)
  console.log('Patched skills.js')
}

// ── cron.js ──
{
  let src = readFileSync('src/pages/cron.js', 'utf8')

  // 添加 i18n 导入
  src = src.replace(
    "import { api, invalidate } from '../lib/tauri-api.js'",
    "import { api, invalidate } from '../lib/tauri-api.js'\nimport { t } from '../lib/i18n.js'"
  )

  // CRON_SHORTCUTS
  src = src.replace(`{ expr: '*/5 * * * *', text: '每 5 分钟' }`, `{ expr: '*/5 * * * *', get text() { return t('pages.cron.shortcut_5min') } }`)
  src = src.replace(`{ expr: '*/15 * * * *', text: '每 15 分钟' }`, `{ expr: '*/15 * * * *', get text() { return t('pages.cron.shortcut_15min') } }`)
  src = src.replace(`{ expr: '0 * * * *', text: '每小时整点' }`, `{ expr: '0 * * * *', get text() { return t('pages.cron.shortcut_hourly') } }`)
  src = src.replace(`{ expr: '0 9 * * *', text: '每天 9:00' }`, `{ expr: '0 9 * * *', get text() { return t('pages.cron.shortcut_daily_9') } }`)
  src = src.replace(`{ expr: '0 18 * * *', text: '每天 18:00' }`, `{ expr: '0 18 * * *', get text() { return t('pages.cron.shortcut_daily_18') } }`)
  src = src.replace(`{ expr: '0 9 * * 1', text: '每周一 9:00' }`, `{ expr: '0 9 * * 1', get text() { return t('pages.cron.shortcut_weekly_mon') } }`)
  src = src.replace(`{ expr: '0 9 1 * *', text: '每月 1 号 9:00' }`, `{ expr: '0 9 1 * *', get text() { return t('pages.cron.shortcut_monthly_1') } }`)

  // page header
  src = src.replace(`<h1 class="page-title">定时任务</h1>`, `<h1 class="page-title">\${t('pages.cron.title')}</h1>`)
  src = src.replace(`<p class="page-desc">创建计划任务，让 AI 按设定时间自动执行指令</p>`, `<p class="page-desc">\${t('pages.cron.desc')}</p>`)
  src = src.replace(`<span>定时任务通过 Gateway 管理。请先启动 Gateway 后使用此功能。</span>`, `<span>\${t('pages.cron.gw_hint')}</span>`)
  src = src.replace(`<a href="#/services" class="btn btn-sm btn-secondary" style="margin-left:auto;font-size:11px">服务管理</a>`, `<a href="#/services" class="btn btn-sm btn-secondary" style="margin-left:auto;font-size:11px">\${t('pages.cron.btn_services')}</a>`)
  src = src.replace(`<button class="btn btn-primary btn-sm" id="btn-new-task">+ 创建任务</button>`, `<button class="btn btn-primary btn-sm" id="btn-new-task">\${t('pages.cron.btn_new')}</button>`)
  src = src.replace(`<button class="btn btn-secondary btn-sm" id="btn-refresh-tasks">刷新</button>`, `<button class="btn btn-secondary btn-sm" id="btn-refresh-tasks">\${t('pages.cron.btn_refresh')}</button>`)

  // toast messages
  src = src.replace(`toast('已自动修复配置（移除无效的 cron.jobs）', 'info')`, `toast(t('pages.cron.toast_auto_fix'), 'info')`)
  src = src.replace(`toast('获取任务列表失败: ' + e, 'error')`, `toast(t('pages.cron.toast_fetch_fail', { error: e }), 'error')`)

  // stats
  src = src.replace(`<span class="stat-card-label">总任务</span>`, `<span class="stat-card-label">\${t('pages.cron.stat_total')}</span>`)
  src = src.replace(`<span class="stat-card-label">运行中</span>`, `<span class="stat-card-label">\${t('pages.cron.stat_active')}</span>`)
  src = src.replace(`<span class="stat-card-label">已暂停</span>`, `<span class="stat-card-label">\${t('pages.cron.stat_paused')}</span>`)
  src = src.replace(`<span class="stat-card-label">近期失败</span>`, `<span class="stat-card-label">\${t('pages.cron.stat_failed')}</span>`)

  // empty state
  src = src.replace(`<div style="font-size:var(--font-size-md);margin-bottom:6px">暂无定时任务</div>`, `<div style="font-size:var(--font-size-md);margin-bottom:6px">\${t('pages.cron.empty_title')}</div>`)
  src = src.replace(`<div style="font-size:var(--font-size-sm)">点击「+ 创建任务」添加你的第一个计划任务</div>`, `<div style="font-size:var(--font-size-sm)">\${t('pages.cron.empty_hint')}</div>`)

  // job name and badge
  src = src.replace(`name: j.name || j.id || '未命名'`, `name: j.name || j.id || t('pages.cron.unnamed')`)
  src = src.replace(`\${job.enabled ? '运行中' : '已暂停'}`, `\${job.enabled ? t('pages.cron.badge_running') : t('pages.cron.badge_paused')}`)

  // job actions toasts
  src = src.replace(`toast('任务已触发执行', 'success')`, `toast(t('pages.cron.toast_triggered'), 'success')`)
  src = src.replace(`toast('触发失败: ' + err, 'error')`, `toast(t('pages.cron.toast_trigger_fail', { error: err }), 'error')`)
  src = src.replace(`toast(job.enabled ? '已暂停' : '已启用', 'info')`, `toast(job.enabled ? t('pages.cron.toast_paused') : t('pages.cron.toast_enabled'), 'info')`)
  src = src.replace(`toast('操作失败: ' + err, 'error')`, `toast(t('pages.cron.toast_op_fail', { error: err }), 'error')`)
  src = src.replace("const yes = await showConfirm(`确定删除任务「${job.name}」？`)", "const yes = await showConfirm(t('pages.cron.confirm_delete', { name: job.name }))")
  src = src.replace(`toast('已删除', 'info')`, `toast(t('pages.cron.toast_deleted'), 'info')`)
  src = src.replace(`toast('删除失败: ' + err, 'error')`, `toast(t('pages.cron.toast_delete_fail', { error: err }), 'error')`)

  // openTaskDialog
  src = src.replace(
    "toast('Gateway 未连接，无法管理定时任务。请先启动 Gateway', 'warning')",
    "toast(t('pages.cron.toast_gw_required'), 'warning')"
  )
  src = src.replace(`title: isEdit ? '编辑任务' : '创建定时任务'`, `title: isEdit ? t('pages.cron.dialog_edit') : t('pages.cron.dialog_create')`)
  src = src.replace(`<label class="form-label">任务名称 *</label>`, `<label class="form-label">\${t('pages.cron.field_name')}</label>`)
  src = src.replace(`placeholder="如：每日摘要推送"`, `placeholder="\${t('pages.cron.field_name_placeholder')}"`)
  src = src.replace(`<label class="form-label">执行指令 *</label>`, `<label class="form-label">\${t('pages.cron.field_message')}</label>`)
  src = src.replace(`placeholder="AI 将在触发时执行这段指令"`, `placeholder="\${t('pages.cron.field_message_placeholder')}"`)
  src = src.replace(`<label class="form-label">指定 Agent</label>`, `<label class="form-label">\${t('pages.cron.field_agent')}</label>`)
  src = src.replace(`<div class="form-hint">不选则使用默认 Agent 执行</div>`, `<div class="form-hint">\${t('pages.cron.field_agent_hint')}</div>`)
  src = src.replaceAll(`>默认 Agent</option>`, `>\${t('pages.cron.field_agent_default')}</option>`)
  src = src.replace(`<label class="form-label">投递渠道</label>`, `<label class="form-label">\${t('pages.cron.field_channel')}</label>`)
  src = src.replaceAll(`>无（主会话）</option>`, `>\${t('pages.cron.field_channel_default')}</option>`)
  src = src.replace(`<div class="form-hint">配置了多个消息渠道时必须指定，否则任务会报错</div>`, `<div class="form-hint">\${t('pages.cron.field_channel_hint')}</div>`)
  src = src.replace(`<label class="form-label">执行周期</label>`, `<label class="form-label">\${t('pages.cron.field_schedule')}</label>`)
  src = src.replace(`placeholder="Cron 表达式，如 0 9 * * *"`, `placeholder="\${t('pages.cron.field_schedule_placeholder')}"`)
  src = src.replace(`<label class="form-label" style="margin:0">创建后立即启用</label>`, `<label class="form-label" style="margin:0">\${t('pages.cron.field_enabled')}</label>`)
  src = src.replace(`{ label: isEdit ? '保存修改' : '创建'`, `{ label: isEdit ? t('pages.cron.btn_save') : t('pages.cron.btn_create')`)

  // save in dialog
  src = src.replace(`toast('请输入任务名称', 'warning')`, `toast(t('pages.cron.validate_name'), 'warning')`)
  src = src.replace(`toast('请输入执行指令', 'warning')`, `toast(t('pages.cron.validate_message'), 'warning')`)
  src = src.replace(`toast('请设置执行周期', 'warning')`, `toast(t('pages.cron.validate_schedule'), 'warning')`)
  src = src.replace(`saveBtn.textContent = '保存中...'`, `saveBtn.textContent = t('pages.cron.saving')`)
  src = src.replace(`toast('任务已更新', 'success')`, `toast(t('pages.cron.toast_updated'), 'success')`)
  src = src.replace(`toast('任务已创建', 'success')`, `toast(t('pages.cron.toast_created'), 'success')`)
  src = src.replace(`toast('保存失败: ' + e, 'error')`, `toast(t('pages.cron.toast_save_fail', { error: e }), 'error')`)
  src = src.replace(`saveBtn.textContent = isEdit ? '保存修改' : '创建'`, `saveBtn.textContent = isEdit ? t('pages.cron.btn_save') : t('pages.cron.btn_create')`)

  // describeCron
  src = src.replace(`if (!expr) return '未知周期'`, `if (!expr) return t('pages.cron.schedule_unknown')`)
  src = src.replace(`if (min === '*' && hr === '*') return '每分钟'`, `if (min === '*' && hr === '*') return t('pages.cron.schedule_every_min')`)
  src = src.replace("if (min.startsWith('*/')) return `每 ${min.slice(2)} 分钟`", "if (min.startsWith('*/')) return t('pages.cron.schedule_every_n_min', { n: min.slice(2) })")
  src = src.replace("if (hr === '*' && min === '0') return '每小时整点'", "if (hr === '*' && min === '0') return t('pages.cron.schedule_hourly')")
  src = src.replace("if (dow !== '*' && dom === '*') return `每周 ${dow} 的 ${hr}:${min.padStart(2, '0')}`", "if (dow !== '*' && dom === '*') return t('pages.cron.schedule_weekly', { dow, time: hr + ':' + min.padStart(2, '0') })")
  src = src.replace("if (dom !== '*') return `每月 ${dom} 号 ${hr}:${min.padStart(2, '0')}`", "if (dom !== '*') return t('pages.cron.schedule_monthly', { dom, time: hr + ':' + min.padStart(2, '0') })")
  src = src.replace("if (hr !== '*') return `每天 ${hr}:${min.padStart(2, '0')}`", "if (hr !== '*') return t('pages.cron.schedule_daily', { time: hr + ':' + min.padStart(2, '0') })")

  // describeCronFull
  src = src.replace(`if (!schedule) return '未知'`, `if (!schedule) return t('pages.cron.schedule_unknown_obj')`)
  src = src.replace("if (ms < 60000) return `每 ${Math.round(ms / 1000)} 秒`", "if (ms < 60000) return t('pages.cron.schedule_every_n_sec', { n: Math.round(ms / 1000) })")
  src = src.replace("if (ms < 3600000) return `每 ${Math.round(ms / 60000)} 分钟`", "if (ms < 3600000) return t('pages.cron.schedule_every_n_min', { n: Math.round(ms / 60000) })")
  src = src.replace("return `每 ${Math.round(ms / 3600000)} 小时`", "return t('pages.cron.schedule_every_n_hour', { n: Math.round(ms / 3600000) })")
  src = src.replace("try { return '一次性: ' + new Date(schedule.at).toLocaleString() }", "try { return t('pages.cron.schedule_once', { time: new Date(schedule.at).toLocaleString() }) }")

  // relativeTime
  src = src.replace(`if (diff < 60000) return '刚刚'`, `if (diff < 60000) return t('pages.cron.relative_just_now')`)
  src = src.replace("if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'", "if (diff < 3600000) return t('pages.cron.relative_min_ago', { n: Math.floor(diff / 60000) })")
  src = src.replace("if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'", "if (diff < 86400000) return t('pages.cron.relative_hour_ago', { n: Math.floor(diff / 3600000) })")
  src = src.replace("return Math.floor(diff / 86400000) + ' 天前'", "return t('pages.cron.relative_day_ago', { n: Math.floor(diff / 86400000) })")

  writeFileSync('src/pages/cron.js', src)
  console.log('Patched cron.js')
}

// ── usage.js ──
{
  let src = readFileSync('src/pages/usage.js', 'utf8')

  // 添加 i18n 导入
  src = src.replace(
    "import { icon } from '../lib/icons.js'",
    "import { icon } from '../lib/icons.js'\nimport { t, getLocale } from '../lib/i18n.js'"
  )

  // page header
  src = src.replace(`<h1 class="page-title">使用情况</h1>`, `<h1 class="page-title">\${t('pages.usage.title')}</h1>`)
  src = src.replace(`<p class="page-desc">查看 Token 消耗、API 费用和模型使用统计</p>`, `<p class="page-desc">\${t('pages.usage.desc')}</p>`)

  // toolbar buttons
  src = src.replace(`data-days="1">今天</button>`, `data-days="1">\${t('pages.usage.btn_today')}</button>`)
  src = src.replace(`data-days="7">7天</button>`, `data-days="7">\${t('pages.usage.btn_7days')}</button>`)
  src = src.replace(`data-days="30">30天</button>`, `data-days="30">\${t('pages.usage.btn_30days')}</button>`)
  src = src.replace(
    `\${icon('refresh-cw', 14)} 刷新</button>`,
    `\${icon('refresh-cw', 14)} \${t('pages.usage.btn_refresh')}</button>`
  )

  // loading / error states
  src = src.replace(
    `<div style="color:var(--text-tertiary);margin-bottom:8px">Gateway 连接中...</div>`,
    `<div style="color:var(--text-tertiary);margin-bottom:8px">\${t('pages.usage.gw_connecting')}</div>`
  )
  src = src.replace(
    `<div class="form-hint">等待 Gateway 连接就绪后自动加载</div>`,
    `<div class="form-hint">\${t('pages.usage.gw_connecting_hint')}</div>`
  )
  src = src.replace(
    `<div style="color:var(--error);margin-bottom:8px">加载失败: \${esc(e?.message || e)}</div>`,
    `<div style="color:var(--error);margin-bottom:8px">\${t('pages.usage.load_fail', { error: esc(e?.message || e) })}</div>`
  )
  src = src.replace(
    `<div class="form-hint">可能需要更新 OpenClaw 到 2026.3.11+ 以支持 Usage API</div>`,
    `<div class="form-hint">\${t('pages.usage.load_fail_hint')}</div>`
  )
  src = src.replace(
    `>重试</button>`,
    `>\${t('pages.usage.btn_retry')}</button>`
  )
  src = src.replace(
    `if (!data) { el.innerHTML = '<div class="usage-empty">暂无数据</div>'; return }`,
    `if (!data) { el.innerHTML = '<div class="usage-empty">' + t('pages.usage.no_data') + '</div>'; return }`
  )

  // stat cards
  src = src.replace(`<span class="stat-card-label">消息</span>`, `<span class="stat-card-label">\${t('pages.usage.card_messages')}</span>`)
  src = src.replace(`<div class="stat-card-meta">\${msgs.user || 0} 用户 · \${msgs.assistant || 0} 助手</div>`,
    `<div class="stat-card-meta">\${t('pages.usage.meta_user', { n: msgs.user || 0 })} · \${t('pages.usage.meta_assistant', { n: msgs.assistant || 0 })}</div>`)
  src = src.replace(`<span class="stat-card-label">工具调用</span>`, `<span class="stat-card-label">\${t('pages.usage.card_tool_calls')}</span>`)
  src = src.replace(`<div class="stat-card-meta">\${tools.uniqueTools || 0} 种工具</div>`,
    `<div class="stat-card-meta">\${t('pages.usage.meta_tools', { n: tools.uniqueTools || 0 })}</div>`)
  src = src.replace(`<span class="stat-card-label">错误</span>`, `<span class="stat-card-label">\${t('pages.usage.card_errors')}</span>`)
  src = src.replace(`<div class="stat-card-meta">错误率 \${fmtRate(msgs.errors, msgs.total)}</div>`,
    `<div class="stat-card-meta">\${t('pages.usage.meta_error_rate', { rate: fmtRate(msgs.errors, msgs.total) })}</div>`)
  src = src.replace(`<span class="stat-card-label">Token 总量</span>`, `<span class="stat-card-label">\${t('pages.usage.card_tokens')}</span>`)
  src = src.replace(`<div class="stat-card-meta">\${fmtTokens(t.input)} 输入 · \${fmtTokens(t.output)} 输出</div>`,
    `<div class="stat-card-meta">\${t('pages.usage.meta_input', { n: fmtTokens(tt.input) })} · \${t('pages.usage.meta_output', { n: fmtTokens(tt.output) })}</div>`)
  src = src.replace(`<span class="stat-card-label">费用</span>`, `<span class="stat-card-label">\${t('pages.usage.card_cost')}</span>`)
  src = src.replace(`<div class="stat-card-meta">\${fmtCost(t.inputCost)} 输入 · \${fmtCost(t.outputCost)} 输出</div>`,
    `<div class="stat-card-meta">\${t('pages.usage.meta_input_cost', { n: fmtCost(tt.inputCost) })} · \${t('pages.usage.meta_output_cost', { n: fmtCost(tt.outputCost) })}</div>`)
  src = src.replace(`<span class="stat-card-label">会话</span>`, `<span class="stat-card-label">\${t('pages.usage.card_sessions')}</span>`)

  // fix variable shadowing: rename const t to const tt in renderUsage
  src = src.replace(`const t = data.totals || {}`, `const tt = data.totals || {}`)
  src = src.replace(`if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'`, `if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'`)
  // replace t. references to tt. in that scope
  src = src.replace(`\${fmtTokens(t.totalTokens)}`, `\${fmtTokens(tt.totalTokens)}`)
  src = src.replace(`\${fmtCost(t.totalCost)}`, `\${fmtCost(tt.totalCost)}`)

  // top sections
  src = src.replace(`const topModels = renderTop('热门模型'`, `const topModels = renderTop(t('pages.usage.top_models')`)
  src = src.replace(`m => m.model || '未知'`, `m => m.model || t('pages.usage.unknown')`)
  src = src.replace(`const topProviders = renderTop('热门服务商'`, `const topProviders = renderTop(t('pages.usage.top_providers')`)
  src = src.replace(`p => p.provider || '未知'`, `p => p.provider || t('pages.usage.unknown')`)
  src = src.replace(`p => fmtCost(p.totals?.totalCost) + ' · ' + p.count + ' 次'`, `p => fmtCost(p.totals?.totalCost) + ' · ' + t('pages.usage.calls_count', { n: p.count })`)
  src = src.replace(`const topTools = renderTop('热门工具'`, `const topTools = renderTop(t('pages.usage.top_tools')`)
  src = src.replace(`t => t.count + ' 次调用'`, `tl => t('pages.usage.calls_suffix', { n: tl.count })`)
  // fix: tool lambda was using `t` which conflicts with i18n t
  src = src.replace(`(tools.tools || []), t => t.name`, `(tools.tools || []), tl => tl.name`)
  src = src.replace(`const topAgents = renderTop('热门 Agent'`, `const topAgents = renderTop(t('pages.usage.top_agents')`)
  src = src.replace(`a => a.agentId || 'main'`, `a => a.agentId || 'main'`)
  src = src.replace(`const topChannels = renderTop('热门渠道'`, `const topChannels = renderTop(t('pages.usage.top_channels')`)
  src = src.replace(`c => c.channel || 'webchat'`, `c => c.channel || 'webchat'`)

  // token breakdown
  src = src.replace(`<div class="config-section-title">Token 分类</div>`, `<div class="config-section-title">\${t('pages.usage.section_token_breakdown')}</div>`)
  src = src.replace(`>输出 \${fmtTokens(t.output)}</div>`, `>\${t('pages.usage.token_output', { n: fmtTokens(tt.output) })}</div>`)
  src = src.replace(`>输入 \${fmtTokens(t.input)}</div>`, `>\${t('pages.usage.token_input', { n: fmtTokens(tt.input) })}</div>`)
  src = src.replace(`>缓存读取 \${fmtTokens(t.cacheRead)}</div>`, `>\${t('pages.usage.token_cache_read', { n: fmtTokens(tt.cacheRead) })}</div>`)
  src = src.replace(`>缓存写入 \${fmtTokens(t.cacheWrite)}</div>`, `>\${t('pages.usage.token_cache_write', { n: fmtTokens(tt.cacheWrite) })}</div>`)

  // daily
  src = src.replace(`<div class="config-section-title">每日用量</div>`, `<div class="config-section-title">\${t('pages.usage.section_daily')}</div>`)

  // sessions
  src = src.replace(
    `<div class="config-section-title">会话明细 <span style="font-weight:normal;color:var(--text-tertiary);font-size:var(--font-size-xs)">最近 \${sessions.length} 个</span></div>`,
    `<div class="config-section-title">\${t('pages.usage.section_sessions')} <span style="font-weight:normal;color:var(--text-tertiary);font-size:var(--font-size-xs)">\${t('pages.usage.sessions_recent', { n: sessions.length })}</span></div>`
  )

  writeFileSync('src/pages/usage.js', src)
  console.log('Patched usage.js')
}

// ── chat-debug.js ──
{
  let src = readFileSync('src/pages/chat-debug.js', 'utf8')

  // 添加 i18n 导入
  src = src.replace(
    "import { icon, statusIcon } from '../lib/icons.js'",
    "import { icon, statusIcon } from '../lib/icons.js'\nimport { t, getLocale } from '../lib/i18n.js'"
  )

  // page header buttons
  src = src.replace(`<h1 class="page-title">系统诊断</h1>`, `<h1 class="page-title">\${t('pages.chat_debug.title')}</h1>`)
  src = src.replace(`<p class="page-desc">全面检测系统状态，快速定位问题</p>`, `<p class="page-desc">\${t('pages.chat_debug.desc')}</p>`)
  src = src.replace(`<button class="btn btn-primary btn-sm" id="btn-refresh">刷新状态</button>`, `<button class="btn btn-primary btn-sm" id="btn-refresh">\${t('pages.chat_debug.btn_refresh')}</button>`)
  src = src.replace(`<button class="btn btn-secondary btn-sm" id="btn-test-ws">测试 WebSocket</button>`, `<button class="btn btn-secondary btn-sm" id="btn-test-ws">\${t('pages.chat_debug.btn_test_ws')}</button>`)
  src = src.replace(`<button class="btn btn-secondary btn-sm" id="btn-network-log">网络日志</button>`, `<button class="btn btn-secondary btn-sm" id="btn-network-log">\${t('pages.chat_debug.btn_network_log')}</button>`)
  src = src.replace(`<button class="btn btn-secondary btn-sm" id="btn-doctor-check">Doctor 诊断</button>`, `<button class="btn btn-secondary btn-sm" id="btn-doctor-check">\${t('pages.chat_debug.btn_doctor_check')}</button>`)
  src = src.replace(`<button class="btn btn-secondary btn-sm" id="btn-doctor-fix">一键修复</button>`, `<button class="btn btn-secondary btn-sm" id="btn-doctor-fix">\${t('pages.chat_debug.btn_doctor_fix')}</button>`)
  src = src.replace(`<button class="btn btn-warning btn-sm" id="btn-fix-pairing">一键修复配对</button>`, `<button class="btn btn-warning btn-sm" id="btn-fix-pairing">\${t('pages.chat_debug.btn_fix_pairing')}</button>`)

  // doctor panel
  src = src.replace(`<div style="font-weight:600;margin-bottom:8px">OpenClaw Doctor</div>`, `<div style="font-weight:600;margin-bottom:8px">\${t('pages.chat_debug.doctor_title')}</div>`)

  // ws test panel
  src = src.replace(
    `<span>WebSocket 连接测试</span>`,
    `<span>\${t('pages.chat_debug.ws_test_title')}</span>`
  )
  src = src.replace(
    `<button class="btn btn-sm" id="btn-clear-log" style="padding:4px 8px;font-size:11px">清空</button>`,
    `<button class="btn btn-sm" id="btn-clear-log" style="padding:4px 8px;font-size:11px">\${t('pages.chat_debug.ws_test_clear')}</button>`
  )

  // network log panel
  src = src.replace(
    `<span>网络请求日志（最近 100 条）</span>`,
    `<span>\${t('pages.chat_debug.network_title')}</span>`
  )
  src = src.replace(
    `<button class="btn btn-sm" id="btn-refresh-network" style="padding:4px 8px;font-size:11px">刷新</button>`,
    `<button class="btn btn-sm" id="btn-refresh-network" style="padding:4px 8px;font-size:11px">\${t('pages.chat_debug.network_refresh')}</button>`
  )
  src = src.replace(
    `<button class="btn btn-sm" id="btn-clear-network" style="padding:4px 8px;font-size:11px">清空</button>`,
    `<button class="btn btn-sm" id="btn-clear-network" style="padding:4px 8px;font-size:11px">\${t('pages.chat_debug.network_clear')}</button>`
  )

  // toLocaleString
  src = src.replaceAll("toLocaleString('zh-CN')", "toLocaleString(getLocale())")
  src = src.replaceAll("toLocaleTimeString('zh-CN'", "toLocaleTimeString(getLocale()")

  // renderDebugInfo - status
  src = src.replace(
    `\${allOk ? \`\${statusIcon('ok')} 系统正常\` : \`\${statusIcon('warn')} 发现问题\`}`,
    `\${allOk ? \`\${statusIcon('ok')} \${t('pages.chat_debug.status_ok')}\` : \`\${statusIcon('warn')} \${t('pages.chat_debug.status_warn')}\`}`
  )
  src = src.replace(
    `\${allOk ? '所有核心功能运行正常' : '部分功能异常，请查看下方详情'}`,
    `\${allOk ? t('pages.chat_debug.status_ok_hint') : t('pages.chat_debug.status_warn_hint')}`
  )

  // section titles
  src = src.replace(`<div class="config-section-title">应用状态</div>`, `<div class="config-section-title">\${t('pages.chat_debug.section_app')}</div>`)
  src = src.replace(`<tr><td>OpenClaw 就绪</td>`, `<tr><td>\${t('pages.chat_debug.app_openclaw_ready')}</td>`)
  src = src.replace(`<tr><td>Gateway 运行中</td>`, `<tr><td>\${t('pages.chat_debug.app_gw_running')}</td>`)

  // ws section
  src = src.replace(`<div class="config-section-title">WebSocket 连接</div>`, `<div class="config-section-title">\${t('pages.chat_debug.section_ws')}</div>`)
  src = src.replace(
    `<tr><td>连接状态</td><td>\${info.wsClient.connected ? \`\${statusIcon('ok')} 已连接\` : \`\${statusIcon('err')} 未连接\`}</td></tr>`,
    `<tr><td>\${t('pages.chat_debug.ws_status')}</td><td>\${info.wsClient.connected ? \`\${statusIcon('ok')} \${t('pages.chat_debug.ws_connected')}\` : \`\${statusIcon('err')} \${t('pages.chat_debug.ws_disconnected')}\`}</td></tr>`
  )
  src = src.replace(
    `<tr><td>握手状态</td><td>\${info.wsClient.gatewayReady ? \`\${statusIcon('ok')} 已完成\` : \`\${statusIcon('err')} 未完成\`}</td></tr>`,
    `<tr><td>\${t('pages.chat_debug.ws_handshake')}</td><td>\${info.wsClient.gatewayReady ? \`\${statusIcon('ok')} \${t('pages.chat_debug.ws_handshake_done')}\` : \`\${statusIcon('err')} \${t('pages.chat_debug.ws_handshake_pending')}\`}</td></tr>`
  )
  src = src.replace(
    `<tr><td>会话密钥</td><td>\${info.wsClient.sessionKey || '(空)'}</td></tr>`,
    `<tr><td>\${t('pages.chat_debug.ws_session_key')}</td><td>\${info.wsClient.sessionKey || t('pages.chat_debug.ws_empty')}</td></tr>`
  )

  // Node section
  src = src.replace(`<div class="config-section-title">Node.js 环境</div>`, `<div class="config-section-title">\${t('pages.chat_debug.section_node')}</div>`)
  src = src.replace(
    `<tr><td>安装状态</td><td>\${info.node.installed ? \`\${statusIcon('ok')} 已安装\` : \`\${statusIcon('err')} 未安装\`}</td></tr>`,
    `<tr><td>\${t('pages.chat_debug.node_installed')}</td><td>\${info.node.installed ? \`\${statusIcon('ok')} \${t('pages.chat_debug.node_installed_yes')}\` : \`\${statusIcon('err')} \${t('pages.chat_debug.node_installed_no')}\`}</td></tr>`
  )
  src = src.replace(
    `<tr><td>版本</td><td>\${info.node.version || '(未知)'}</td></tr>`,
    `<tr><td>\${t('pages.chat_debug.node_version')}</td><td>\${info.node.version || t('pages.chat_debug.node_version_unknown')}</td></tr>`
  )

  // Version section
  src = src.replace(`<div class="config-section-title">版本信息</div>`, `<div class="config-section-title">\${t('pages.chat_debug.section_version')}</div>`)
  src = src.replace(`<tr><td>当前版本</td>`, `<tr><td>\${t('pages.chat_debug.ver_current')}</td>`)
  src = src.replace(`<tr><td>推荐稳定版</td><td>\${info.version.recommended || '(未检测)'}</td></tr>`, `<tr><td>\${t('pages.chat_debug.ver_recommended')}</td><td>\${info.version.recommended || t('pages.chat_debug.ver_recommended_none')}</td></tr>`)
  src = src.replace(`<tr><td>面板版本</td>`, `<tr><td>\${t('pages.chat_debug.ver_panel')}</td>`)
  src = src.replace(`<tr><td>最新上游</td>`, `<tr><td>\${t('pages.chat_debug.ver_latest')}</td>`)
  src = src.replace(
    `<tr><td>偏离推荐版</td><td>\${info.version.ahead_of_recommended ? \`\${statusIcon('warn')} 当前版本过高，建议回退\` : info.version.is_recommended ? \`\${statusIcon('ok')} 已对齐\` : \`\${statusIcon('warn')} 需要切换\`}</td></tr>`,
    `<tr><td>\${t('pages.chat_debug.ver_ahead')}</td><td>\${info.version.ahead_of_recommended ? \`\${statusIcon('warn')} \${t('pages.chat_debug.ver_ahead_yes')}\` : info.version.is_recommended ? \`\${statusIcon('ok')} \${t('pages.chat_debug.ver_ahead_aligned')}\` : \`\${statusIcon('warn')} \${t('pages.chat_debug.ver_ahead_switch')}\`}</td></tr>`
  )
  src = src.replace(
    `<tr><td>最新上游可用</td><td>\${info.version.latest_update_available ? \`\${statusIcon('warn')} 有更新\` : \`\${statusIcon('ok')} 无更新\`}</td></tr>`,
    `<tr><td>\${t('pages.chat_debug.ver_latest_update')}</td><td>\${info.version.latest_update_available ? \`\${statusIcon('warn')} \${t('pages.chat_debug.ver_latest_update_yes')}\` : \`\${statusIcon('ok')} \${t('pages.chat_debug.ver_latest_update_no')}\`}</td></tr>`
  )

  // Config section
  src = src.replace(`<div class="config-section-title">配置文件</div>`, `<div class="config-section-title">\${t('pages.chat_debug.section_config')}</div>`)
  src = src.replace(`<tr><td>OpenClaw 目录</td><td>\${escapeHtml(info.openclawDir?.path || '(未知)')}</td></tr>`,
    `<tr><td>\${t('pages.chat_debug.config_dir')}</td><td>\${escapeHtml(info.openclawDir?.path || t('pages.chat_debug.config_dir_unknown'))}</td></tr>`)

  // Services section
  src = src.replace(`<div class="config-section-title">服务状态</div>`, `<div class="config-section-title">\${t('pages.chat_debug.section_services')}</div>`)
  src = src.replace(
    `<tr><td>CLI 安装</td><td>\${svc.cli_installed !== false ? \`\${statusIcon('ok')} 已安装\` : \`\${statusIcon('err')} 未安装\`}</td></tr>`,
    `<tr><td>\${t('pages.chat_debug.svc_cli')}</td><td>\${svc.cli_installed !== false ? \`\${statusIcon('ok')} \${t('pages.chat_debug.svc_cli_yes')}\` : \`\${statusIcon('err')} \${t('pages.chat_debug.svc_cli_no')}\`}</td></tr>`
  )
  src = src.replace(
    `<tr><td>运行状态</td><td>\${svc.running ? \`\${statusIcon('ok')} 运行中\` : \`\${statusIcon('err')} 已停止\`}</td></tr>`,
    `<tr><td>\${t('pages.chat_debug.svc_running')}</td><td>\${svc.running ? \`\${statusIcon('ok')} \${t('pages.chat_debug.svc_running_yes')}\` : \`\${statusIcon('err')} \${t('pages.chat_debug.svc_running_no')}\`}</td></tr>`
  )
  src = src.replace(`<tr><td>进程 PID</td><td>\${svc.pid || '(无)'}</td></tr>`,
    `<tr><td>\${t('pages.chat_debug.svc_pid')}</td><td>\${svc.pid || t('pages.chat_debug.svc_pid_none')}</td></tr>`)
  src = src.replace(`<tr><td>服务标签</td><td>\${svc.label || '(未知)'}</td></tr>`,
    `<tr><td>\${t('pages.chat_debug.svc_label')}</td><td>\${svc.label || t('pages.chat_debug.svc_label_unknown')}</td></tr>`)

  // Device section
  src = src.replace(`<div class="config-section-title">设备密钥 & 握手签名</div>`, `<div class="config-section-title">\${t('pages.chat_debug.section_device')}</div>`)
  src = src.replace(`<div style="color:var(--success);margin-bottom:8px">\${statusIcon('ok')} 设备密钥生成成功</div>`,
    `<div style="color:var(--success);margin-bottom:8px">\${statusIcon('ok')} \${t('pages.chat_debug.device_ok')}</div>`)
  src = src.replace(`<tr><td>设备 ID</td><td style="font-size:10px;word-break:break-all">\${device?.id || '(无)'}</td></tr>`,
    `<tr><td>\${t('pages.chat_debug.device_id')}</td><td style="font-size:10px;word-break:break-all">\${device?.id || t('pages.chat_debug.device_id_none')}</td></tr>`)
  src = src.replace(`<tr><td>公钥</td>`, `<tr><td>\${t('pages.chat_debug.device_pubkey')}</td>`)
  src = src.replace(`device.publicKey.substring(0, 32) + '...' : '(无)'`, `device.publicKey.substring(0, 32) + '...' : t('pages.chat_debug.device_pubkey_none')`)
  src = src.replace(`<tr><td>签名时间</td><td>\${device?.signedAt || '(无)'}</td></tr>`,
    `<tr><td>\${t('pages.chat_debug.device_signed_at')}</td><td>\${device?.signedAt || t('pages.chat_debug.device_id_none')}</td></tr>`)
  src = src.replace(
    `<summary style="cursor:pointer;color:var(--text-secondary);font-size:12px">查看完整 Connect Frame</summary>`,
    `<summary style="cursor:pointer;color:var(--text-secondary);font-size:12px">\${t('pages.chat_debug.device_view_frame')}</summary>`
  )

  // Advice section
  src = src.replace(`<div class="config-section-title">诊断建议</div>`, `<div class="config-section-title">\${t('pages.chat_debug.section_advice')}</div>`)

  // Check time
  src = src.replace(
    `检测时间: \${info.timestamp}`,
    `\${t('pages.chat_debug.check_time', { time: info.timestamp })}`
  )

  // Doctor
  src = src.replace(
    `content.textContent = fix ? '正在执行 openclaw doctor --fix ...' : '正在执行 openclaw doctor ...'`,
    `content.textContent = fix ? t('pages.chat_debug.doctor_running_fix') : t('pages.chat_debug.doctor_running')`
  )
  src = src.replace(
    `content.textContent = lines.join('\\n') || '无输出'`,
    `content.textContent = lines.join('\\n') || t('pages.chat_debug.doctor_no_output')`
  )
  src = src.replace(
    "content.textContent = `执行失败: ${String(e)}`",
    "content.textContent = t('pages.chat_debug.doctor_fail', { error: String(e) })"
  )

  // network log
  src = src.replace(
    `contentEl.innerHTML = '<div style="color:var(--text-secondary);padding:8px">暂无请求记录</div>'`,
    `contentEl.innerHTML = '<div style="color:var(--text-secondary);padding:8px">' + t('pages.chat_debug.network_empty') + '</div>'`
  )
  src = src.replace(`<span>总请求: <strong>\${total}</strong></span>`,
    `<span>\${t('pages.chat_debug.network_total', { n: total })}</span>`)
  src = src.replace(`<span>缓存命中: <strong>\${cached}</strong></span>`,
    `<span>\${t('pages.chat_debug.network_cached', { n: cached })}</span>`)
  src = src.replace(`<span>平均耗时: <strong>\${avgDuration.toFixed(0)}ms</strong></span>`,
    `<span>\${t('pages.chat_debug.network_avg_time', { n: avgDuration.toFixed(0) })}</span>`)

  // Fix pairing button text
  src = src.replace(
    `fixBtn.textContent = '修复中...'`,
    `fixBtn.textContent = t('pages.chat_debug.btn_fix_pairing') + '...'`
  )
  src = src.replace(
    `fixBtn.textContent = '一键修复配对'`,
    `fixBtn.textContent = t('pages.chat_debug.btn_fix_pairing')`
  )

  writeFileSync('src/pages/chat-debug.js', src)
  console.log('Patched chat-debug.js')
}

console.log('All 4 pages patched successfully')

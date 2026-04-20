/**
 * 消息渠道管理
 * 配置 Telegram / Discord 等外部消息接入，凭证校验后写入 openclaw.json
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { showContentModal, showConfirm } from '../components/modal.js'
import { icon } from '../lib/icons.js'
import { isFeatureAvailable } from '../lib/openclaw-feature-gates.js'
import { t } from '../lib/i18n.js'

// ── 渠道注册表：定义每个支持的消息渠道的元数据和表单规格 ──

const PLATFORM_REGISTRY = {
  qqbot: {
    label: 'QQ 机器人',
    iconName: 'message-square',
    desc: '腾讯官方 OpenClaw QQ 插件，支持多账号与更稳定的凭证结构',
    guide: [
      '使用手机 QQ 扫描二维码，<a href="https://q.qq.com/qqbot/openclaw/login.html" target="_blank" style="color:var(--accent);text-decoration:underline">打开 QQ 机器人开放平台</a> 完成注册登录',
      '点击「创建机器人」，设置机器人名称和头像',
      '创建完成后，在机器人详情页复制 <b>AppID</b> 和 <b>ClientSecret</b>（仅显示一次，请妥善保存）',
      '将 AppID 和 ClientSecret 填入下方表单，点击「校验凭证」验证后保存',
      'Privix 会自动安装腾讯 OpenClaw QQ 插件，并按 <code>channels.qqbot.accounts.default</code> 的新结构写入配置',
    ],
    guideFooter: '<div style="margin-top:8px;font-size:var(--font-size-xs);color:var(--text-tertiary)">详细教程：<a href="https://cloud.tencent.com/developer/article/2626045" target="_blank" style="color:var(--accent);text-decoration:underline">腾讯云 - 快速搭建 AI 私人 QQ 助理</a></div>',
    fields: [
      { key: 'appId', label: 'AppID', placeholder: '如 1903224859', required: true },
      { key: 'clientSecret', label: 'ClientSecret', placeholder: '如 cisldqspngYlyPdc', secret: true, required: true },
    ],
    pluginRequired: '@tencent-connect/openclaw-qqbot@latest',
    pluginSdkPackage: '@openclaw/plugin-sdk/qqbot',
    supportsAccounts: true,
  },
  telegram: {
    label: 'Telegram',
    iconName: 'send',
    desc: '通过 BotFather 创建机器人，用 Bot Token 接入',
    guide: [
      '在 Telegram 中搜索 <a href="https://t.me/BotFather" target="_blank" style="color:var(--accent);text-decoration:underline">@BotFather</a>，发送 <b>/newbot</b> 创建机器人',
      '按提示设置机器人名称和用户名，成功后 BotFather 会返回 <b>Bot Token</b>',
      '获取你的 Telegram 用户 ID：发送消息给 <a href="https://t.me/userinfobot" target="_blank" style="color:var(--accent);text-decoration:underline">@userinfobot</a> 即可查看',
      '将 Bot Token 和用户 ID 填入下方表单，点击「校验凭证」验证后保存',
    ],
    fields: [
      { key: 'botToken', label: 'Bot Token', placeholder: '123456:ABC-DEF...', secret: true, required: true },
      { key: 'allowedUsers', label: '允许的用户 ID', placeholder: '多个用逗号分隔，如 12345, 67890', required: true },
      { key: 'apiEndpoint', label: '自定义 Bot API 端点', placeholder: 'https://api.telegram.org', required: false },
    ],
  },
  feishu: {
    label: '飞书',
    iconName: 'message-square',
    desc: '统一迁移到飞书官方 OpenClaw Lark 插件，支持多账号与文档/日历等生态能力',
    guide: [
      '前往 <a href="https://open.feishu.cn/app" target="_blank" style="color:var(--accent);text-decoration:underline">飞书开放平台</a>，创建企业自建应用，在「应用能力」中添加<b>机器人</b>能力',
      '在<b>凭证与基础信息</b>页面获取 <b>App ID</b> 和 <b>App Secret</b>',
      '进入<b>权限管理</b>，参照 <a href="https://open.larkoffice.com/document/server-docs/application-scope/scope-list" target="_blank" style="color:var(--accent);text-decoration:underline">权限列表</a> 开通所需权限（<code>im:message</code> 等）',
      '进入<b>事件订阅</b>，选择<b>使用长连接（WebSocket）</b>模式，订阅<b>接收消息</b>和<b>卡片回调</b>事件。如有 user access token 开关请打开',
      '将 App ID 和 App Secret 填入下方表单，校验后保存。面板会自动迁移到 <code>@larksuite/openclaw-lark</code>，并禁用旧版插件避免冲突',
      '保存后在飞书中向机器人发消息，获取配对码；你可以直接在下方"配对审批"区域粘贴配对码完成绑定，也可以在终端执行 <code>openclaw pairing approve feishu &lt;配对码&gt; --notify</code>',
    ],
    guideFooter: '<div style="margin-top:8px;font-size:var(--font-size-xs);color:var(--text-tertiary)">国际版 Lark 用户请将域名切换为 <b>lark</b>。详细教程：<a href="https://www.feishu.cn/content/article/7613711414611463386" target="_blank" style="color:var(--accent);text-decoration:underline">OpenClaw 飞书官方插件使用指南</a></div>',
    fields: [
      { key: 'appId', label: 'App ID', placeholder: 'cli_xxxxxxxxxx', required: true },
      { key: 'appSecret', label: 'App Secret', placeholder: '应用密钥', secret: true, required: true },
      { key: 'domain', label: '域名', placeholder: 'feishu（国际版选 lark）', required: false },
    ],
    pluginRequired: '@larksuite/openclaw-lark@latest',
    pluginSdkPackage: '@openclaw/plugin-sdk/feishu',
    pluginId: 'openclaw-lark',
    pairingChannel: 'feishu',
    pairingNotify: true,
    supportsAccounts: true,
  },
  dingtalk: {
    label: '钉钉',
    iconName: 'message-square',
    desc: '钉钉企业内部应用 + 机器人 Stream 模式接入',
    guide: [
      '前往 <a href="https://open-dev.dingtalk.com/" target="_blank" style="color:var(--accent);text-decoration:underline">钉钉开放平台</a> 创建企业内部应用，并添加<b>机器人</b>能力',
      '消息接收模式必须选择 <b>Stream 模式</b>，不要选 Webhook',
      '在<b>凭证与基础信息</b>页面复制 <b>Client ID</b> 和 <b>Client Secret</b>；如 Gateway 开启了鉴权，请按 <code>gateway.auth.mode</code> 填写 <b>Gateway Token</b> 或 <b>Gateway Password</b>',
      '在<b>权限管理</b>中至少确认已开通 <code>Card.Streaming.Write</code>、<code>Card.Instance.Write</code>、<code>qyapi_robot_sendmsg</code>，如需文档能力再补文档相关权限',
      '先在钉钉侧<b>发布应用版本</b>，并确认<b>应用可见范围</b>包含你自己和测试成员；否则私聊或加群时可能搜不到机器人',
      '回到 Privix 保存。首次保存会自动安装插件，后续保存只更新配置；如果本机已配置 Gateway 鉴权，系统会自动带出对应的 Token 或 Password',
      '私聊测试时，可在钉钉客户端搜索应用/机器人名称，或从工作台进入应用后发起对话；若找不到，优先检查“已发布”和“可见范围”',
      '如果机器人首次私聊返回的是<b>配对码</b>，你可以直接在下方“配对审批”区域粘贴配对码完成授权，也可以在终端执行 <code>openclaw pairing approve dingtalk-connector &lt;配对码&gt;</code>',
      '群聊测试时，先进入目标群 → <b>群设置</b> → <b>智能群助手 / 机器人</b> → <b>添加机器人</b>，搜索并添加该机器人；回群后建议用 <code>@机器人</code> 再发消息，如仍不响应再检查连接器的 <code>groupPolicy</code> 是否被设为 <code>disabled</code>',
    ],
    guideFooter: '<div style="margin-top:8px;font-size:var(--font-size-xs);color:var(--text-tertiary)">参考资料：<a href="https://open.dingtalk.com/document/dingstart/install-openclaw-locally" target="_blank" style="color:var(--accent);text-decoration:underline">本地安装 OpenClaw</a>、<a href="https://open.dingtalk.com/document/orgapp/use-group-robots" target="_blank" style="color:var(--accent);text-decoration:underline">添加机器人到钉钉群</a>。排障重点：405 通常是 <code>chatCompletions</code> 未启用，401 通常是 Gateway 鉴权字段不匹配。</div>',
    fields: [
      { key: 'clientId', label: 'Client ID', placeholder: 'dingxxxxxxxxxx', required: true },
      { key: 'clientSecret', label: 'Client Secret', placeholder: '应用密钥', secret: true, required: true },
      { key: 'gatewayToken', label: 'Gateway Token', placeholder: '如已开启 Gateway token 鉴权则填写', required: false },
      { key: 'gatewayPassword', label: 'Gateway Password', placeholder: '与 token 二选一，可选', secret: true, required: false },
    ],
    pluginRequired: '@dingtalk-real-ai/dingtalk-connector',
    pluginSdkPackage: '@openclaw/plugin-sdk/dingtalk',
    pluginId: 'dingtalk-connector',
    pairingChannel: 'dingtalk-connector',
  },
  discord: {
    label: 'Discord',
    iconName: 'message-circle',
    desc: '通过 Discord Developer Portal 创建 Bot 应用接入',
    guide: [
      '前往 <a href="https://discord.com/developers/applications" target="_blank" style="color:var(--accent);text-decoration:underline">Discord Developer Portal</a>，点击 New Application 创建应用',
      '进入应用 → 左侧 <b>Bot</b> 页面 → 点击 Reset Token 生成 Bot Token，并开启 <b>Message Content Intent</b>',
      '左侧 <b>OAuth2</b> → URL Generator，勾选 bot 权限，复制链接将 Bot 邀请到你的服务器',
      '将 Bot Token 和服务器 ID 填入下方表单，点击「校验凭证」验证后保存',
      '（3.24+）可开启「自动讨论串」，每条消息自动创建 Discord Thread，标题由 LLM 生成',
    ],
    fields: [
      { key: 'token', label: 'Bot Token', placeholder: 'MTIz...', secret: true, required: true },
      { key: 'guildId', label: '服务器 ID', placeholder: '右键服务器 → 复制服务器 ID', required: false },
      { key: 'channelId', label: '频道 ID（可选）', placeholder: '不填则监听所有频道', required: false },
      { key: 'autoThread', label: '自动创建讨论串', type: 'toggle', required: false, hint: '启用后每条消息自动创建 Discord 讨论串，标题由 LLM 自动生成（需 OpenClaw 3.24+）', minVersion: '2026.3.24' },
    ],
  },
  weixin: {
    label: '微信',
    iconName: 'message-circle',
    desc: '腾讯微信官方 ClawBot 插件，通过扫码登录完成接入',
    guide: [
      '点击下方「一键安装插件」，安装 <code>@tencent-weixin/openclaw-weixin</code> 官方插件',
      '安装完成后点击「扫码登录」，终端会显示二维码',
      '用手机微信扫描二维码并在手机上确认授权',
      '登录成功后，面板会自动将微信渠道标记为已接入，可继续做 Agent 路由绑定',
      '如遇登录异常，可点击「升级插件」更新到最新版后重试',
    ],
    guideFooter: '<div style="margin-top:8px;font-size:var(--font-size-xs);color:var(--text-tertiary)">来源：<a href="https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin" target="_blank" style="color:var(--accent);text-decoration:underline">npm @tencent-weixin/openclaw-weixin</a></div>',
    panelSupport: 'action-only',
    actions: [
      { id: 'install', label: '一键安装插件', hint: '执行 npx @tencent-weixin/openclaw-weixin-cli install' },
      { id: 'upgrade', label: '升级插件', hint: '重新安装最新版微信插件' },
      { id: 'login', label: '扫码登录', hint: '执行 openclaw channels login --channel openclaw-weixin' },
    ],
  },
}

// ── 页面生命周期 ──

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <h1 class="apple-section">${t('pages.channels.title')}</h1>
      <p class="apple-body-secondary">${t('pages.channels.page_desc')}</p>
    </div>
    <div class="config-section" style="margin-bottom:var(--space-lg)">
      <div class="config-section-title">${t('pages.channels.section_channel_config')}</div>
      <div id="platforms-configured" style="margin-bottom:var(--space-lg)"></div>
      <div class="config-section-title" style="font-size:var(--font-size-sm);color:var(--text-secondary)">${t('pages.channels.section_available')}</div>
      <div id="platforms-available" class="platforms-grid"></div>
    </div>
    <div class="config-section">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:var(--space-sm)">
        <div class="config-section-title" style="margin:0">${t('pages.channels.section_agent_binding')}</div>
        <button class="btn btn-pill-filled" id="btn-add-binding">${icon('plus', 14)} ${t('pages.channels.btn_add_binding')}</button>
      </div>
      <div style="font-size:var(--font-size-xs);color:var(--text-tertiary);margin-bottom:var(--space-sm)">${t('pages.channels.binding_desc')}</div>
      <div id="bindings-panel"></div>
    </div>
  `

  const state = { configured: [] }
  await loadPlatforms(page, state)


  return page
}

export function cleanup() {}

// ── 数据加载 ──

async function loadPlatforms(page, state) {
  try {
    const list = await api.listConfiguredPlatforms()
    state.configured = Array.isArray(list) ? list : []
  } catch (e) {
    toast(t('pages.channels.toast_load_failed', { error: e }), 'error')
    state.configured = []
  }
  try {
    const result = await api.listAllBindings()
    state.bindings = Array.isArray(result?.bindings) ? result.bindings : []
  } catch { state.bindings = [] }
  renderConfigured(page, state)
  renderAvailable(page, state)
  renderBindings(page, state)
  const addBindingBtn = page.querySelector('#btn-add-binding')
  if (addBindingBtn) addBindingBtn.onclick = () => openBindingDialog(page, state)
}

// ── 已配置平台渲染 ──

function renderConfigured(page, state) {
  const el = page.querySelector('#platforms-configured')
  if (!state.configured.length) {
    el.innerHTML = ''
    return
  }

  el.innerHTML = `
    <div class="config-section">
      <div class="config-section-title">${t('pages.channels.section_configured')}</div>
      <div class="platforms-grid">
        ${state.configured.map(p => {
          const reg = PLATFORM_REGISTRY[p.id]
          const label = reg?.label || p.id
          const ic = icon(reg?.iconName || 'radio', 22)
          const accounts = Array.isArray(p.accounts) ? p.accounts : []
          return `
            <div class="platform-card ${p.enabled ? 'active' : 'inactive'}" data-pid="${p.id}">
              <div class="platform-card-header">
                <span class="platform-emoji">${ic}</span>
                <span class="platform-name">${label}</span>
                <span class="platform-status-dot ${p.enabled ? 'on' : 'off'}"></span>
              </div>
              ${accounts.length ? `
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 10px">
                  ${accounts.map(acct => {
                    const bound = findBinding(state.bindings, getChannelBindingKey(p.id), acct.accountId)
                    return `<button class="btn btn-sm btn-secondary" data-action="edit-account" data-account-id="${escapeAttr(acct.accountId)}" style="padding:3px 8px;font-size:11px">
                      ${t('pages.channels.label_account')} ${escapeAttr(acct.accountId)}${bound?.agentId ? ` → ${escapeAttr(bound.agentId)}` : ''}
                    </button>`
                  }).join('')}
                </div>
              ` : ''}
              <div class="platform-card-actions">
                <button class="btn btn-sm btn-secondary" data-action="edit">${icon('edit', 14)} ${t('pages.channels.btn_edit')}</button>
                ${reg?.supportsAccounts ? `<button class="btn btn-sm btn-secondary" data-action="add-account">${icon('plus', 14)} ${t('pages.channels.btn_account')}</button>` : ''}
                <button class="btn btn-sm btn-secondary" data-action="bind">${icon('link', 14)} ${t('pages.channels.btn_bind')}</button>
                <button class="btn btn-sm btn-secondary" data-action="toggle">${p.enabled ? icon('pause', 14) + ' ' + t('pages.channels.btn_disable') : icon('play', 14) + ' ' + t('pages.channels.btn_enable')}</button>
                <button class="btn btn-sm btn-danger" data-action="remove">${icon('trash', 14)}</button>
              </div>
            </div>
          `
        }).join('')}
      </div>
    </div>
  `

  // 绑定事件
  el.querySelectorAll('.platform-card').forEach(card => {
    const pid = card.dataset.pid
    const platformConfig = state.configured.find(p => p.id === pid)
    const accounts = Array.isArray(platformConfig?.accounts) ? platformConfig.accounts : []
    card.querySelector('[data-action="edit"]').onclick = () => {
      if (PLATFORM_REGISTRY[pid]?.supportsAccounts && accounts.length) {
        if (accounts.length === 1) {
          openConfigDialog(pid, page, state, accounts[0].accountId || '')
        } else {
          toast(t('pages.channels.toast_edit_multi_account'), 'warning')
        }
        return
      }
      openConfigDialog(pid, page, state)
    }
    card.querySelector('[data-action="bind"]').onclick = () => openBindingDialog(page, state, { channel: getChannelBindingKey(pid) })
    card.querySelector('[data-action="add-account"]')?.addEventListener('click', () => openConfigDialog(pid, page, state, ''))
    card.querySelectorAll('[data-action="edit-account"]').forEach(btn => {
      btn.addEventListener('click', () => openConfigDialog(pid, page, state, btn.dataset.accountId || ''))
    })
    card.querySelector('[data-action="toggle"]').onclick = async () => {
      const cur = state.configured.find(p => p.id === pid)
      if (!cur) return
      try {
        await api.toggleMessagingPlatform(pid, !cur.enabled)
        toast(t('pages.channels.toast_toggled', { name: PLATFORM_REGISTRY[pid]?.label || pid, action: cur.enabled ? t('pages.channels.btn_disable') : t('pages.channels.btn_enable') }), 'success')
        await loadPlatforms(page, state)
      } catch (e) { toast(t('pages.channels.toast_toggle_failed', { error: e }), 'error') }
    }
    card.querySelector('[data-action="remove"]').onclick = async () => {
      const yes = await showConfirm(t('pages.channels.confirm_remove', { name: PLATFORM_REGISTRY[pid]?.label || pid }))
      if (!yes) return
      try {
        await api.removeMessagingPlatform(pid)
        toast(t('pages.channels.toast_removed'), 'info')
        await loadPlatforms(page, state)
      } catch (e) { toast(t('pages.channels.toast_remove_failed', { error: e }), 'error') }
    }
  })
}

// ── 可接入平台渲染 ──

function renderAvailable(page, state) {
  const el = page.querySelector('#platforms-available')
  const configuredIds = new Set(state.configured.map(p => p.id))

  el.innerHTML = Object.entries(PLATFORM_REGISTRY).map(([pid, reg]) => {
    const done = configuredIds.has(pid)
    return `
      <button class="platform-pick" data-pid="${pid}">
        <span class="platform-emoji">${icon(reg.iconName, 28)}</span>
        <span class="platform-pick-name">${reg.label}</span>
        <span class="platform-pick-desc">${reg.desc}</span>
        ${done ? `<span class="platform-pick-badge" style="color:var(--success)">${t('pages.channels.badge_connected')}</span>` : ''}
      </button>
    `
  }).join('')

  el.querySelectorAll('.platform-pick').forEach(btn => {
    btn.onclick = () => openConfigDialog(btn.dataset.pid, page, state)
  })
}

function openExternalUrl(href) {
  import('@tauri-apps/plugin-shell').then(({ open }) => open(href)).catch(() => window.open(href, '_blank'))
}

function showQqDiagnoseModal(result, { accountId = null, onRepaired = null } = {}) {
  const checks = Array.isArray(result?.checks) ? result.checks : []
  const pluginFailed = checks.some(item => item?.id === 'qq_plugin' && item?.ok === false)
  const faqUrl = result?.faqUrl || 'https://q.qq.com/qqbot/openclaw/faq.html'

  const listHtml = checks.map(item => {
    const ok = item?.ok === true
    return `
      <div style="border:1px solid ${ok ? 'var(--success)' : 'var(--border-primary)'};border-radius:var(--radius-md);padding:12px 14px;background:${ok ? 'var(--success-muted)' : 'var(--bg-tertiary)'};margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:var(--font-size-sm);font-weight:600;color:${ok ? 'var(--success)' : 'var(--text-primary)'}">
          ${ok ? icon('check', 14) : icon('x', 14)}
          <span>${escapeAttr(item?.title || '未命名检查项')}</span>
        </div>
        <div style="font-size:var(--font-size-sm);color:var(--text-secondary);line-height:1.6">${escapeAttr(item?.detail || '')}</div>
      </div>
    `
  }).join('')

  const hintsHtml = (result?.userHints || []).map(hint => `
    <li style="margin-bottom:8px;line-height:1.55">${escapeAttr(hint)}</li>
  `).join('')

  const summaryHtml = result?.overallReady
    ? `<div style="background:var(--success-muted);color:var(--success);padding:10px 14px;border-radius:var(--radius-md);font-size:var(--font-size-sm)">自动化检查均通过：已保存凭证、本机 Gateway、HTTP 健康、QQ 渠道开关、插件与 chatCompletions 都正常。若 QQ 端仍异常，请继续核对官方 FAQ 中的网络、回调和部署项。</div>`
    : `<div style="background:var(--warning-muted, #fffbeb);color:var(--warning);padding:10px 14px;border-radius:var(--radius-md);font-size:var(--font-size-sm)">存在未通过项时，QQ 里常表现为「灵魂不在线」或无法回复。仅“校验凭证”通过并不代表机器人已经在线。</div>`

  const repairHintHtml = pluginFailed
    ? `<div class="form-hint" style="margin-top:10px;line-height:1.55">插件项未通过时，可尝试“一键修复”：自动安装 QQ 插件，或补齐 <code>plugins.allow</code> / <code>plugins.entries.qqbot</code> 后重载 Gateway。</div>`
    : ''

  const buttons = []
  if (pluginFailed) {
    buttons.push({ label: '一键修复（安装/补齐插件）', className: 'btn btn-primary', id: 'btn-diag-repair' })
  }
  buttons.push({
    label: '打开 QQ OpenClaw 常见问题',
    className: pluginFailed ? 'btn btn-secondary' : 'btn btn-primary',
    id: 'btn-diag-faq',
  })

  const modal = showContentModal({
    title: 'QQ 渠道联通诊断',
    content: `
      ${summaryHtml}
      ${repairHintHtml}
      <div style="max-height:min(52vh,420px);overflow-y:auto;margin:12px 0">${listHtml || '<div style="color:var(--text-tertiary);font-size:var(--font-size-sm)">暂无可展示的检查结果</div>'}</div>
      <div style="font-weight:600;margin-bottom:8px;font-size:var(--font-size-sm)">说明</div>
      <ul style="padding-left:18px;margin:0;font-size:var(--font-size-sm);color:var(--text-secondary)">${hintsHtml}</ul>
    `,
    buttons,
    width: 560,
  })

  modal.querySelector('#btn-diag-faq')?.addEventListener('click', () => openExternalUrl(faqUrl))
  modal.querySelector('#btn-diag-repair')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget
    if (!btn) return
    const prev = btn.innerHTML
    try {
      btn.disabled = true
      btn.textContent = '处理中...'
      const output = await api.repairQqbotChannelSetup()
      if (typeof onRepaired === 'function') await onRepaired()
      const fresh = await api.diagnoseChannel('qqbot', accountId)
      modal.close?.() || modal.remove?.()
      toast(output?.message || '修复完成', 'success')
      showQqDiagnoseModal(fresh, { accountId, onRepaired })
    } catch (e) {
      toast('一键修复失败: ' + e, 'error')
    } finally {
      btn.disabled = false
      btn.innerHTML = prev
    }
  })
}

// ── 配置弹窗（新增 / 编辑共用） ──

async function openConfigDialog(pid, page, state, accountId = null) {
  const reg = PLATFORM_REGISTRY[pid]
  if (!reg) { toast(t('pages.channels.toast_unknown_platform'), 'error'); return }

  if (reg.panelSupport === 'action-only') {
    const content = `
      ${reg.guide?.length ? `
        <details open style="background:var(--bg-tertiary);padding:12px 16px;border-radius:var(--radius-md);margin-bottom:var(--space-md)">
          <summary style="font-weight:600;font-size:var(--font-size-sm);cursor:pointer;user-select:none">${t('pages.channels.guide_title')}</summary>
          <ol style="margin:8px 0 0;padding-left:20px;font-size:var(--font-size-sm);color:var(--text-secondary);line-height:1.8">
            ${reg.guide.map(s => `<li>${s}</li>`).join('')}
          </ol>
          ${reg.guideFooter || ''}
        </details>` : ''}
      <div id="weixin-plugin-status" style="padding:10px 14px;background:var(--bg-tertiary);border-radius:var(--radius-md);margin-bottom:var(--space-sm);font-size:var(--font-size-sm);color:var(--text-secondary)">${t('pages.channels.plugin_checking')}</div>
      <div style="padding:12px 14px;background:var(--bg-tertiary);border-radius:var(--radius-md)">
        <div style="font-weight:600;font-size:var(--font-size-sm);margin-bottom:8px">${t('pages.channels.action_title')}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${reg.actions.map(action => `<button type="button" class="btn btn-sm btn-primary" data-channel-action="${action.id}">${action.label}</button>`).join('')}
        </div>
        ${reg.actions.map(action => action.hint ? `<div class="form-hint" style="margin-top:6px">${action.label}：${action.hint}</div>` : '').join('')}
        <div id="channel-action-result" style="margin-top:10px"></div>
      </div>
    `
    const modal = showContentModal({
      title: t('pages.channels.config_title_new', { name: reg.label }),
      content,
      buttons: [{ label: t('pages.channels.btn_close'), className: 'btn btn-secondary', id: 'btn-close' }],
      width: 560,
    })
    modal.querySelector('#btn-close')?.addEventListener('click', () => modal.close?.() || modal.remove?.())
    modal.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]')
      if (!a) return
      const href = a.getAttribute('href')
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        e.preventDefault()
        import('@tauri-apps/plugin-shell').then(({ open }) => open(href)).catch(() => window.open(href, '_blank'))
      }
    })

    const statusEl = modal.querySelector('#weixin-plugin-status')
    api.checkWeixinPluginStatus().then(s => {
      if (!statusEl) return
      if (!s) { statusEl.textContent = t('pages.channels.plugin_check_failed'); return }
      const parts = []
      if (s.installed) {
        parts.push(`<span style="color:var(--success);font-weight:600">● ${t('pages.channels.plugin_installed')}</span>`)
        parts.push(`${t('pages.channels.plugin_version')} <strong>${s.installedVersion || t('pages.channels.plugin_version_unknown')}</strong>`)
        if (s.updateAvailable && s.latestVersion) parts.push(`<span style="color:var(--warning)">→ ${t('pages.channels.plugin_update_available', { version: s.latestVersion })}</span>`)
      } else {
        parts.push(`<span style="color:var(--text-tertiary)">○ ${t('pages.channels.plugin_not_installed')}</span>`)
        if (s.latestVersion) parts.push(t('pages.channels.plugin_latest', { version: s.latestVersion }))
      }
      statusEl.innerHTML = parts.join(' ')
    }).catch(() => {
      if (statusEl) statusEl.textContent = t('pages.channels.plugin_check_failed')
    })

    modal.querySelectorAll('[data-channel-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const actionId = btn.dataset.channelAction
        const resultEl = modal.querySelector('#channel-action-result')
        if (!actionId || !resultEl) return
        btn.disabled = true
        resultEl.innerHTML = `
          <div style="background:var(--bg-secondary);border:1px solid var(--border-primary);border-radius:var(--radius-md);padding:12px">
            <div style="font-size:var(--font-size-sm);font-weight:600;margin-bottom:8px">${t('pages.channels.action_log_title')}</div>
            <pre id="channel-action-log-box" style="margin:0;white-space:pre-wrap;word-break:break-word;font-size:11px;color:var(--text-secondary);font-family:var(--font-mono);max-height:220px;overflow:auto"></pre>
          </div>`
        const logBox = resultEl.querySelector('#channel-action-log-box')
        let unlistenLog = null
        try {
          if (window.__TAURI_INTERNALS__) {
            const { listen } = await import('@tauri-apps/api/event')
            unlistenLog = await listen('channel-action-log', (event) => {
              if (event.payload?.platform !== pid || event.payload?.action !== actionId) return
              if (logBox) {
                logBox.textContent += `${event.payload?.message || ''}\n`
                logBox.scrollTop = logBox.scrollHeight
              }
            })
          }
          const output = await api.runChannelAction(pid, actionId)
          if (logBox && output) {
            if (logBox.textContent && !logBox.textContent.endsWith('\n')) logBox.textContent += '\n'
            logBox.textContent += output
          }
          toast(t('pages.channels.toast_action_done'), 'success')
          await loadPlatforms(page, state)
        } catch (e) {
          if (logBox) logBox.textContent += `${logBox.textContent ? '\n' : ''}${t('pages.channels.toast_action_failed', { error: String(e) })}`
          toast(t('pages.channels.toast_action_failed', { error: e }), 'error')
        } finally {
          btn.disabled = false
          if (unlistenLog) unlistenLog()
        }
      })
    })
    return
  }

  let existing = {}
  let isEdit = false
  let agents = []
  const effectiveAccountId = (accountId || '').trim()
  const bindingChannel = getChannelBindingKey(pid)
  const currentBindingEntry = findBinding(state.bindings, bindingChannel, effectiveAccountId || null)
  let currentBinding = currentBindingEntry?.agentId || ''

  try {
    const res = await api.readPlatformConfig(pid, effectiveAccountId || null)
    if (res?.values) existing = res.values
    if (res?.exists) isEdit = true
  } catch {}
  try {
    agents = await api.listAgents()
  } catch {}

  const formId = 'platform-form-' + Date.now()
  const agentOptions = agents.map(a => {
    const label = a.identityName ? a.identityName.split(',')[0].trim() : a.id
    return `<option value="${escapeAttr(a.id)}" ${a.id === currentBinding ? 'selected' : ''}>${a.id}${a.id !== label ? ' — ' + label : ''}</option>`
  }).join('')
  const accountFieldHtml = reg.supportsAccounts ? `
    <div class="form-group">
      <label class="form-label">账号标识</label>
      <input class="form-input" name="__accountId" value="${escapeAttr(effectiveAccountId)}" placeholder="留空时使用默认账号（如 default）">
      <div class="form-hint">用于多账号接入。QQ/飞书会保存到 <code>accounts.&lt;账号标识&gt;</code> 下。</div>
    </div>
  ` : ''
  const agentBindingHtml = `
    <div class="form-group">
      <label class="form-label">绑定 Agent</label>
      <select class="form-input" name="__agentBinding">
        <option value="" ${!currentBinding ? 'selected' : ''}>默认（不额外写入绑定）</option>
        ${agentOptions}
      </select>
      <div class="form-hint">接入完成后可直接把该渠道或账号路由到指定 Agent。</div>
    </div>
  `

  // 版本门控：每次打开表单时重新检查，不持久修改注册表对象
  const hiddenKeys = new Set()
  for (const f of reg.fields) {
    if (f.minVersion && !(await isFeatureAvailable(f.minVersion))) {
      hiddenKeys.add(f.key)
    }
  }

  const fieldsHtml = reg.fields.filter(f => !hiddenKeys.has(f.key)).map((f, i) => {
    const val = existing[f.key] || ''
    if (f.type === 'toggle') {
      const checked = val === true || val === 'true'
      return `
        <div class="form-group" data-gate-field="${f.key}">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" name="${f.key}" data-type="toggle" ${checked ? 'checked' : ''} style="width:16px;height:16px">
            <span class="form-label" style="margin:0">${f.label}</span>
          </label>
          ${f.hint ? `<div class="form-hint">${f.hint}</div>` : ''}
        </div>
      `
    }
    return `
      <div class="form-group">
        <label class="form-label">${f.label}${f.required ? ' *' : ''}</label>
        <div style="display:flex;gap:8px">
          <input class="form-input" name="${f.key}" type="${f.secret ? 'password' : 'text'}"
                 value="${escapeAttr(val)}" placeholder="${f.placeholder || ''}"
                 ${i === 0 && !reg.supportsAccounts ? 'autofocus' : ''} style="flex:1">
          ${f.secret ? `<button type="button" class="btn btn-sm btn-secondary toggle-vis" data-field="${f.key}">显示</button>` : ''}
        </div>
      </div>
    `
  }).join('')

  const guideHtml = reg.guide?.length ? `
    <details style="background:var(--bg-tertiary);padding:12px 16px;border-radius:var(--radius-md);margin-bottom:var(--space-md)">
      <summary style="font-weight:600;font-size:var(--font-size-sm);cursor:pointer;user-select:none">接入步骤 <span style="color:var(--text-tertiary);font-weight:400">（点击展开）</span></summary>
      <ol style="margin:8px 0 0;padding-left:20px;font-size:var(--font-size-sm);color:var(--text-secondary);line-height:1.8">
        ${reg.guide.map(s => `<li>${s}</li>`).join('')}
      </ol>
      ${reg.guideFooter || ''}
    </details>
  ` : ''
  const pairingHtml = reg.pairingChannel ? `
    <div style="margin-top:var(--space-md);padding:12px 14px;background:var(--bg-tertiary);border-radius:var(--radius-md)">
      <div style="font-weight:600;font-size:var(--font-size-sm);margin-bottom:6px">配对审批</div>
      <div style="font-size:var(--font-size-xs);color:var(--text-secondary);line-height:1.7;margin-bottom:8px">当机器人提示 <code>Pairing code</code> 或要求执行 <code>openclaw pairing approve</code> 时，可直接在这里完成批准。</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input class="form-input" name="pairingCode" placeholder="例如 R3ZFPWZP" style="flex:1;min-width:180px">
        <button type="button" class="btn btn-sm btn-secondary" id="btn-pairing-list">查看待审批</button>
        <button type="button" class="btn btn-sm btn-primary" id="btn-pairing-approve">批准配对码</button>
      </div>
      <div id="pairing-result" style="margin-top:8px"></div>
    </div>
  ` : ''

  const content = `
    ${guideHtml}
    ${isEdit ? `<div style="background:var(--accent-muted);color:var(--accent);padding:8px 14px;border-radius:var(--radius-md);font-size:var(--font-size-sm);margin-bottom:var(--space-md)">当前已有配置，修改后点击保存即可覆盖</div>` : ''}
    <form id="${formId}">
      ${accountFieldHtml}
      ${fieldsHtml}
      ${agentBindingHtml}
    </form>
    ${pairingHtml}
    <div id="verify-result" style="margin-top:var(--space-sm)"></div>
    ${pid === 'qqbot' ? `
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border-primary)">
        <button type="button" class="btn btn-sm btn-secondary" id="btn-qq-full-diagnose">${icon('zap', 14)} 完整联通诊断</button>
        <div class="form-hint" style="margin-top:8px;line-height:1.55">检查已保存到配置文件的凭证、本机 Gateway 端口、HTTP 健康、QQ 插件和 chatCompletions。QQ 提示「灵魂不在线」时优先看这里。</div>
      </div>
    ` : ''}
    ${reg.pluginId ? `
      <div style="margin-top:12px;padding:12px 14px;background:var(--bg-tertiary);border-radius:var(--radius-md)">
        <div style="font-weight:600;font-size:var(--font-size-sm);margin-bottom:6px">插件版本</div>
        <div id="channel-plugin-version-status" style="font-size:var(--font-size-sm);color:var(--text-secondary)">检测中...</div>
        <div id="channel-plugin-version-actions" style="margin-top:8px;display:none">
          <button type="button" class="btn btn-sm btn-primary" id="btn-upgrade-plugin">升级到最新版</button>
        </div>
      </div>
    ` : ''}
  `

  const modal = showContentModal({
    title: `${isEdit ? '编辑' : '接入'} ${reg.label}`,
    content,
    buttons: [
      { label: '校验凭证', className: 'btn btn-secondary', id: 'btn-verify' },
      { label: isEdit ? '保存' : '接入并保存', className: 'btn btn-primary', id: 'btn-save' },
    ],
    width: 560,
  })

  modal.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]')
    if (!a) return
    const href = a.getAttribute('href')
    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      e.preventDefault()
      openExternalUrl(href)
    }
  })

  if (pid === 'qqbot') {
    modal.querySelector('#btn-qq-full-diagnose')?.addEventListener('click', async (event) => {
      const btn = event.currentTarget
      if (!btn) return
      const prev = btn.innerHTML
      try {
        btn.disabled = true
        btn.textContent = '诊断中...'
        const result = await api.diagnoseChannel('qqbot', effectiveAccountId || null)
        showQqDiagnoseModal(result, {
          accountId: effectiveAccountId || null,
          onRepaired: () => loadPlatforms(page, state),
        })
      } catch (e) {
        toast('诊断失败: ' + e, 'error')
      } finally {
        btn.disabled = false
        btn.innerHTML = prev
      }
    })
  }

  // 插件版本检测（飞书、钉钉等带 pluginId 的渠道）
  if (reg.pluginId && reg.pluginRequired) {
    const versionEl = modal.querySelector('#channel-plugin-version-status')
    const actionsEl = modal.querySelector('#channel-plugin-version-actions')
    const npmPkg = reg.pluginRequired.replace(/@latest$/, '').replace(/@[\d.]+$/, '')
    api.checkPluginVersionStatus(reg.pluginId, npmPkg).then(s => {
      if (!versionEl) return
      if (!s) { versionEl.textContent = '插件状态检测失败'; return }
      const parts = []
      if (s.installed) {
        parts.push(`<span style="color:var(--success);font-weight:600">● 已安装</span>`)
        parts.push(`版本 <strong>${s.installedVersion || '未知'}</strong>`)
        if (s.updateAvailable && s.latestVersion) {
          parts.push(`<span style="color:var(--warning)">→ 新版 ${s.latestVersion} 可用</span>`)
          if (actionsEl) actionsEl.style.display = ''
        }
      } else {
        parts.push(`<span style="color:var(--text-tertiary)">○ 未安装</span>`)
        if (s.latestVersion) parts.push(`最新版 ${s.latestVersion}`)
      }
      versionEl.innerHTML = parts.join(' ')
    }).catch(() => {
      if (versionEl) versionEl.textContent = '插件状态检测失败'
    })

    modal.querySelector('#btn-upgrade-plugin')?.addEventListener('click', async () => {
      const btn = modal.querySelector('#btn-upgrade-plugin')
      if (!btn) return
      btn.disabled = true
      btn.textContent = '升级中...'
      try {
        await api.installChannelPlugin(reg.pluginRequired, reg.pluginId)
        toast(`${reg.label} 插件升级完成`, 'success')
        if (versionEl) versionEl.innerHTML = '<span style="color:var(--success);font-weight:600">● 已升级到最新版</span>'
        if (actionsEl) actionsEl.style.display = 'none'
      } catch (e) {
        toast(`插件升级失败: ${e}`, 'error')
      } finally {
        btn.disabled = false
        btn.textContent = '升级到最新版'
      }
    })
  }

  modal.querySelectorAll('.toggle-vis').forEach(btn => {
    btn.onclick = () => {
      const input = modal.querySelector(`input[name="${btn.dataset.field}"]`)
      if (!input) return
      const show = input.type === 'password'
      input.type = show ? 'text' : 'password'
      btn.textContent = show ? '隐藏' : '显示'
    }
  })

  const collectForm = () => {
    const obj = {}
    reg.fields.forEach(f => {
      if (hiddenKeys.has(f.key)) return
      const el = modal.querySelector(`input[name="${f.key}"]`)
      if (!el) return
      if (f.type === 'toggle' || el.dataset.type === 'toggle') {
        obj[f.key] = el.checked
      } else {
        obj[f.key] = el.value.trim()
      }
    })
    return obj
  }

  const btnVerify = modal.querySelector('#btn-verify')
  const btnSave = modal.querySelector('#btn-save')
  const resultEl = modal.querySelector('#verify-result')
  const pairingInput = modal.querySelector('input[name="pairingCode"]')
  const pairingResultEl = modal.querySelector('#pairing-result')
  const btnPairingList = modal.querySelector('#btn-pairing-list')
  const btnPairingApprove = modal.querySelector('#btn-pairing-approve')

  btnPairingList?.addEventListener('click', async () => {
    if (!pairingResultEl) return
    btnPairingList.disabled = true
    btnPairingList.textContent = '读取中...'
    pairingResultEl.innerHTML = ''
    try {
      const output = await api.pairingListChannel(reg.pairingChannel)
      pairingResultEl.innerHTML = `
        <div style="background:var(--bg-secondary);border:1px solid var(--border-primary);border-radius:var(--radius-md);padding:10px 12px">
          <div style="font-size:var(--font-size-xs);color:var(--text-tertiary);margin-bottom:6px">待审批请求</div>
          <pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-size:12px;color:var(--text-secondary);font-family:var(--font-mono)">${escapeAttr(output || '暂无待审批请求')}</pre>
        </div>`
    } catch (e) {
      pairingResultEl.innerHTML = `<div style="color:var(--error);font-size:var(--font-size-sm)">读取失败: ${escapeAttr(String(e))}</div>`
    } finally {
      btnPairingList.disabled = false
      btnPairingList.textContent = '查看待审批'
    }
  })

  btnPairingApprove?.addEventListener('click', async () => {
    if (!pairingInput || !pairingResultEl) return
    const code = pairingInput.value.trim().toUpperCase()
    if (!code) {
      toast('请输入配对码', 'warning')
      pairingInput.focus()
      return
    }
    btnPairingApprove.disabled = true
    btnPairingApprove.textContent = '批准中...'
    pairingResultEl.innerHTML = ''
    try {
      const output = await api.pairingApproveChannel(reg.pairingChannel, code, !!reg.pairingNotify)
      pairingResultEl.innerHTML = `
        <div style="background:var(--success-muted);color:var(--success);padding:10px 14px;border-radius:var(--radius-md);font-size:var(--font-size-sm)">
          ${icon('check', 14)} 配对已批准
          <div style="margin-top:6px;font-size:12px;white-space:pre-wrap;word-break:break-word;color:var(--text-secondary)">${escapeAttr(output || '操作完成')}</div>
        </div>`
      pairingInput.value = ''
      toast('配对已批准', 'success')
    } catch (e) {
      pairingResultEl.innerHTML = `<div style="background:var(--error-muted, #fee2e2);color:var(--error);padding:10px 14px;border-radius:var(--radius-md);font-size:var(--font-size-sm)">批准失败: ${escapeAttr(String(e))}</div>`
    } finally {
      btnPairingApprove.disabled = false
      btnPairingApprove.textContent = '批准配对码'
    }
  })

  btnVerify.onclick = async () => {
    const form = collectForm()
    for (const f of reg.fields) {
      if (f.required && !form[f.key]) {
        toast(`请填写「${f.label}」`, 'warning')
        return
      }
    }
    btnVerify.disabled = true
    btnVerify.textContent = '校验中...'
    resultEl.innerHTML = ''
    try {
      const res = await api.verifyBotToken(pid, form)
      if (res.valid) {
        const details = (res.details || []).join(' · ')
        resultEl.innerHTML = `
          <div style="background:var(--success-muted);color:var(--success);padding:10px 14px;border-radius:var(--radius-md);font-size:var(--font-size-sm)">${icon('check', 14)} 凭证有效${details ? ' — ' + details : ''}</div>
          ${pid === 'qqbot' ? `<div class="form-hint" style="margin-top:8px;line-height:1.55">此项只验证 AppID / ClientSecret 能否向腾讯换 token，不能代表 QQ 里的机器人已在线；若提示「灵魂不在线」，请继续使用上方“完整联通诊断”。</div>` : ''}
        `
      } else {
        const errs = (res.errors || ['校验失败']).join('<br>')
        resultEl.innerHTML = `<div style="background:var(--error-muted, #fee2e2);color:var(--error);padding:10px 14px;border-radius:var(--radius-md);font-size:var(--font-size-sm)">${icon('x', 14)} ${errs}</div>`
      }
    } catch (e) {
      resultEl.innerHTML = `<div style="color:var(--error);font-size:var(--font-size-sm)">校验请求失败: ${e}</div>`
    } finally {
      btnVerify.disabled = false
      btnVerify.textContent = '校验凭证'
    }
  }

  btnSave.onclick = async () => {
    const form = collectForm()
    for (const f of reg.fields) {
      if (f.required && !form[f.key]) {
        toast(`请填写「${f.label}」`, 'warning')
        return
      }
    }
    const nextAccountId = reg.supportsAccounts
      ? (modal.querySelector('input[name="__accountId"]')?.value || '').trim()
      : ''
    const selectedAgent = (modal.querySelector('select[name="__agentBinding"]')?.value || '').trim()
    const configuredAccounts = Array.isArray(state.configured.find(p => p.id === pid)?.accounts)
      ? state.configured.find(p => p.id === pid).accounts
      : []

    if (reg.supportsAccounts && pid !== 'qqbot' && !nextAccountId && (effectiveAccountId || configuredAccounts.length > 0)) {
      toast('已有多账号配置时，请填写账号标识，避免覆盖渠道根配置', 'warning')
      return
    }

    btnSave.disabled = true
    btnVerify.disabled = true
    btnSave.textContent = '保存中...'

    try {
      if (reg.pluginRequired) {
        const pluginPackage = reg.pluginRequired
        const pluginId = reg.pluginId || pid
        const pluginStatus = await api.getChannelPluginStatus(pluginId)
        if (!pluginStatus?.installed && !pluginStatus?.builtin) {
          btnSave.textContent = '安装插件中...'
          resultEl.innerHTML = `
            <div style="background:var(--bg-tertiary);border-radius:var(--radius-md);padding:12px;margin-top:var(--space-sm)">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">${icon('download', 14)}<span style="font-size:var(--font-size-sm);font-weight:600">安装插件</span></div>
              <pre id="plugin-log-box" style="margin:0;white-space:pre-wrap;word-break:break-word;font-size:11px;color:var(--text-secondary);font-family:var(--font-mono);max-height:140px;overflow:auto"></pre>
            </div>`
          const logBox = resultEl.querySelector('#plugin-log-box')
          let unlistenLog = null
          try {
            if (window.__TAURI_INTERNALS__) {
              const { listen } = await import('@tauri-apps/api/event')
              unlistenLog = await listen('plugin-log', (event) => {
                if (!logBox) return
                logBox.textContent += `${event.payload || ''}\n`
                logBox.scrollTop = logBox.scrollHeight
              })
            }
            if (pid === 'qqbot') await api.installQqbotPlugin()
            else await api.installChannelPlugin(pluginPackage, pluginId)
          } finally {
            if (unlistenLog) unlistenLog()
          }
        }
      }

      btnSave.textContent = '写入配置...'
      await api.saveMessagingPlatform(pid, form, nextAccountId || null, null, effectiveAccountId || null)

      if (selectedAgent) {
        await api.saveAgentBinding(selectedAgent, bindingChannel, nextAccountId || null, {})
      }
      if (currentBinding && (currentBinding !== selectedAgent || (effectiveAccountId || '') !== (nextAccountId || ''))) {
        await api.deleteAgentBinding(currentBinding, bindingChannel, effectiveAccountId || null)
      }

      toast(`${reg.label} 配置已保存，Gateway 正在重载`, 'success')
      modal.close?.() || modal.remove?.()
      await loadPlatforms(page, state)
    } catch (e) {
      toast('保存失败: ' + e, 'error')
    } finally {
      btnSave.disabled = false
      btnVerify.disabled = false
      btnSave.textContent = isEdit ? '保存' : '接入并保存'
    }
  }
}

/** 将平台 ID 映射为 openclaw bindings 中的 channel key */
function getChannelBindingKey(pid) {
  const map = {
    qqbot: 'qqbot',
    telegram: 'telegram',
    discord: 'discord',
    feishu: 'feishu',
    dingtalk: 'dingtalk-connector',
    weixin: 'openclaw-weixin',
  }
  return map[pid] || pid
}

function findPlatformIdByChannel(channel) {
  return Object.keys(PLATFORM_REGISTRY).find(pid => getChannelBindingKey(pid) === channel) || channel
}

function findBinding(bindings, channel, accountId = null) {
  return (bindings || []).find(binding => {
    if (binding?.match?.channel !== channel) return false
    return (binding?.match?.accountId || null) === (accountId || null)
  })
}

function renderBindings(page, state) {
  const el = page.querySelector('#bindings-panel')
  if (!el) return
  const bindings = Array.isArray(state.bindings) ? state.bindings : []
  if (!bindings.length) {
    el.innerHTML = `<div style="padding:14px;border:1px dashed var(--border-primary);border-radius:var(--radius-md);color:var(--text-tertiary);font-size:var(--font-size-sm)">暂未配置单独的 Agent 路由。你可以先接入渠道，再为特定账号绑定 Agent。</div>`
    return
  }
  el.innerHTML = `
    <div style="display:grid;gap:10px">
      ${bindings.map(binding => {
        const pid = findPlatformIdByChannel(binding?.match?.channel)
        const reg = PLATFORM_REGISTRY[pid]
        const accountId = binding?.match?.accountId || ''
        const peer = binding?.match?.peer?.id || ''
        return `
          <div class="platform-card" style="padding:14px" data-binding-agent="${escapeAttr(binding?.agentId || '')}" data-binding-channel="${escapeAttr(binding?.match?.channel || '')}" data-binding-account="${escapeAttr(accountId)}">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <span class="platform-emoji">${icon(reg?.iconName || 'radio', 20)}</span>
                <strong>${escapeAttr(reg?.label || binding?.match?.channel || '未知渠道')}</strong>
                <span style="font-size:var(--font-size-xs);color:var(--text-tertiary)">Agent: ${escapeAttr(binding?.agentId || 'main')}</span>
                ${accountId ? `<span style="font-size:var(--font-size-xs);color:var(--accent);background:var(--accent-muted);padding:2px 8px;border-radius:999px">账号 ${escapeAttr(accountId)}</span>` : ''}
                ${peer ? `<span style="font-size:var(--font-size-xs);color:var(--text-tertiary)">peer ${escapeAttr(peer)}</span>` : ''}
              </div>
              <div style="display:flex;gap:8px">
                <button class="btn btn-sm btn-secondary" data-action="edit-binding">${icon('edit', 14)} 编辑</button>
                <button class="btn btn-sm btn-danger" data-action="delete-binding">${icon('trash', 14)}</button>
              </div>
            </div>
          </div>`
      }).join('')}
    </div>
  `

  el.querySelectorAll('[data-action="edit-binding"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('[data-binding-agent]')
      if (!card) return
      openBindingDialog(page, state, {
        agentId: card.dataset.bindingAgent || '',
        channel: card.dataset.bindingChannel || '',
        accountId: card.dataset.bindingAccount || '',
      })
    })
  })
  el.querySelectorAll('[data-action="delete-binding"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('[data-binding-agent]')
      if (!card) return
      const yes = await showConfirm(`确定删除 ${card.dataset.bindingChannel} → ${card.dataset.bindingAgent} 的绑定吗？`)
      if (!yes) return
      try {
        await api.deleteAgentBinding(
          card.dataset.bindingAgent || '',
          card.dataset.bindingChannel || '',
          card.dataset.bindingAccount || null,
        )
        toast('绑定已删除', 'success')
        await loadPlatforms(page, state)
      } catch (e) {
        toast('删除绑定失败: ' + e, 'error')
      }
    })
  })
}

async function openBindingDialog(page, state, initial = {}) {
  let agents = []
  try { agents = await api.listAgents() } catch {}
  const configured = Array.isArray(state.configured) ? state.configured : []
  if (!configured.length) {
    toast('请先接入至少一个消息渠道', 'warning')
    return
  }
  const selectedChannel = initial.channel || (configured[0] ? getChannelBindingKey(configured[0].id) : '')
  const selectedAccount = initial.accountId || ''
  const selectedAgent = initial.agentId || ''

  const content = `
    <div class="form-group">
      <label class="form-label">渠道</label>
      <select class="form-input" name="bindingChannel">
        ${configured.map(item => `<option value="${escapeAttr(getChannelBindingKey(item.id))}" ${getChannelBindingKey(item.id) === selectedChannel ? 'selected' : ''}>${escapeAttr(PLATFORM_REGISTRY[item.id]?.label || item.id)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">账号标识</label>
      <input class="form-input" name="bindingAccountId" value="${escapeAttr(selectedAccount)}" placeholder="可选；多账号场景填写">
      <div class="form-hint">不填则绑定到该渠道的默认入口。</div>
    </div>
    <div class="form-group">
      <label class="form-label">Agent</label>
      <select class="form-input" name="bindingAgentId">
        ${agents.map(agent => {
          const label = agent.identityName ? agent.identityName.split(',')[0].trim() : agent.id
          return `<option value="${escapeAttr(agent.id)}" ${agent.id === selectedAgent ? 'selected' : ''}>${escapeAttr(agent.id)}${agent.id !== label ? ` — ${escapeAttr(label)}` : ''}</option>`
        }).join('')}
      </select>
    </div>
    <div id="binding-result" style="margin-top:var(--space-sm)"></div>
  `

  const modal = showContentModal({
    title: initial.agentId ? '编辑 Agent 绑定' : '新增 Agent 绑定',
    content,
    buttons: [
      { label: initial.agentId ? '保存' : '创建绑定', className: 'btn btn-primary', id: 'btn-save-binding' },
    ],
    width: 500,
  })

  modal.querySelector('#btn-save-binding')?.addEventListener('click', async () => {
    const channel = modal.querySelector('select[name="bindingChannel"]')?.value || ''
    const accountId = (modal.querySelector('input[name="bindingAccountId"]')?.value || '').trim()
    const agentId = modal.querySelector('select[name="bindingAgentId"]')?.value || ''
    const resultEl = modal.querySelector('#binding-result')
    if (!channel || !agentId) {
      toast('请完整选择渠道和 Agent', 'warning')
      return
    }
    try {
      const res = await api.saveAgentBinding(agentId, channel, accountId || null, {})
      if (initial.agentId && (initial.agentId !== agentId || initial.channel !== channel || (initial.accountId || '') !== accountId)) {
        await api.deleteAgentBinding(initial.agentId, initial.channel, initial.accountId || null)
      }
      const warnings = Array.isArray(res?.warnings) ? res.warnings : []
      if (resultEl) {
        resultEl.innerHTML = warnings.length
          ? `<div style="background:var(--warning-muted, #fffbeb);color:var(--warning);padding:10px 12px;border-radius:var(--radius-md);font-size:var(--font-size-sm)">${warnings.map(escapeAttr).join('<br>')}</div>`
          : ''
      }
      toast('绑定已保存', 'success')
      modal.close?.() || modal.remove?.()
      await loadPlatforms(page, state)
    } catch (e) {
      toast('保存绑定失败: ' + e, 'error')
    }
  })
}

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

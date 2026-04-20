/**
 * 空状态引导卡片
 * 当页面无数据时展示的通用引导组件
 */
import { t } from '../lib/i18n.js'
import { icon as svgIcon } from '../lib/icons.js'

const STYLE_ID = 'empty-state-guide-styles'

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .empty-state-guide {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 56px 32px;
      text-align: center;
      animation: empty-state-fadein 400ms cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    @keyframes empty-state-fadein {
      from { opacity: 0; transform: translateY(16px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .empty-state-guide-icon {
      font-size: 48px;
      margin-bottom: 16px;
      line-height: 1;
      filter: drop-shadow(0 2px 8px rgba(90, 114, 238, 0.16));
    }

    .empty-state-guide-title {
      font-size: 17px;
      font-weight: 600;
      color: var(--text-primary, #0F1419);
      margin-bottom: 8px;
      line-height: 1.4;
    }

    .empty-state-guide-desc {
      font-size: 13px;
      color: var(--text-secondary, #4B5563);
      line-height: 1.7;
      margin-bottom: 24px;
      max-width: 360px;
    }

    .empty-state-guide-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: center;
    }

    .empty-state-guide-cta {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 9px 20px;
      background: var(--accent, #5A72EE);
      color: #fff;
      border: none;
      border-radius: var(--radius-lg, 8px);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 180ms ease;
      font-family: var(--font-sans, 'Inter', sans-serif);
      text-decoration: none;
    }
    .empty-state-guide-cta:hover {
      background: var(--accent-hover, #4B63D8);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(90, 114, 238, 0.2);
    }
    .empty-state-guide-cta:active {
      transform: translateY(0);
    }

    .empty-state-guide-secondary {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 9px 20px;
      background: var(--bg-tertiary, #ECEEF2);
      color: var(--text-secondary, #4B5563);
      border: 1px solid var(--border-primary, #E2E5EB);
      border-radius: var(--radius-lg, 8px);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 180ms ease;
      font-family: var(--font-sans, 'Inter', sans-serif);
      text-decoration: none;
    }
    .empty-state-guide-secondary:hover {
      background: var(--bg-card-hover, #F2F4F7);
      color: var(--text-primary, #0F1419);
    }

    /* 紧凑版（内联用） */
    .empty-state-guide.compact {
      padding: 32px 24px;
    }
    .empty-state-guide.compact .empty-state-guide-icon {
      font-size: 36px;
      margin-bottom: 12px;
    }
    .empty-state-guide.compact .empty-state-guide-title {
      font-size: 15px;
    }
    .empty-state-guide.compact .empty-state-guide-desc {
      font-size: 12px;
      margin-bottom: 16px;
    }
  `
  document.head.appendChild(style)
}

/**
 * 生成空状态 HTML 字符串（适用于 innerHTML）
 * @param {Object} options
 * @param {string} options.icon - 图标 emoji
 * @param {string} options.title - 标题
 * @param {string} options.description - 描述文字
 * @param {string} [options.actionText] - 主 CTA 按钮文字
 * @param {string} [options.actionId] - 主 CTA 按钮 id（用于绑定事件）
 * @param {string} [options.secondaryText] - 次要按钮文字
 * @param {string} [options.secondaryId] - 次要按钮 id
 * @param {boolean} [options.compact] - 紧凑模式
 * @returns {string} HTML 字符串
 */
export function emptyStateHTML({
  icon = '📭',
  iconId = null,
  title = '',
  description = '',
  actionText = '',
  actionId = '',
  secondaryText = '',
  secondaryId = '',
  compact = false,
} = {}) {
  injectStyles()
  const displayTitle = title || t('comp_empty_state.default_title')
  const escH = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const actionsHtml = (actionText || secondaryText) ? `
    <div class="empty-state-guide-actions">
      ${actionText ? `<button class="empty-state-guide-cta" ${actionId ? `id="${escH(actionId)}"` : ''}>${escH(actionText)}</button>` : ''}
      ${secondaryText ? `<button class="empty-state-guide-secondary" ${secondaryId ? `id="${escH(secondaryId)}"` : ''}>${escH(secondaryText)}</button>` : ''}
    </div>
  ` : ''

  // iconId 优先（SVG 严肃化），其次 fallback 到 emoji 字符
  const iconHtml = iconId
    ? `<span style="color:var(--accent-blue);display:inline-flex;align-items:center;justify-content:center">${svgIcon(iconId, compact ? 36 : 48)}</span>`
    : escH(icon)

  return `
    <div class="empty-state-guide ${compact ? 'compact' : ''}">
      <div class="empty-state-guide-icon">${iconHtml}</div>
      <div class="empty-state-guide-title">${escH(displayTitle)}</div>
      ${description ? `<div class="empty-state-guide-desc">${escH(description)}</div>` : ''}
      ${actionsHtml}
    </div>
  `
}

/**
 * 挂载空状态组件到容器元素（DOM API 版，带事件绑定）
 * @param {HTMLElement} container - 容器元素
 * @param {Object} options
 * @param {string} options.icon
 * @param {string} options.title
 * @param {string} options.description
 * @param {string} [options.actionText] - 主 CTA 文字
 * @param {Function} [options.actionFn] - 主 CTA 点击回调
 * @param {string} [options.secondaryText] - 次要按钮文字
 * @param {Function} [options.secondaryFn] - 次要按钮点击回调
 * @param {boolean} [options.compact]
 */
export function renderEmptyState(container, options = {}) {
  injectStyles()
  const { actionFn, secondaryFn, ...rest } = options
  const actionId = actionFn ? `empty-cta-${Date.now()}` : ''
  const secondaryId = secondaryFn ? `empty-sec-${Date.now() + 1}` : ''

  container.innerHTML = emptyStateHTML({ ...rest, actionId, secondaryId })

  if (actionFn && actionId) {
    container.querySelector(`#${actionId}`)?.addEventListener('click', actionFn)
  }
  if (secondaryFn && secondaryId) {
    container.querySelector(`#${secondaryId}`)?.addEventListener('click', secondaryFn)
  }
}

// ── 预设空状态配置 ──

export const EMPTY_STATES = {
  // 投资模块
  poolEmpty: {
    icon: '📋',
    iconId: 'clipboard',
    title: '还没有项目线索',
    description: '把感兴趣的项目名、行业和负责人先放进来，不求完整，先把线索录入系统。',
    actionText: '+ 新建项目线索',
  },
  pipelineEmpty: {
    icon: '🔄',
    iconId: 'refresh-cw',
    title: '还没有进行中的 Deal',
    description: '从项目池选择有潜力的项目，转为 Deal 开始正式跟进推进。',
    actionText: '去项目池选择',
  },
  documentsEmpty: {
    icon: '📁',
    iconId: 'folder',
    title: '还没有上传材料',
    description: '把 BP、初评材料、尽调报告等关键文件上传到这里，与 Deal 和审批流联动。',
    actionText: '上传第一份材料',
  },
  workflowsEmpty: {
    icon: '✅',
    iconId: 'check-circle',
    title: '暂无待审批事项',
    description: '材料齐套后可以在 Deal 详情页发起审批流，所有待办会汇总到这里。',
    actionText: '去 Deal 发起审批',
  },
  companiesEmpty: {
    icon: '🏢',
    iconId: 'home',
    title: '还没有企业记录',
    description: '把被投或潜在的企业信息维护在这里，方便与项目和联系人关联。',
    actionText: '新建企业',
  },
  contactsEmpty: {
    icon: '👥',
    iconId: 'users',
    title: '还没有联系人',
    description: '维护创始人、FA 和投后对接人等联系人信息，方便在 Deal 中快速关联。',
    actionText: '新建联系人',
  },
  // AI 模块
  agentsEmpty: {
    icon: '🦞',
    iconId: 'lobster-claw',
    title: '还没有 Agent',
    description: '创建第一只 Agent，给它一个独立身份和模型，让它从"平台已安装"变成"角色已诞生"。',
    actionText: '聊天新建 Agent',
    secondaryText: '高级向导',
  },
  modelsEmpty: {
    icon: '🧠',
    iconId: 'brain',
    title: '还没有配置模型',
    description: '添加至少一个 AI 模型服务商，这是 Agent 获得推理能力的前提。',
    actionText: '一键导入推荐配置',
    secondaryText: '手动添加',
  },
  channelsEmpty: {
    icon: '💬',
    iconId: 'message-circle',
    title: '还没有配置消息渠道',
    description: '把 Agent 接入 QQ、Telegram、飞书等外部渠道，让它在你的工作平台上响应消息。',
    actionText: '添加渠道',
  },
  skillsEmpty: {
    icon: '⚡',
    iconId: 'zap',
    title: '还没有可用的 Skill',
    description: 'Skill 是 Agent 可以调用的能力（如代码执行、文件操作等）。检查 OpenClaw 配置来启用。',
    actionText: '查看配置',
  },
}

/**
 * 首次登录欢迎弹窗
 * 首次进入时自动弹出，提供场景选择并启动对应 Spotlight 引导
 */
import { startSpotlight, isGuideCompleted } from './spotlight-guide.js'
import { t } from '../lib/i18n.js'
import { icon } from '../lib/icons.js'

const WELCOMED_KEY = 'clawpanel_welcomed'
const STYLE_ID = 'welcome-modal-styles'

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .welcome-overlay {
      position: fixed;
      inset: 0;
      z-index: 8500;
      background: rgba(10, 15, 28, 0.65);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: welcome-overlay-in 300ms ease forwards;
    }
    @keyframes welcome-overlay-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .welcome-overlay.hiding {
      animation: welcome-overlay-out 250ms ease forwards;
    }
    @keyframes welcome-overlay-out {
      from { opacity: 1; }
      to   { opacity: 0; }
    }

    .welcome-card {
      background: var(--bg-secondary, #fff);
      border: 1px solid var(--border-primary, #E2E5EB);
      border-radius: 16px;
      box-shadow: 0 24px 64px rgba(15, 23, 42, 0.2);
      padding: 40px 40px 32px;
      width: 540px;
      max-width: calc(100vw - 32px);
      animation: welcome-card-in 380ms cubic-bezier(0.34, 1.42, 0.64, 1) forwards;
      transform-origin: center bottom;
    }
    @keyframes welcome-card-in {
      from { opacity: 0; transform: scale(0.88) translateY(20px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }

    .welcome-logo {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
    }
    .welcome-logo-icon {
      width: 64px;
      height: 64px;
      border-radius: 16px;
      background: linear-gradient(135deg, var(--brand-periwinkle, #97A1FF), var(--brand-sky, #8FB3F5));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      box-shadow: 0 8px 24px rgba(90, 114, 238, 0.24);
    }

    .welcome-title {
      text-align: center;
      font-size: 22px;
      font-weight: 700;
      color: var(--text-primary, #0F1419);
      margin-bottom: 8px;
      letter-spacing: -0.3px;
    }
    .welcome-subtitle {
      text-align: center;
      font-size: 13px;
      color: var(--text-secondary, #4B5563);
      margin-bottom: 28px;
      line-height: 1.6;
    }

    .welcome-scenes {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 16px;
    }
    .welcome-scenes.three-col {
      grid-template-columns: repeat(3, 1fr);
    }
    .welcome-scene-card {
      border: 2px solid var(--border-primary, #E2E5EB);
      border-radius: 12px;
      padding: 16px 14px;
      cursor: pointer;
      transition: all 200ms ease;
      background: var(--bg-primary, #F7F8FA);
      text-align: center;
    }
    .welcome-scene-card:hover {
      border-color: var(--accent, #5A72EE);
      background: var(--accent-subtle, rgba(151,161,255,0.08));
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(90, 114, 238, 0.12);
    }
    .welcome-scene-card.selected {
      border-color: var(--accent, #5A72EE);
      background: var(--accent-muted, rgba(151,161,255,0.16));
    }
    .welcome-scene-icon {
      font-size: 28px;
      margin-bottom: 8px;
      display: block;
    }
    .welcome-scene-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary, #0F1419);
      margin-bottom: 4px;
      line-height: 1.3;
    }
    .welcome-scene-desc {
      font-size: 11px;
      color: var(--text-secondary, #4B5563);
      line-height: 1.5;
    }

    .welcome-skip {
      display: block;
      text-align: center;
      font-size: 12px;
      color: var(--text-tertiary, #9CA3AF);
      cursor: pointer;
      background: none;
      border: none;
      padding: 8px;
      width: 100%;
      transition: color 150ms ease;
      font-family: inherit;
    }
    .welcome-skip:hover {
      color: var(--text-secondary, #4B5563);
    }

    .welcome-start-btn {
      display: block;
      width: 100%;
      padding: 12px;
      background: var(--accent, #5A72EE);
      color: #fff;
      border: none;
      border-radius: var(--radius-lg, 8px);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      margin-bottom: 12px;
      transition: background 150ms ease, transform 100ms ease;
      font-family: inherit;
    }
    .welcome-start-btn:hover {
      background: var(--accent-hover, #4B63D8);
      transform: translateY(-1px);
    }
    .welcome-start-btn:active {
      transform: translateY(0);
    }
    .welcome-start-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
  `
  document.head.appendChild(style)
}

// 社区版:仅余 AI(OpenClaw)场景引导
function getScenes() {
  return [{
    id: 'ai',
    icon: '🦞',
    iconId: 'lobster-claw',
    title: t('comp_welcome.scene_ai_title'),
    desc: t('comp_welcome.scene_ai_desc'),
    guideId: 'openclaw_onboarding',
    route: '/setup',
  }]
}

// AI 配置 Spotlight 步骤
const AI_SPOTLIGHT_STEPS = [
  {
    selector: '.page-title',
    title: t('comp_welcome.spotlight_ai_env_title'),
    description: t('comp_welcome.spotlight_ai_env_desc'),
    position: 'bottom',
  },
  {
    selector: '#sidebar',
    title: t('comp_welcome.spotlight_ai_path_title'),
    description: t('comp_welcome.spotlight_ai_path_desc'),
    position: 'right',
  },
]

function dismiss(overlay) {
  overlay.classList.add('hiding')
  setTimeout(() => overlay.remove(), 260)
}

function launchSceneGuide(sceneId) {
  const { navigate } = window.__clawpanel_router || {}
  if (sceneId === 'ai') {
    if (navigate) navigate('/setup')
    setTimeout(() => {
      startSpotlight(AI_SPOTLIGHT_STEPS, {
        guideId: 'openclaw_onboarding',
        onComplete: () => {},
        onSkip: () => {},
      })
    }, 600)
  }
}

/**
 * 检查是否需要显示欢迎弹窗（首次进入）
 */
export function shouldShowWelcome() {
  try { return !localStorage.getItem(WELCOMED_KEY) } catch { return false }
}

/**
 * 标记已欢迎（不再显示）
 */
export function markWelcomed() {
  try { localStorage.setItem(WELCOMED_KEY, '1') } catch {}
}

/**
 * 重置欢迎状态（用于测试或帮助入口）
 */
export function resetWelcome() {
  try { localStorage.removeItem(WELCOMED_KEY) } catch {}
}

/**
 * 显示欢迎弹窗
 * @param {Object} options - { brandName, brandLogoSrc, force }
 */
export function showWelcomeModal(options = {}) {
  injectStyles()

  // 移除已有的
  document.querySelector('.welcome-overlay')?.remove()

  const scenes = getScenes()
  const overlay = document.createElement('div')
  overlay.className = 'welcome-overlay'

  const logoHtml = options.brandLogoSrc
    ? `<img src="${options.brandLogoSrc}" alt="logo" style="width:100%;height:100%;object-fit:contain;border-radius:14px">`
    : `<span style="color:#fff;display:inline-flex;align-items:center;justify-content:center">${icon('lobster-claw', 32)}</span>`

  overlay.innerHTML = `
    <div class="welcome-card">
      <div class="welcome-logo">
        <div class="welcome-logo-icon">${logoHtml}</div>
      </div>
      <div class="welcome-title">${t('comp_welcome.title', { brand: options.brandName || 'Privix' })}</div>
      <div class="welcome-subtitle">${t('comp_welcome.subtitle')}</div>
      <div class="welcome-scenes${scenes.length === 3 ? ' three-col' : ''}">
        ${scenes.map(s => `
          <div class="welcome-scene-card" data-scene="${s.id}">
            <span class="welcome-scene-icon" style="color:var(--accent-blue);display:inline-flex;align-items:center;justify-content:center">${s.iconId ? icon(s.iconId, 32) : s.icon}</span>
            <div class="welcome-scene-title">${s.title}</div>
            <div class="welcome-scene-desc">${s.desc}</div>
          </div>
        `).join('')}
      </div>
      <button class="welcome-start-btn" id="welcome-start-btn" disabled>${t('comp_welcome.btn_start')}</button>
      <button class="welcome-skip">${t('comp_welcome.btn_skip')}</button>
    </div>
  `

  document.body.appendChild(overlay)
  markWelcomed()

  let selectedScene = null

  // 场景选择
  overlay.querySelectorAll('.welcome-scene-card').forEach(card => {
    card.addEventListener('click', () => {
      overlay.querySelectorAll('.welcome-scene-card').forEach(c => c.classList.remove('selected'))
      card.classList.add('selected')
      selectedScene = card.dataset.scene
      overlay.querySelector('#welcome-start-btn').disabled = false
    })
  })

  // 开始引导
  overlay.querySelector('#welcome-start-btn').addEventListener('click', () => {
    if (!selectedScene) return
    dismiss(overlay)
    setTimeout(() => launchSceneGuide(selectedScene), 300)
  })

  // 跳过
  overlay.querySelector('.welcome-skip').addEventListener('click', () => {
    dismiss(overlay)
  })

  // 点击遮罩背景关闭
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismiss(overlay)
  })
}

/**
 * 初始化欢迎流程（在 app 启动后调用）
 * 仅在首次进入时自动弹出
 */
export function initWelcome(options = {}) {
  if (!shouldShowWelcome()) return
  // 延迟一点，等页面渲染完成
  setTimeout(() => showWelcomeModal(options), 1200)
}

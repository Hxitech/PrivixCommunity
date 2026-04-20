/**
 * Spotlight 聚光灯引导系统
 * 提供多步骤的高亮引导，支持遮罩 + 气泡 + 呼吸动画
 */

const SPOTLIGHT_STYLE_ID = 'spotlight-guide-styles'

function injectStyles() {
  if (document.getElementById(SPOTLIGHT_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = SPOTLIGHT_STYLE_ID
  style.textContent = `
    /* ── Spotlight 遮罩 ── */
    .spotlight-overlay {
      position: fixed;
      inset: 0;
      z-index: 9000;
      pointer-events: all;
    }
    .spotlight-overlay canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }

    /* ── 高亮圆环脉冲 ── */
    .spotlight-pulse {
      position: fixed;
      pointer-events: none;
      z-index: 9001;
      border-radius: 8px;
      box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.7), 0 0 0 6px rgba(88, 166, 255, 0.3);
      animation: spotlight-pulse-glow 1.6s ease-in-out infinite;
      transition: all 350ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    @keyframes spotlight-pulse-glow {
      0%   { box-shadow: 0 0 0 3px rgba(88,166,255,0.7), 0 0 0 6px rgba(88,166,255,0.3); }
      50%  { box-shadow: 0 0 0 5px rgba(88,166,255,0.9), 0 0 16px 8px rgba(88,166,255,0.2); }
      100% { box-shadow: 0 0 0 3px rgba(88,166,255,0.7), 0 0 0 6px rgba(88,166,255,0.3); }
    }

    /* ── 说明气泡 ── */
    .spotlight-tooltip {
      position: fixed;
      z-index: 9002;
      background: var(--bg-secondary, #fff);
      border: 1px solid var(--border-primary, #E2E5EB);
      border-radius: var(--radius-xl, 12px);
      box-shadow: 0 8px 32px rgba(15, 23, 42, 0.18);
      padding: 20px 24px;
      min-width: 280px;
      max-width: 340px;
      animation: spotlight-tooltip-in 280ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      transform-origin: center top;
    }
    @keyframes spotlight-tooltip-in {
      from { opacity: 0; transform: scale(0.9) translateY(-8px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }
    .spotlight-tooltip.exiting {
      animation: spotlight-tooltip-out 180ms ease-in forwards;
    }
    @keyframes spotlight-tooltip-out {
      from { opacity: 1; transform: scale(1); }
      to   { opacity: 0; transform: scale(0.92); }
    }

    /* 气泡箭头 */
    .spotlight-tooltip::before {
      content: '';
      position: absolute;
      width: 10px;
      height: 10px;
      background: var(--bg-secondary, #fff);
      border: 1px solid var(--border-primary, #E2E5EB);
      transform: rotate(45deg);
    }
    .spotlight-tooltip.arrow-top::before {
      top: -6px; left: 24px;
      border-bottom: none; border-right: none;
    }
    .spotlight-tooltip.arrow-bottom::before {
      bottom: -6px; left: 24px;
      border-top: none; border-left: none;
    }
    .spotlight-tooltip.arrow-left::before {
      left: -6px; top: 24px;
      border-right: none; border-bottom: none;
      transform: rotate(-45deg);
    }
    .spotlight-tooltip.arrow-right::before {
      right: -6px; top: 24px;
      border-left: none; border-top: none;
      transform: rotate(45deg);
    }

    .spotlight-tooltip-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .spotlight-tooltip-progress {
      font-size: 11px;
      color: var(--text-tertiary, #9CA3AF);
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }
    .spotlight-tooltip-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary, #0F1419);
      margin-bottom: 6px;
      line-height: 1.4;
    }
    .spotlight-tooltip-desc {
      font-size: 13px;
      color: var(--text-secondary, #4B5563);
      line-height: 1.6;
      margin-bottom: 16px;
    }
    .spotlight-tooltip-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .spotlight-tooltip-actions .btn-group {
      display: flex;
      gap: 8px;
    }
    .spotlight-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 6px 14px;
      border-radius: var(--radius-md, 6px);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 150ms ease;
      line-height: 1;
      font-family: var(--font-sans, 'Inter', sans-serif);
    }
    .spotlight-btn-primary {
      background: var(--accent, #5A72EE);
      color: #fff;
      border-color: var(--accent, #5A72EE);
    }
    .spotlight-btn-primary:hover {
      background: var(--accent-hover, #4B63D8);
      border-color: var(--accent-hover, #4B63D8);
    }
    .spotlight-btn-secondary {
      background: var(--bg-tertiary, #ECEEF2);
      color: var(--text-secondary, #4B5563);
      border-color: var(--border-primary, #E2E5EB);
    }
    .spotlight-btn-secondary:hover {
      background: var(--bg-card-hover, #F2F4F7);
      color: var(--text-primary, #0F1419);
    }
    .spotlight-btn-ghost {
      background: transparent;
      color: var(--text-tertiary, #9CA3AF);
      border-color: transparent;
      font-size: 12px;
      padding: 4px 8px;
    }
    .spotlight-btn-ghost:hover {
      color: var(--text-secondary, #4B5563);
    }

    /* 进度点 */
    .spotlight-dots {
      display: flex;
      gap: 5px;
      align-items: center;
    }
    .spotlight-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--border-primary, #E2E5EB);
      transition: all 200ms ease;
    }
    .spotlight-dot.active {
      background: var(--accent, #5A72EE);
      width: 16px;
      border-radius: 3px;
    }
  `
  document.head.appendChild(style)
}

// ── 状态 ──
let _active = false
let _steps = []
let _currentIndex = 0
let _onComplete = null
let _onSkip = null
let _overlayEl = null
let _pulseEl = null
let _tooltipEl = null
let _animFrame = null
let _currentRect = null
let _targetRect = null
let _animProgress = 0
let _animStart = 0

const ANIM_DURATION = 350

function lerp(a, b, t) {
  return a + (b - a) * t
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

function getTargetRect(selector) {
  if (!selector) return null
  const el = document.querySelector(selector)
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return { top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }
}

function drawMask(canvas, rect, animated) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(10, 15, 28, 0.72)'
  ctx.fillRect(0, 0, W, H)

  if (!rect) return

  // 镂空区域
  ctx.globalCompositeOperation = 'destination-out'
  const r = 10
  const { top, left, width, height } = rect
  ctx.beginPath()
  ctx.moveTo(left + r, top)
  ctx.lineTo(left + width - r, top)
  ctx.quadraticCurveTo(left + width, top, left + width, top + r)
  ctx.lineTo(left + width, top + height - r)
  ctx.quadraticCurveTo(left + width, top + height, left + width - r, top + height)
  ctx.lineTo(left + r, top + height)
  ctx.quadraticCurveTo(left, top + height, left, top + height - r)
  ctx.lineTo(left, top + r)
  ctx.quadraticCurveTo(left, top, left + r, top)
  ctx.closePath()
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
}

function resizeCanvas() {
  if (!_overlayEl) return
  const canvas = _overlayEl.querySelector('canvas')
  if (!canvas) return
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
}

function animateMask(timestamp) {
  if (!_active) return
  if (!_animStart) _animStart = timestamp

  const elapsed = timestamp - _animStart
  const t = Math.min(elapsed / ANIM_DURATION, 1)
  const ease = easeOutCubic(t)

  const canvas = _overlayEl?.querySelector('canvas')
  if (canvas && _currentRect && _targetRect) {
    const animRect = {
      top: lerp(_currentRect.top, _targetRect.top, ease),
      left: lerp(_currentRect.left, _targetRect.left, ease),
      width: lerp(_currentRect.width, _targetRect.width, ease),
      height: lerp(_currentRect.height, _targetRect.height, ease),
    }
    drawMask(canvas, animRect)
    if (_pulseEl) {
      _pulseEl.style.top = animRect.top + 'px'
      _pulseEl.style.left = animRect.left + 'px'
      _pulseEl.style.width = animRect.width + 'px'
      _pulseEl.style.height = animRect.height + 'px'
    }
  } else if (canvas && _targetRect) {
    drawMask(canvas, _targetRect)
    if (_pulseEl) {
      _pulseEl.style.top = _targetRect.top + 'px'
      _pulseEl.style.left = _targetRect.left + 'px'
      _pulseEl.style.width = _targetRect.width + 'px'
      _pulseEl.style.height = _targetRect.height + 'px'
    }
  }

  if (t < 1) {
    _animFrame = requestAnimationFrame(animateMask)
  } else {
    _currentRect = _targetRect
    _animFrame = null
  }
}

function positionTooltip(tooltip, targetRect, position) {
  const TW = tooltip.offsetWidth || 320
  const TH = tooltip.offsetHeight || 160
  const margin = 16
  const VP_W = window.innerWidth
  const VP_H = window.innerHeight

  let top, left, arrowClass = 'arrow-top'

  if (!targetRect) {
    top = VP_H / 2 - TH / 2
    left = VP_W / 2 - TW / 2
  } else {
    const { top: tY, left: tX, width: tW, height: tH } = targetRect

    if (position === 'top' || (!position && tY - TH - margin > margin)) {
      top = tY - TH - 16
      left = tX
      arrowClass = 'arrow-bottom'
    } else if (position === 'bottom' || (!position && tY + tH + TH + margin < VP_H)) {
      top = tY + tH + 16
      left = tX
      arrowClass = 'arrow-top'
    } else if (position === 'left' || (!position && tX - TW - margin > margin)) {
      top = tY
      left = tX - TW - 16
      arrowClass = 'arrow-right'
    } else {
      top = tY
      left = tX + tW + 16
      arrowClass = 'arrow-left'
    }

    // 边界修正
    left = Math.max(margin, Math.min(left, VP_W - TW - margin))
    top = Math.max(margin, Math.min(top, VP_H - TH - margin))
  }

  tooltip.style.top = top + 'px'
  tooltip.style.left = left + 'px'
  tooltip.className = `spotlight-tooltip ${arrowClass}`
}

function renderTooltip(stepIndex) {
  const step = _steps[stepIndex]
  const total = _steps.length

  if (_tooltipEl) {
    _tooltipEl.classList.add('exiting')
    const old = _tooltipEl
    setTimeout(() => old.remove(), 200)
  }

  const tooltip = document.createElement('div')
  tooltip.className = 'spotlight-tooltip arrow-top'
  tooltip.innerHTML = `
    <div class="spotlight-tooltip-header">
      <div class="spotlight-dots">
        ${_steps.map((_, i) => `<div class="spotlight-dot ${i === stepIndex ? 'active' : ''}"></div>`).join('')}
      </div>
      <div class="spotlight-tooltip-progress">${stepIndex + 1} / ${total}</div>
    </div>
    <div class="spotlight-tooltip-title">${step.title || ''}</div>
    <div class="spotlight-tooltip-desc">${step.description || ''}</div>
    <div class="spotlight-tooltip-actions">
      <button class="spotlight-btn spotlight-btn-ghost" id="spotlight-skip">跳过引导</button>
      <div class="btn-group">
        ${stepIndex > 0 ? '<button class="spotlight-btn spotlight-btn-secondary" id="spotlight-prev">上一步</button>' : ''}
        <button class="spotlight-btn spotlight-btn-primary" id="spotlight-next">
          ${stepIndex < total - 1 ? '下一步' : '完成'}
        </button>
      </div>
    </div>
  `

  document.body.appendChild(tooltip)
  _tooltipEl = tooltip

  // 先挂 DOM 再计算位置
  requestAnimationFrame(() => {
    positionTooltip(tooltip, _targetRect, step.position)
  })

  tooltip.querySelector('#spotlight-skip')?.addEventListener('click', () => skipGuide())
  tooltip.querySelector('#spotlight-prev')?.addEventListener('click', () => goToStep(stepIndex - 1))
  tooltip.querySelector('#spotlight-next')?.addEventListener('click', () => {
    if (stepIndex < total - 1) goToStep(stepIndex + 1)
    else completeGuide()
  })
}

function goToStep(index) {
  if (index < 0 || index >= _steps.length) return
  _currentIndex = index

  const step = _steps[index]
  const newRect = getTargetRect(step.selector)

  // 滚动到目标元素
  if (step.selector) {
    const el = document.querySelector(step.selector)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // 更新动画起点
  _currentRect = _targetRect
  _targetRect = newRect
  _animStart = 0

  if (_animFrame) cancelAnimationFrame(_animFrame)
  _animFrame = requestAnimationFrame(animateMask)

  renderTooltip(index)
}

function completeGuide() {
  const guideId = _steps._guideId
  if (guideId) {
    try { localStorage.setItem(`clawpanel_guide_completed_${guideId}`, '1') } catch {}
  }
  cleanup()
  _onComplete?.()
}

function skipGuide() {
  cleanup()
  _onSkip?.()
}

function cleanup() {
  _active = false
  if (_animFrame) { cancelAnimationFrame(_animFrame); _animFrame = null }
  if (_tooltipEl) { _tooltipEl.remove(); _tooltipEl = null }
  if (_pulseEl) { _pulseEl.remove(); _pulseEl = null }
  if (_overlayEl) { _overlayEl.remove(); _overlayEl = null }
  window.removeEventListener('resize', handleResize)
}

function handleResize() {
  if (!_active) return
  resizeCanvas()
  const step = _steps[_currentIndex]
  _targetRect = getTargetRect(step?.selector)
  _currentRect = _targetRect
  const canvas = _overlayEl?.querySelector('canvas')
  if (canvas) drawMask(canvas, _targetRect)
  if (_pulseEl && _targetRect) {
    _pulseEl.style.top = _targetRect.top + 'px'
    _pulseEl.style.left = _targetRect.left + 'px'
    _pulseEl.style.width = _targetRect.width + 'px'
    _pulseEl.style.height = _targetRect.height + 'px'
  }
  if (_tooltipEl && _targetRect) {
    const step = _steps[_currentIndex]
    positionTooltip(_tooltipEl, _targetRect, step?.position)
  }
}

/**
 * 启动 Spotlight 引导
 * @param {Array} steps - 步骤数组，每步：{ selector, title, description, position }
 * @param {Object} options - { onComplete, onSkip, guideId }
 */
export function startSpotlight(steps, options = {}) {
  if (_active) cleanup()
  if (!steps?.length) return

  injectStyles()

  _active = true
  _steps = steps
  _steps._guideId = options.guideId || null
  _currentIndex = 0
  _onComplete = options.onComplete || null
  _onSkip = options.onSkip || null
  _currentRect = null
  _targetRect = null

  // 遮罩层
  const overlay = document.createElement('div')
  overlay.className = 'spotlight-overlay'
  const canvas = document.createElement('canvas')
  overlay.appendChild(canvas)
  document.body.appendChild(overlay)
  _overlayEl = overlay

  // 点击遮罩空白处前进
  overlay.addEventListener('click', (e) => {
    if (e.target === canvas) {
      if (_currentIndex < _steps.length - 1) goToStep(_currentIndex + 1)
      else completeGuide()
    }
  })

  // 脉冲环
  const pulse = document.createElement('div')
  pulse.className = 'spotlight-pulse'
  document.body.appendChild(pulse)
  _pulseEl = pulse

  // 初始化 canvas 尺寸
  resizeCanvas()

  // 开始第一步
  const firstStep = steps[0]
  _targetRect = getTargetRect(firstStep.selector)

  if (firstStep.selector) {
    const el = document.querySelector(firstStep.selector)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  if (_targetRect) {
    drawMask(canvas, _targetRect)
    pulse.style.top = _targetRect.top + 'px'
    pulse.style.left = _targetRect.left + 'px'
    pulse.style.width = _targetRect.width + 'px'
    pulse.style.height = _targetRect.height + 'px'
  } else {
    drawMask(canvas, null)
    pulse.style.display = 'none'
  }

  renderTooltip(0)
  window.addEventListener('resize', handleResize)
}

/**
 * 停止当前 Spotlight 引导
 */
export function stopSpotlight() {
  cleanup()
}

/**
 * 检查某个引导是否已完成
 */
export function isGuideCompleted(guideId) {
  try { return localStorage.getItem(`clawpanel_guide_completed_${guideId}`) === '1' } catch { return false }
}

/**
 * 重置某个引导的完成状态
 */
export function resetGuide(guideId) {
  try { localStorage.removeItem(`clawpanel_guide_completed_${guideId}`) } catch {}
}

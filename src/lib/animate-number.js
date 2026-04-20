/**
 * 数字计数器动画工具
 * 在元素中将数字从 0 平滑过渡到目标值
 */

/**
 * 对单个元素执行数字动画
 * @param {HTMLElement} el - 目标元素
 * @param {number} target - 目标数值
 * @param {object} opts
 * @param {number} [opts.duration=600] - 动画时长（ms）
 * @param {Function} [opts.formatter] - 格式化函数，默认直接取整输出
 * @param {number} [opts.from=0] - 起始值
 */
export function animateNumber(el, target, { duration = 600, formatter, from = 0 } = {}) {
  if (!el || isNaN(target)) return
  const fmt = formatter || (v => Math.round(v).toLocaleString())
  const start = performance.now()
  const diff = target - from

  function tick(now) {
    const elapsed = now - start
    const progress = Math.min(elapsed / duration, 1)
    // easeOutQuart
    const eased = 1 - Math.pow(1 - progress, 4)
    el.textContent = fmt(from + diff * eased)
    if (progress < 1) requestAnimationFrame(tick)
  }

  requestAnimationFrame(tick)
}

/**
 * 批量对页面内带 data-animate-number 属性的元素执行动画
 * 属性格式：data-animate-number="<number>" data-animate-format="int|currency|percent"
 * @param {HTMLElement} [root=document] - 查找范围
 * @param {number} [duration=600]
 */
export function animateNumbers(root = document, duration = 600) {
  const els = root.querySelectorAll('[data-animate-number]')
  els.forEach((el, i) => {
    const target = parseFloat(el.dataset.animateNumber)
    if (isNaN(target)) return
    const fmt = el.dataset.animateFormat
    let formatter
    if (fmt === 'currency') {
      formatter = v => '¥' + Math.round(v).toLocaleString()
    } else if (fmt === 'percent') {
      formatter = v => v.toFixed(1) + '%'
    } else if (fmt === 'decimal') {
      const decimals = parseInt(el.dataset.animateDecimals || '1')
      formatter = v => v.toFixed(decimals)
    }
    // 轻微错开多个数字的动画起始时间
    setTimeout(() => animateNumber(el, target, { duration, formatter }), i * 60)
  })
}

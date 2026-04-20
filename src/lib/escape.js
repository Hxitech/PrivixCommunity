/**
 * HTML / 属性转义工具(共享模块)
 *
 * 全局唯一实现,避免各页面各自定义 escapeHtml 导致的不一致和遗漏。
 * 涵盖 &, <, >, ", ' 五种字符(防 XSS)。
 */

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const ESC_RE = /[&<>"']/g

/** 将字符串中的 HTML 特殊字符转义,防止 XSS */
export function escapeHtml(s) {
  return String(s ?? '').replace(ESC_RE, c => ESC_MAP[c])
}

/** 转义用于 HTML 属性值的字符串(与 escapeHtml 等效,语义更明确) */
export function escapeAttr(s) {
  return escapeHtml(s)
}

/** 截断字符串到指定长度,超出部分用省略号替代 */
export function truncate(s, max) {
  const str = String(s ?? '')
  return str.length > max ? `${str.slice(0, max)}…` : str
}

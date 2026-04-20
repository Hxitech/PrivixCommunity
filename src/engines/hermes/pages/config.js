/**
 * Hermes Agent 配置编辑
 */
import { t } from '../../../lib/i18n.js'

export function render() {
  const el = document.createElement('div')
  el.className = 'page'
  el.innerHTML = `
    <div class="page-header"><h1>${t('comp.header.page_models')}</h1></div>
    <div class="card"><div class="card-body" style="padding:32px;text-align:center;color:var(--text-tertiary)">
      ${t('pages.engine.comingSoonPhase2') || '即将推出（Phase 2）'}
    </div></div>
  `
  return el
}

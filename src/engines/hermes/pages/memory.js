/**
 * Hermes Agent 记忆编辑器
 * 读写 ~/.hermes/memories/MEMORY.md 和 USER.md
 * 支持 Markdown 预览和编辑模式切换
 */
import { t } from '../../../lib/i18n.js'
import { api } from '../../../lib/tauri-api.js'
import { renderMarkdown } from '../../../lib/markdown.js'

function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

export function render() {
  const el = document.createElement('div')
  el.className = 'hermes-memory-page'

  let memoryContent = ''
  let userContent = ''
  let editingSection = null // null | 'memory' | 'user'
  let editBuffer = ''
  let loading = true
  let saving = false

  async function loadAll() {
    loading = true
    draw()
    try {
      const [mem, usr] = await Promise.all([
        api.hermesMemoryRead('memory'),
        api.hermesMemoryRead('user'),
      ])
      memoryContent = mem || ''
      userContent = usr || ''
    } catch (e) {
      console.error('Failed to load memory:', e)
    }
    loading = false
    draw()
  }

  function startEdit(section) {
    editingSection = section
    editBuffer = section === 'memory' ? memoryContent : userContent
    draw()
    el.querySelector('#hm-memory-textarea')?.focus()
  }

  function cancelEdit() {
    const original = editingSection === 'memory' ? memoryContent : userContent
    if (editBuffer !== original && !confirm(t('pages.engine.memoryUnsaved'))) return
    editingSection = null
    editBuffer = ''
    draw()
  }

  async function save() {
    if (!editingSection) return
    saving = true
    draw()
    try {
      await api.hermesMemoryWrite(editingSection, editBuffer)
      if (editingSection === 'memory') memoryContent = editBuffer
      else userContent = editBuffer
      editingSection = null
      editBuffer = ''
    } catch (e) {
      alert(`${t('pages.engine.memorySaveFailed')}: ${e.message || e}`)
    }
    saving = false
    draw()
  }

  function renderSection(type, title, iconSvg, content) {
    const isEditing = editingSection === type
    return `<div class="hm-memory-section">
      <div class="hm-memory-section-header">
        <div class="hm-memory-section-title-row">
          <span class="hm-memory-section-icon">${iconSvg}</span>
          <span class="hm-memory-section-title">${title}</span>
        </div>
        ${!isEditing ? `<button class="btn btn-sm btn-secondary hm-memory-edit-btn" data-section="${type}">${t('pages.engine.memoryEdit')}</button>` : ''}
      </div>
      ${isEditing ? `
        <div class="hm-memory-edit-wrap">
          <textarea class="hm-memory-editor" id="hm-memory-textarea" placeholder="${t('pages.engine.memoryPlaceholder')}">${escHtml(editBuffer)}</textarea>
          <div class="hm-memory-edit-actions">
            <button class="btn btn-sm" id="hm-memory-cancel">${t('pages.engine.memoryCancel')}</button>
            <button class="btn btn-sm btn-primary" id="hm-memory-save" ${saving ? 'disabled' : ''}>${saving ? t('pages.engine.memorySaving') : t('pages.engine.memorySave')}</button>
          </div>
        </div>
      ` : `
        <div class="hm-memory-section-body markdown-body">
          ${content.trim() ? renderMarkdown(content) : `<div class="hm-memory-empty">${t('pages.engine.memoryEmpty')}</div>`}
        </div>
      `}
    </div>`
  }

  function draw() {
    const notesIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'
    const userIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'

    el.innerHTML = `
      <div class="hm-memory-header">
        <span class="hm-memory-header-title">${t('comp.header.page_memory')}</span>
        <button class="btn btn-sm" id="hm-memory-refresh">${t('pages.engine.logsRefresh')}</button>
      </div>
      <div class="hm-memory-content">
        ${loading ? `<div class="hm-memory-loading">${t('pages.engine.memoryLoading')}</div>` : `
          <div class="hm-memory-sections">
            ${renderSection('memory', t('pages.engine.memoryNotes'), notesIcon, memoryContent)}
            ${renderSection('user', t('pages.engine.memoryProfile'), userIcon, userContent)}
          </div>
        `}
      </div>
    `
    bind()
  }

  function bind() {
    el.querySelector('#hm-memory-refresh')?.addEventListener('click', () => loadAll())
    el.querySelectorAll('.hm-memory-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => startEdit(btn.dataset.section))
    })
    el.querySelector('#hm-memory-cancel')?.addEventListener('click', () => cancelEdit())
    el.querySelector('#hm-memory-save')?.addEventListener('click', () => save())
    el.querySelector('#hm-memory-textarea')?.addEventListener('input', (e) => {
      editBuffer = e.target.value
    })
  }

  loadAll()
  return el
}

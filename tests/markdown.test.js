import test from 'node:test'
import assert from 'node:assert/strict'

import { renderMarkdown, renderStreamingText } from '../src/lib/markdown.js'

test('renderStreamingText keeps streaming output lightweight with cursor', () => {
  const html = renderStreamingText('第一段\n第二行')

  assert.match(html, /<p>第一段<br>第二行<\/p>/)
  assert.match(html, /stream-cursor/)
  assert.doesNotMatch(html, /<ul>|<h1>|<pre>/)
})

test('renderMarkdown plain mode avoids promoting text into heavy markdown blocks', () => {
  const html = renderMarkdown('# 标题\n- 列表项', { mode: 'plain' })

  assert.match(html, /<p># 标题<br>- 列表项<\/p>/)
  assert.doesNotMatch(html, /<h1>|<ul>/)
})

test('renderMarkdown chat-rich mode still renders markdown structures', () => {
  const html = renderMarkdown('# 标题\n\n- 列表项', { mode: 'chat-rich' })

  assert.match(html, /<h1>标题<\/h1>/)
  assert.match(html, /<ul>\s*<li>列表项<\/li>\s*<\/ul>/)
})

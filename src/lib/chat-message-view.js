const GROUP_WINDOW_MS = 5 * 60 * 1000

function toTimestamp(value) {
  const ts = Number(value)
  return Number.isFinite(ts) && ts > 0 ? ts : Date.now()
}

function normalizeRole(role) {
  if (role === 'user') return 'user'
  if (role === 'assistant') return 'assistant'
  return 'system'
}

function normalizeKind(kind, role) {
  if (kind === 'tool') return 'tool'
  if (role === 'toolResult' || role === 'tool_result') return 'tool'
  return 'message'
}

function normalizeMedia(items, category) {
  return (items || []).map(item => ({
    ...item,
    category,
  }))
}

function hasStructuredLongText(text) {
  if (!text || text.length <= 220) return false
  const paragraphCount = text.split(/\n\s*\n/).filter(Boolean).length
  const listLines = text.split('\n').filter(line => /^(\s*[-*]\s+|\s*\d+\.\s+)/.test(line)).length
  return paragraphCount >= 2 || listLines >= 2
}

export function decideRenderMode({
  text = '',
  attachments = [],
  isStreaming = false,
} = {}) {
  if (isStreaming) return 'plain'
  if (attachments.length > 0) return 'rich'
  if (/```/.test(text)) return 'rich'
  if (/^#{1,3}\s+/m.test(text)) return 'rich'
  if ((text.match(/^(\s*[-*]\s+|\s*\d+\.\s+)/gm) || []).length >= 3) return 'rich'
  if (/\|.+\|/.test(text) && /\n\s*\|?[-: ]+\|[-|: ]+/.test(text)) return 'rich'
  if (hasStructuredLongText(text)) return 'rich'
  return 'plain'
}

export function normalizeChatMessage(input = {}) {
  const role = normalizeRole(input.role)
  const images = normalizeMedia(input.images, 'image')
  const videos = normalizeMedia(input.videos, 'video')
  const audios = normalizeMedia(input.audios, 'audio')
  const files = normalizeMedia(input.files, 'file')
  const extraAttachments = Array.isArray(input.attachments) ? input.attachments : []
  const attachments = [...images, ...videos, ...audios, ...files, ...extraAttachments]
  const streamState = input.streamState || 'final'
  const renderMode = input.renderMode || decideRenderMode({
    text: input.text || '',
    attachments,
    isStreaming: streamState === 'streaming',
  })

  return {
    id: input.id || '',
    role,
    kind: normalizeKind(input.kind, input.role),
    timestamp: toTimestamp(input.timestamp),
    text: input.text || '',
    thinking: input.thinking || '',
    attachments,
    renderMode,
    streamState,
    groupPosition: input.groupPosition || 'single',
    meta: input.meta || {},
    images,
    videos,
    audios,
    files,
  }
}

function canGroupTogether(prev, next) {
  if (!prev || !next) return false
  if (prev.role !== next.role) return false
  if (prev.role !== 'user' && prev.role !== 'assistant') return false
  return Math.abs(next.timestamp - prev.timestamp) <= GROUP_WINDOW_MS
}

export function getMessageGroupPosition({
  prev = null,
  message = null,
  next = null,
} = {}) {
  if (!message) return 'single'

  const currentMessage = message && message.attachments
    ? message
    : normalizeChatMessage(message)
  const prevMessage = prev
    ? (prev.attachments ? prev : normalizeChatMessage(prev))
    : null
  const nextMessage = next
    ? (next.attachments ? next : normalizeChatMessage(next))
    : null

  const hasPrev = canGroupTogether(prevMessage, currentMessage)
  const hasNext = canGroupTogether(currentMessage, nextMessage)

  if (hasPrev && hasNext) return 'middle'
  if (hasPrev) return 'last'
  if (hasNext) return 'first'
  return 'single'
}

export function groupChatMessages(messages = []) {
  const normalized = messages.map(message =>
    message && message.attachments ? { ...message } : normalizeChatMessage(message)
  )

  return normalized.map((message, index) => {
    const prev = normalized[index - 1] || null
    const next = normalized[index + 1] || null
    return {
      ...message,
      groupPosition: getMessageGroupPosition({ prev, message, next }),
    }
  })
}

function attachmentSignature(item = {}) {
  const ref = item.url || item.data || item.name || item.fileName || ''
  return `${item.category || ''}:${ref}`
}

function messageSignature(message = {}) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : []
  const attachmentPart = attachments.map(attachmentSignature).join('|')
  return [
    normalizeRole(message.role),
    message.kind || 'message',
    message.text || '',
    attachmentPart,
    message.timestamp || '',
  ].join('::')
}

export function dedupeHistoryMessages(messages = []) {
  const deduped = []
  const seen = new Set()

  for (const raw of messages) {
    const message = normalizeChatMessage(raw)
    if (!message.text && !message.attachments.length) continue
    const signature = messageSignature(message)
    if (seen.has(signature)) continue
    seen.add(signature)
    deduped.push(message)
  }

  return deduped
}

export function buildChatMessageGroups(messages = []) {
  const normalized = messages.map(message =>
    message && message.attachments ? { ...message } : normalizeChatMessage(message)
  )

  const groups = []
  for (const message of normalized) {
    const previousGroup = groups.at(-1)
    const previousMessage = previousGroup?.messages?.at(-1) || null
    if (previousGroup && canGroupTogether(previousMessage, message)) {
      previousGroup.messages.push(message)
      previousGroup.timestamp = message.timestamp
      continue
    }

    groups.push({
      id: message.id || `group-${groups.length + 1}`,
      role: message.role,
      kind: message.kind || 'message',
      timestamp: message.timestamp,
      messages: [message],
    })
  }

  return groups
}

function normalizeText(value) {
  return typeof value === 'string' ? value : ''
}

/** 提取思考内容，返回 { text, thinking } */
export function extractThinkingContent(rawText) {
  const text = normalizeText(rawText)
  const thinkingParts = []
  const cleaned = text.replace(
    /<\s*think(?:ing)?\s*>([\s\S]*?)<\s*\/\s*think(?:ing)?\s*>/gi,
    (_, content) => { thinkingParts.push(content.trim()); return '' }
  )
  const finalText = cleaned
    .replace(/Conversation info \(untrusted metadata\):\s*```json[\s\S]*?```\s*/gi, '')
    .replace(/\[Queued messages while agent was busy\]\s*---\s*Queued #\d+\s*/gi, '')
    .trim()
  return {
    text: finalText,
    thinking: thinkingParts.join('\n\n') || '',
  }
}

export function stripThinkingTags(text) {
  return extractThinkingContent(text).text
}

function collectMediaUrls(target, bucket) {
  const mediaUrls = target?.mediaUrls || (target?.mediaUrl ? [target.mediaUrl] : [])
  for (const url of mediaUrls) {
    if (!url) continue
    if (/\.(mp4|webm|mov|mkv)(\?|$)/i.test(url)) bucket.videos.push({ url, mediaType: 'video/mp4' })
    else if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/i.test(url)) bucket.audios.push({ url, mediaType: 'audio/mpeg' })
    else if (/\.(jpe?g|png|gif|webp|heic|svg)(\?|$)/i.test(url)) bucket.images.push({ url, mediaType: 'image/png' })
    else bucket.files.push({ url, name: url.split('/').pop().split('?')[0] || '文件', mimeType: '' })
  }
}

export function extractGatewayChatContent(source) {
  if (typeof source === 'string') {
    const extracted = extractThinkingContent(source)
    return { text: extracted.text, thinking: extracted.thinking, images: [], videos: [], audios: [], files: [] }
  }

  if (!source || typeof source !== 'object') {
    return { text: '', thinking: '', images: [], videos: [], audios: [], files: [] }
  }

  const target = source?.message && typeof source.message === 'object'
    ? source.message
    : source
  const bucket = { text: '', thinking: '', images: [], videos: [], audios: [], files: [] }
  const content = target.content

  if (typeof content === 'string') {
    const extracted = extractThinkingContent(content)
    bucket.text = extracted.text
    bucket.thinking = extracted.thinking
    collectMediaUrls(target, bucket)
    if (target !== source) collectMediaUrls(source, bucket)
    return bucket
  }

  if (Array.isArray(content)) {
    const texts = []
    const thinkingTexts = []
    for (const block of content) {
      if (block?.type === 'thinking' && typeof block.thinking === 'string') {
        thinkingTexts.push(block.thinking)
      } else if (block?.type === 'text' && typeof block.text === 'string') {
        texts.push(block.text)
      } else if (block?.type === 'image' && !block.omitted) {
        if (block.data) bucket.images.push({ mediaType: block.mimeType || 'image/png', data: block.data })
        else if (block.source?.type === 'base64' && block.source.data) bucket.images.push({ mediaType: block.source.media_type || 'image/png', data: block.source.data })
        else if (block.url || block.source?.url) bucket.images.push({ url: block.url || block.source.url, mediaType: block.mimeType || 'image/png' })
      } else if (block?.type === 'image_url' && block.image_url?.url) {
        bucket.images.push({ url: block.image_url.url, mediaType: 'image/png' })
      } else if (block?.type === 'video') {
        if (block.data) bucket.videos.push({ mediaType: block.mimeType || 'video/mp4', data: block.data })
        else if (block.url) bucket.videos.push({ url: block.url, mediaType: block.mimeType || 'video/mp4' })
      } else if (block?.type === 'audio' || block?.type === 'voice') {
        if (block.data) bucket.audios.push({ mediaType: block.mimeType || 'audio/mpeg', data: block.data, duration: block.duration })
        else if (block.url) bucket.audios.push({ url: block.url, mediaType: block.mimeType || 'audio/mpeg', duration: block.duration })
      } else if (block?.type === 'file' || block?.type === 'document') {
        bucket.files.push({ url: block.url || '', name: block.fileName || block.name || '文件', mimeType: block.mimeType || '', size: block.size, data: block.data })
      }
    }
    const extracted = extractThinkingContent(texts.join('\n'))
    bucket.text = extracted.text
    bucket.thinking = [
      ...thinkingTexts,
      ...(extracted.thinking ? [extracted.thinking] : []),
    ].join('\n\n')
    collectMediaUrls(target, bucket)
    if (target !== source) collectMediaUrls(source, bucket)
    return bucket
  }

  const extracted = extractThinkingContent(
    target.text
    || target.delta
    || target.output_text
    || source.text
    || source.delta
    || source.output_text
    || ''
  )
  bucket.text = extracted.text
  bucket.thinking = extracted.thinking
  collectMediaUrls(target, bucket)
  if (target !== source) collectMediaUrls(source, bucket)
  return bucket
}

function dedupeMedia(items, keyBuilder) {
  const seen = new Set()
  return items.filter(item => {
    const key = keyBuilder(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function mergeMedia(primary = [], secondary = [], keyBuilder) {
  return dedupeMedia([...primary, ...secondary], keyBuilder)
}

export function mergeGatewayChatState(currentState = {}, normalized = {}) {
  const previousText = normalizeText(currentState.text)
  const nextText = normalizeText(normalized.text)
  const images = normalized.images?.length ? normalized.images : (currentState.images || [])
  const videos = normalized.videos?.length ? normalized.videos : (currentState.videos || [])
  const audios = normalized.audios?.length ? normalized.audios : (currentState.audios || [])
  const files = normalized.files?.length ? normalized.files : (currentState.files || [])
  const text = nextText || previousText
  const thinking = normalizeText(normalized.thinking) || normalizeText(currentState.thinking)

  return {
    text,
    thinking,
    images,
    videos,
    audios,
    files,
    usage: normalized.usage || currentState.usage || null,
    hasContent: Boolean(text || images.length || videos.length || audios.length || files.length),
  }
}

export function normalizeGatewayChatEvent(payload, previousText = '') {
  const messageContent = extractGatewayChatContent(payload?.message)
  const payloadContent = extractGatewayChatContent(payload)
  const state = payload?.state || ''
  const rawIncremental = normalizeText(
    payload?.delta
    || payload?.textDelta
    || payload?.message?.delta
    || payload?.message?.textDelta
  )
  // 对增量文本做 thinking 提取（仅在包含完整 thinking 标签时）
  const hasThinkingTag = /<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/i.test(rawIncremental)
  const incrementalExtracted = hasThinkingTag ? extractThinkingContent(rawIncremental) : { text: rawIncremental, thinking: '' }
  const incrementalText = incrementalExtracted.text
  const snapshotText = messageContent.text || payloadContent.text

  let text = previousText
  if (state === 'delta') {
    if (incrementalText) {
      text = previousText + incrementalText
    } else if (!previousText) {
      text = snapshotText
    } else if (snapshotText.startsWith(previousText)) {
      text = snapshotText
    } else if (snapshotText) {
      text = previousText + snapshotText
    }
  } else if (state === 'final') {
    text = snapshotText || (incrementalText ? previousText + incrementalText : previousText)
  } else if (snapshotText || incrementalText) {
    text = snapshotText || (previousText + incrementalText)
  }

  // 合并 thinking：来自 snapshot + 增量 delta 中的 thinking
  const thinking = messageContent.thinking || payloadContent.thinking || incrementalExtracted.thinking || ''

  const images = mergeMedia(messageContent.images, payloadContent.images, item => item.url || item.data || JSON.stringify(item))
  const videos = mergeMedia(messageContent.videos, payloadContent.videos, item => item.url || item.data || JSON.stringify(item))
  const audios = mergeMedia(messageContent.audios, payloadContent.audios, item => item.url || item.data || JSON.stringify(item))
  const files = mergeMedia(messageContent.files, payloadContent.files, item => item.url || item.data || item.name || JSON.stringify(item))

  return {
    state,
    runId: payload?.runId || '',
    text,
    thinking,
    images,
    videos,
    audios,
    files,
    usage: payload?.usage || payload?.message?.usage || null,
    hasContent: Boolean(text || images.length || videos.length || audios.length || files.length),
  }
}

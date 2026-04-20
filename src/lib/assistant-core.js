import {
  assistantRequiresApiKey,
  buildAssistantAuthHeaders,
  buildAssistantSystemPrompt,
  cleanAssistantBaseUrl,
  loadAssistantConfig,
  normalizeAssistantApiType,
} from './assistant-config.js'

const TIMEOUT_TOTAL = 120_000
const DEFAULT_AUTO_ROUNDS = 8

function createAbortError() {
  try {
    return new DOMException('Aborted', 'AbortError')
  } catch {
    const error = new Error('Aborted')
    error.name = 'AbortError'
    return error
  }
}

async function fetchWithRetry(url, options, retries = 3) {
  const delays = [1000, 3000, 8000]
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, options)
      if (response.ok || response.status < 500 || i >= retries) return response
      await new Promise(resolve => setTimeout(resolve, delays[i]))
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      if (i >= retries) throw error
      await new Promise(resolve => setTimeout(resolve, delays[i]))
    }
  }
}

function convertToolsForAnthropic(tools) {
  return tools.map(tool => ({
    name: tool.function.name,
    description: tool.function.description || '',
    input_schema: tool.function.parameters || { type: 'object', properties: {} },
  }))
}

function convertToolsForGemini(tools) {
  return [{
    functionDeclarations: tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description || '',
      parameters: tool.function.parameters || { type: 'object', properties: {} },
    })),
  }]
}

function toolDescriptionsFromDefs(tools) {
  return tools.map(tool => {
    const name = tool?.function?.name
    const description = tool?.function?.description
    if (!name) return ''
    return description ? `${name}: ${description}` : name
  }).filter(Boolean)
}

async function executeTool(toolPolicy, name, args) {
  const executor = toolPolicy?.executors?.[name]
  if (!executor && typeof toolPolicy?.execute !== 'function') {
    throw new Error(`未配置工具执行器: ${name}`)
  }
  try {
    if (executor) return await executor(args)
    return await toolPolicy.execute(name, args)
  } catch (error) {
    return `执行失败: ${error?.message || error}`
  }
}

function parseOpenAiToolArgs(toolCall) {
  try {
    return JSON.parse(toolCall?.function?.arguments || '{}')
  } catch {
    return {}
  }
}

function parseResponsesToolArgs(item) {
  try {
    return JSON.parse(item?.arguments || '{}')
  } catch {
    return {}
  }
}

function shouldRetryWithResponses(errorMessage = '') {
  const text = String(errorMessage || '')
  return text.includes('legacy protocol') || text.includes('/v1/responses') || text.includes('not supported')
}

function normalizeResponsesInput(messages = []) {
  return messages
    .filter(message => message?.role !== 'system' && message?.role !== 'tool')
    .map(message => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    }))
}

function extractResponsesText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text
  const output = Array.isArray(data?.output) ? data.output : []
  return output
    .flatMap(item => {
      if (!item || item.type !== 'message' || !Array.isArray(item.content)) return []
      return item.content.map(part => {
        if (part?.type === 'output_text' && typeof part.text === 'string') return part.text
        if (part?.type === 'text' && typeof part.text === 'string') return part.text
        return ''
      })
    })
    .filter(Boolean)
    .join('')
}

async function runOpenAiResponsesTask({
  currentMessages,
  baseUrl,
  config,
  tools,
  toolPolicy,
  toolHistory,
  onToolProgress,
  controller,
  apiType,
}) {
  const instructions = currentMessages.find(message => message.role === 'system')?.content || ''
  let input = normalizeResponsesInput(currentMessages)
  let previousResponseId = null

  for (;;) {
    const body = {
      model: config.model,
      input,
      instructions,
      temperature: config.temperature || 0.7,
    }
    if (tools.length > 0) body.tools = tools
    if (previousResponseId) body.previous_response_id = previousResponseId

    const response = await fetchWithRetry(`${baseUrl}/responses`, {
      method: 'POST',
      headers: buildAssistantAuthHeaders(config),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      let errorMessage = `API 错误 ${response.status}`
      try { errorMessage = JSON.parse(text).error?.message || errorMessage } catch {}
      throw new Error(errorMessage)
    }

    const data = await response.json()
    const outputItems = Array.isArray(data?.output) ? data.output : []
    const functionCalls = outputItems.filter(item => item?.type === 'function_call')
    const finalText = extractResponsesText(data)

    if (functionCalls.length === 0) {
      return { content: finalText, toolHistory, provider: apiType }
    }

    previousResponseId = data?.id || previousResponseId
    input = []

    for (const functionCall of functionCalls) {
      const args = parseResponsesToolArgs(functionCall)
      const historyEntry = {
        name: functionCall?.name,
        args,
        result: null,
        approved: true,
        pending: true,
      }
      toolHistory.push(historyEntry)
      onToolProgress(toolHistory.slice())
      historyEntry.result = await executeTool(toolPolicy, historyEntry.name, args)
      historyEntry.pending = false
      onToolProgress(toolHistory.slice())
      input.push({
        type: 'function_call_output',
        call_id: functionCall.call_id || functionCall.id,
        output: typeof historyEntry.result === 'string' ? historyEntry.result : JSON.stringify(historyEntry.result),
      })
    }
  }
}

function normalizeContentText(message) {
  if (!message) return ''
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content
      .map(block => {
        if (!block) return ''
        if (typeof block === 'string') return block
        if (block.type === 'text' && typeof block.text === 'string') return block.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  return typeof message.text === 'string' ? message.text : ''
}

export async function runAssistantTask({
  messages = [],
  preset = 'default',
  toolPolicy = null,
  onChunk = () => {},
  onToolProgress = () => {},
  signal = null,
} = {}) {
  const config = loadAssistantConfig()
  const apiType = normalizeAssistantApiType(config.apiType)
  if (!config.baseUrl || !config.model || (assistantRequiresApiKey(apiType) && !config.apiKey)) {
    throw new Error('请先在钳子助手里配置本地 AI 模型')
  }

  const tools = Array.isArray(toolPolicy?.tools) ? toolPolicy.tools : []
  const baseUrl = cleanAssistantBaseUrl(config.baseUrl, apiType)
  const toolHistory = []
  const controller = new AbortController()
  const systemPrompt = buildAssistantSystemPrompt(config, {
    preset,
    toolDescriptions: toolPolicy?.toolDescriptions || toolDescriptionsFromDefs(tools),
    extraInstructions: toolPolicy?.extraInstructions || [],
  })

  const detachAbort = typeof signal?.addEventListener === 'function'
    ? (() => {
        const forwardAbort = () => controller.abort()
        signal.addEventListener('abort', forwardAbort, { once: true })
        return () => signal.removeEventListener('abort', forwardAbort)
      })()
    : () => {}

  const timeout = setTimeout(() => controller.abort(), TIMEOUT_TOTAL)
  const maxRounds = Number.isFinite(toolPolicy?.autoRounds) ? toolPolicy.autoRounds : (config.autoRounds ?? DEFAULT_AUTO_ROUNDS)

  let currentMessages = [{ role: 'system', content: systemPrompt }, ...messages]

  try {
    for (let round = 0; ; round++) {
      if (controller.signal.aborted) throw createAbortError()
      if (maxRounds > 0 && round >= maxRounds) {
        throw new Error(`本地助手连续调用工具超过 ${maxRounds} 轮，已自动停止`)
      }

      if (apiType === 'anthropic-messages') {
        const systemMessage = currentMessages.find(message => message.role === 'system')?.content || ''
        const chatMessages = currentMessages.filter(message => message.role !== 'system')
        const body = {
          model: config.model,
          max_tokens: 8192,
          temperature: config.temperature || 0.7,
          messages: chatMessages,
        }
        if (systemMessage) body.system = systemMessage
        if (tools.length > 0) body.tools = convertToolsForAnthropic(tools)

        const response = await fetchWithRetry(`${baseUrl}/messages`, {
          method: 'POST',
          headers: buildAssistantAuthHeaders(config),
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        if (!response.ok) {
          const text = await response.text().catch(() => '')
          let errorMessage = `API 错误 ${response.status}`
          try { errorMessage = JSON.parse(text).error?.message || errorMessage } catch {}
          throw new Error(errorMessage)
        }

        const data = await response.json()
        const blocks = Array.isArray(data?.content) ? data.content : []
        const toolUses = blocks.filter(block => block?.type === 'tool_use')
        const finalText = blocks.filter(block => block?.type === 'text').map(block => block.text).join('')

        if (toolUses.length === 0) {
          onChunk(finalText)
          return { content: finalText, toolHistory, provider: apiType }
        }

        currentMessages.push({ role: 'assistant', content: blocks })
        const toolResults = []
        for (const toolUse of toolUses) {
          const args = toolUse.input || {}
          const historyEntry = {
            name: toolUse.name,
            args,
            result: null,
            approved: true,
            pending: true,
          }
          toolHistory.push(historyEntry)
          onToolProgress(toolHistory.slice())
          historyEntry.result = await executeTool(toolPolicy, toolUse.name, args)
          historyEntry.pending = false
          onToolProgress(toolHistory.slice())
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: typeof historyEntry.result === 'string' ? historyEntry.result : JSON.stringify(historyEntry.result),
          })
        }
        currentMessages.push({ role: 'user', content: toolResults })
        continue
      }

      if (apiType === 'google-gemini') {
        const systemMessage = currentMessages.find(message => message.role === 'system')?.content || ''
        const chatMessages = currentMessages.filter(message => message.role !== 'system')
        const body = {
          contents: chatMessages.map(message => ({
            role: message.role === 'assistant' ? 'model' : message.role === 'tool' ? 'function' : 'user',
            parts: message.functionResponse
              ? [{ functionResponse: message.functionResponse }]
              : [{ text: typeof message.content === 'string' ? message.content : JSON.stringify(message.content) }],
          })),
          generationConfig: { temperature: config.temperature || 0.7 },
        }
        if (systemMessage) body.systemInstruction = { parts: [{ text: systemMessage }] }
        if (tools.length > 0) body.tools = convertToolsForGemini(tools)

        const response = await fetchWithRetry(`${baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        if (!response.ok) {
          const text = await response.text().catch(() => '')
          let errorMessage = `API 错误 ${response.status}`
          try { errorMessage = JSON.parse(text).error?.message || errorMessage } catch {}
          throw new Error(errorMessage)
        }

        const data = await response.json()
        const parts = data?.candidates?.[0]?.content?.parts || []
        const functionCalls = parts.filter(part => part?.functionCall)
        const finalText = parts.filter(part => part?.text).map(part => part.text).join('')
        if (functionCalls.length === 0) {
          onChunk(finalText)
          return { content: finalText, toolHistory, provider: apiType }
        }

        currentMessages.push({ role: 'assistant', content: finalText, _geminiParts: parts })
        for (const part of functionCalls) {
          const functionCall = part.functionCall || {}
          const args = functionCall.args || {}
          const historyEntry = {
            name: functionCall.name,
            args,
            result: null,
            approved: true,
            pending: true,
          }
          toolHistory.push(historyEntry)
          onToolProgress(toolHistory.slice())
          historyEntry.result = await executeTool(toolPolicy, functionCall.name, args)
          historyEntry.pending = false
          onToolProgress(toolHistory.slice())
          currentMessages.push({
            role: 'tool',
            content: typeof historyEntry.result === 'string' ? historyEntry.result : JSON.stringify(historyEntry.result),
            functionResponse: {
              name: functionCall.name,
              response: {
                result: typeof historyEntry.result === 'string' ? historyEntry.result : JSON.stringify(historyEntry.result),
              },
            },
          })
        }
        continue
      }

      const body = {
        model: config.model,
        messages: currentMessages,
        temperature: config.temperature || 0.7,
      }
      if (tools.length > 0) body.tools = tools

      let response
      try {
        response = await fetchWithRetry(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: buildAssistantAuthHeaders(config),
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        if (!response.ok) {
          const text = await response.text().catch(() => '')
          let errorMessage = `API 错误 ${response.status}`
          try { errorMessage = JSON.parse(text).error?.message || errorMessage } catch {}
          throw new Error(errorMessage)
        }
      } catch (error) {
        if (shouldRetryWithResponses(error?.message || '')) {
          return await runOpenAiResponsesTask({
            currentMessages,
            baseUrl,
            config,
            tools,
            toolPolicy,
            toolHistory,
            onToolProgress,
            controller,
            apiType,
          })
        }
        throw error
      }

      const data = await response.json()
      const assistantMessage = data?.choices?.[0]?.message
      if (!assistantMessage) throw new Error('AI 未返回有效响应')

      if (Array.isArray(assistantMessage.tool_calls) && assistantMessage.tool_calls.length > 0) {
        currentMessages.push(assistantMessage)
        for (const toolCall of assistantMessage.tool_calls) {
          const args = parseOpenAiToolArgs(toolCall)
          const historyEntry = {
            name: toolCall?.function?.name,
            args,
            result: null,
            approved: true,
            pending: true,
          }
          toolHistory.push(historyEntry)
          onToolProgress(toolHistory.slice())
          historyEntry.result = await executeTool(toolPolicy, historyEntry.name, args)
          historyEntry.pending = false
          onToolProgress(toolHistory.slice())
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: typeof historyEntry.result === 'string' ? historyEntry.result : JSON.stringify(historyEntry.result),
          })
        }
        continue
      }

      const finalText = normalizeContentText(assistantMessage)
      onChunk(finalText)
      return { content: finalText, toolHistory, provider: apiType }
    }
  } finally {
    clearTimeout(timeout)
    detachAbort()
  }
}

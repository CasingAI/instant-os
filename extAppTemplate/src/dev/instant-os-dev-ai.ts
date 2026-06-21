import {
  GENERATED_APP_AI_RESPONSE_MESSAGE_TYPE,
  GENERATED_APP_AI_STREAM_END_MESSAGE_TYPE,
  GENERATED_APP_AI_STREAM_MESSAGE_TYPE,
} from '../bridge/instant-os-protocol.ts'
import { appendDevLog } from './instant-os-dev-log.ts'
import { hasDevAiCredentials, readDevAiApiBase, readDevAiApiKey, readDevAiModel } from './instant-os-runtime.ts'

type ChatMessage = {
  role: string
  content: string
}

type CompletionBody = {
  messages?: ChatMessage[]
  stream?: boolean
}

type ReplyTarget = Window

function parseCompletionBody(raw: string | undefined): CompletionBody | undefined {
  if (!raw?.trim()) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return undefined
    }
    return parsed as CompletionBody
  } catch {
    return undefined
  }
}

function readLastUserMessage(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'user' && message.content.trim()) {
      return message.content.trim()
    }
  }

  return '你好'
}

function buildMockReply(userText: string): string {
  return `【开发模式 Mock】已收到你的消息：「${userText.slice(0, 120)}」。请在 DevTools 悬浮球 → 配置 中填写 API，或继续使用 Mock。`
}

function buildCompletionJson(content: string): string {
  return JSON.stringify({
    id: 'chatcmpl-dev-mock',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: readDevAiModel(),
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  })
}

function buildStreamChunk(content: string, finish = false): string {
  const payload = {
    id: 'chatcmpl-dev-mock',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: readDevAiModel(),
    choices: [
      {
        index: 0,
        delta: finish ? {} : { content },
        finish_reason: finish ? 'stop' : undefined,
      },
    ],
  }

  return `data: ${JSON.stringify(payload)}\n\n`
}

function postJsonResponse(target: ReplyTarget, appId: string, requestId: string, status: number, body: string): void {
  target.postMessage(
    {
      type: GENERATED_APP_AI_RESPONSE_MESSAGE_TYPE,
      appId,
      requestId,
      status,
      body,
    },
    '*',
  )
}

function postStreamChunk(target: ReplyTarget, appId: string, requestId: string, chunk: string): void {
  target.postMessage(
    {
      type: GENERATED_APP_AI_STREAM_MESSAGE_TYPE,
      appId,
      requestId,
      chunk,
    },
    '*',
  )
}

function postStreamEnd(
  target: ReplyTarget,
  appId: string,
  requestId: string,
  status: number,
  error?: string,
): void {
  target.postMessage(
    {
      type: GENERATED_APP_AI_STREAM_END_MESSAGE_TYPE,
      appId,
      requestId,
      status,
      error,
    },
    '*',
  )
}

async function requestRealCompletion(body: CompletionBody): Promise<string> {
  const apiBase = readDevAiApiBase()
  const apiKey = readDevAiApiKey()
  if (!apiBase || !apiKey) {
    throw new Error('缺少开发环境 AI 配置')
  }

  const response = await fetch(`${apiBase.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: readDevAiModel(),
      messages: body.messages,
      stream: false,
      temperature: 0.7,
    }),
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`)
  }

  return text
}

async function requestRealCompletionStream(
  target: ReplyTarget,
  appId: string,
  requestId: string,
  body: CompletionBody,
): Promise<void> {
  const apiBase = readDevAiApiBase()
  const apiKey = readDevAiApiKey()
  if (!apiBase || !apiKey) {
    throw new Error('缺少开发环境 AI 配置')
  }

  const response = await fetch(`${apiBase.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: readDevAiModel(),
      messages: body.messages,
      stream: true,
      temperature: 0.7,
    }),
  })

  if (!response.ok || !response.body) {
    throw new Error(await response.text())
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''

    for (const part of parts) {
      if (!part.trim()) {
        continue
      }
      postStreamChunk(target, appId, requestId, `${part}\n\n`)
    }
  }

  postStreamChunk(target, appId, requestId, 'data: [DONE]\n\n')
}

async function respondWithMock(
  target: ReplyTarget,
  appId: string,
  requestId: string,
  body: CompletionBody,
): Promise<void> {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const reply = buildMockReply(readLastUserMessage(messages))

  if (body.stream === true) {
    const parts = reply.match(/[\s\S]{1,8}/g) ?? [reply]
    for (const part of parts) {
      postStreamChunk(target, appId, requestId, buildStreamChunk(part))
      await new Promise((resolve) => window.setTimeout(resolve, 40))
    }
    postStreamChunk(target, appId, requestId, buildStreamChunk('', true))
    postStreamChunk(target, appId, requestId, 'data: [DONE]\n\n')
    postStreamEnd(target, appId, requestId, 200)
    return
  }

  postJsonResponse(target, appId, requestId, 200, buildCompletionJson(reply))
}

export async function handleDevAiRequest(
  target: ReplyTarget,
  appId: string,
  requestId: string,
  method: string,
  path: string,
  bodyText: string | undefined,
): Promise<void> {
  const wantsStream = (() => {
    try {
      return Boolean(JSON.parse(bodyText || '{}').stream)
    } catch {
      return false
    }
  })()

  appendDevLog('ai', `处理 AI 请求 ${method} ${path}`, {
    detail: { appId, requestId, stream: wantsStream, bodyText },
  })

  if (method.toUpperCase() !== 'POST' || path !== '/v1/chat/completions') {
    const message = '仅支持 POST /v1/chat/completions'
    if (wantsStream) {
      postStreamEnd(target, appId, requestId, 404, message)
      return
    }
    postJsonResponse(
      target,
      appId,
      requestId,
      404,
      JSON.stringify({ error: { message } }),
    )
    return
  }

  const body = parseCompletionBody(bodyText)
  if (body === undefined) {
    const message = '请求体必须是 JSON'
    if (wantsStream) {
      postStreamEnd(target, appId, requestId, 400, message)
      return
    }
    postJsonResponse(target, appId, requestId, 400, JSON.stringify({ error: { message } }))
    return
  }

  try {
    if (hasDevAiCredentials()) {
      appendDevLog('ai', '使用开发环境真实 API', {
        level: 'success',
        detail: { apiBase: readDevAiApiBase(), model: readDevAiModel() },
      })

      if (body.stream === true) {
        await requestRealCompletionStream(target, appId, requestId, body)
        postStreamEnd(target, appId, requestId, 200)
        return
      }

      const responseText = await requestRealCompletion(body)
      postJsonResponse(target, appId, requestId, 200, responseText)
      return
    }

    appendDevLog('ai', '未配置开发 API，使用 Mock 回复', { level: 'warn' })
    await respondWithMock(target, appId, requestId, body)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 请求失败'
    appendDevLog('ai', message, { level: 'error' })
    if (wantsStream) {
      postStreamEnd(target, appId, requestId, 500, message)
      return
    }
    postJsonResponse(target, appId, requestId, 500, JSON.stringify({ error: { message } }))
  }
}

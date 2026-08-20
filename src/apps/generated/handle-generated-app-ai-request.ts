import type OpenAI from 'openai'
import { buildThinkingRequestExtras } from '../../ai/ai-thinking.ts'
import { finishAiEventLogSession, startAiEventLogSession, toEventLogMessages } from '../../ai/ai-event-log.ts'
import { recordAiTokenUsage } from '../../ai/ai-token-usage.ts'
import { recordOpenAiCompletionUsage, snapshotFromOpenAiUsage } from '../../ai/openai-usage.ts'
import { resolveUsageEstimated } from '../browser/estimate-token-usage.ts'
import { hasOpenAiApiKey, mergeOpenAiConfig } from '../../ai/openai-config.ts'
import { getOpenAiClient } from '../../ai/openai-client.ts'
import type { BridgeAppId } from './generated-app-ai-types.ts'
import type {
  GeneratedAppAiRequestMessage,
  GeneratedAppAiResponseMessage,
  GeneratedAppAiStreamEndMessage,
  GeneratedAppAiStreamMessage,
} from './generated-app-ai-types.ts'
import {
  GENERATED_APP_AI_RESPONSE_MESSAGE_TYPE,
  GENERATED_APP_AI_STREAM_END_MESSAGE_TYPE,
  GENERATED_APP_AI_STREAM_MESSAGE_TYPE,
} from './generated-app-ai-types.ts'
import { normalizeGeneratedAppChatMessages } from './normalize-generated-app-completion-messages.ts'

type ChatCompletionBody = {
  messages?: OpenAI.Chat.ChatCompletionMessageParam[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
  top_p?: number
  response_format?: OpenAI.Chat.ChatCompletionCreateParams['response_format']
}

type ReplyTarget = {
  postMessage: (message: unknown, targetOrigin: string) => void
}

const LOG_PREFIX = '[generated-app-ai]'

function aiDebugInfo(debug: boolean | undefined, ...args: unknown[]): void {
  if (!debug) {
    return
  }
  console.info(...args)
}

function aiDebugWarn(debug: boolean | undefined, ...args: unknown[]): void {
  if (!debug) {
    return
  }
  console.warn(...args)
}

function aiDebugError(debug: boolean | undefined, ...args: unknown[]): void {
  if (!debug) {
    return
  }
  console.error(...args)
}

function postToTarget(target: ReplyTarget, message: unknown): void {
  target.postMessage(message, '*')
}

function isStreamRequestBody(raw: string | undefined): boolean {
  if (!raw?.trim()) {
    return false
  }

  try {
    const parsed = JSON.parse(raw) as { stream?: boolean }
    return parsed.stream === true
  } catch {
    return false
  }
}

function rejectRequest(
  target: ReplyTarget,
  appId: BridgeAppId,
  requestId: string,
  status: number,
  message: string,
  stream: boolean,
  debug: boolean | undefined,
): void {
  if (stream) {
    aiDebugWarn(debug, `${LOG_PREFIX} stream error`, { appId, requestId, status, message })
    postStreamEnd(target, appId, requestId, status, message)
    return
  }

  aiDebugWarn(debug, `${LOG_PREFIX} request error`, { appId, requestId, status, message })
  postResponse(target, appId, requestId, status, openAiErrorBody(message))
}

function openAiErrorBody(message: string, type = 'instant_os_error'): string {
  return JSON.stringify({
    error: {
      message,
      type,
      code: type,
    },
  })
}

function parseChatCompletionBody(raw: string | undefined): ChatCompletionBody | undefined {
  if (!raw?.trim()) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return undefined
    }
    return parsed as ChatCompletionBody
  } catch {
    return undefined
  }
}

function usageContext(appId: BridgeAppId, appName: string | undefined) {
  return {
    actor: appId,
    behavior: 'runtime-completion',
    behaviorLabel: '运行时 AI 调用',
    actorLabel: appName,
  }
}

function postResponse(
  target: ReplyTarget,
  appId: BridgeAppId,
  requestId: string,
  status: number,
  body: string,
): void {
  const message: GeneratedAppAiResponseMessage = {
    type: GENERATED_APP_AI_RESPONSE_MESSAGE_TYPE,
    appId,
    requestId,
    status,
    body,
  }
  postToTarget(target, message)
}

function postStreamChunk(
  target: ReplyTarget,
  appId: BridgeAppId,
  requestId: string,
  chunk: string,
): void {
  const message: GeneratedAppAiStreamMessage = {
    type: GENERATED_APP_AI_STREAM_MESSAGE_TYPE,
    appId,
    requestId,
    chunk,
  }
  postToTarget(target, message)
}

function postStreamEnd(
  target: ReplyTarget,
  appId: BridgeAppId,
  requestId: string,
  status: number,
  error?: string,
): void {
  const message: GeneratedAppAiStreamEndMessage = {
    type: GENERATED_APP_AI_STREAM_END_MESSAGE_TYPE,
    appId,
    requestId,
    status,
    error,
  }
  postToTarget(target, message)
}

export async function handleGeneratedAppAiRequest(
  request: GeneratedAppAiRequestMessage,
  target: ReplyTarget,
  appName?: string,
): Promise<void> {
  const { appId, requestId, debug } = request
  const wantsStream = isStreamRequestBody(request.body)

  aiDebugInfo(debug, `${LOG_PREFIX} request`, {
    appId,
    requestId,
    path: request.path,
    stream: wantsStream,
    bodyLength: request.body?.length ?? 0,
  })

  if (request.method.toUpperCase() !== 'POST' || request.path !== '/v1/chat/completions') {
    rejectRequest(
      target,
      appId,
      requestId,
      404,
      '仅支持 POST /v1/chat/completions',
      wantsStream,
      debug,
    )
    return
  }

  if (!hasOpenAiApiKey()) {
    rejectRequest(
      target,
      appId,
      requestId,
      401,
      '缺少 API Key。请在「系统设置 → 账户」中配置。',
      wantsStream,
      debug,
    )
    return
  }

  const body = parseChatCompletionBody(request.body)
  if (body === undefined) {
    rejectRequest(target, appId, requestId, 400, '请求体必须是 JSON', wantsStream, debug)
    return
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    rejectRequest(target, appId, requestId, 400, 'messages 必须是非空数组', wantsStream, debug)
    return
  }

  const messages = normalizeGeneratedAppChatMessages(body.messages)
  if (!messages) {
    rejectRequest(
      target,
      appId,
      requestId,
      400,
      'messages 格式无效：每条须含 role（system / user / assistant）与非空 content；助手历史勿用 ai/bot 等 role',
      wantsStream,
      debug,
    )
    return
  }

  const config = mergeOpenAiConfig()
  const client = getOpenAiClient(config)
  const stream = body.stream === true
  const context = usageContext(appId, appName)
  const logSession = startAiEventLogSession(context, {
    model: config.defaultModel,
    thinkingEnabled: config.thinkingEnabled,
    messages: toEventLogMessages(messages),
  })

  const sharedParams: OpenAI.Chat.ChatCompletionCreateParams = {
    model: config.defaultModel,
    messages,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    top_p: body.top_p,
    response_format: body.response_format,
    ...buildThinkingRequestExtras(config.providerId, config.thinkingEnabled, config.defaultModel),
  }

  try {
    if (stream) {
      aiDebugInfo(debug, `${LOG_PREFIX} stream start`, { appId, requestId, messageCount: messages.length })

      const completionStream = await client.chat.completions.create({
        ...sharedParams,
        stream: true,
        stream_options: { include_usage: true },
      })

      let chunkCount = 0
      let streamResponse = ''
      let streamUsage = snapshotFromOpenAiUsage(undefined)
      for await (const chunk of completionStream) {
        const usage = snapshotFromOpenAiUsage(chunk.usage)
        if (usage) {
          streamUsage = usage
          recordAiTokenUsage(context, usage, config.defaultModel)
        }

        const delta = chunk.choices[0]?.delta?.content
        if (delta) {
          logSession.markFirstToken()
          streamResponse += delta
          logSession.update({
            response: streamResponse,
            usage: streamUsage,
          })
        }

        chunkCount += 1
        postStreamChunk(target, appId, requestId, `data: ${JSON.stringify(chunk)}\n\n`)
      }

      finishAiEventLogSession(logSession, context, {
        response: streamResponse,
        usage: streamUsage,
        usageEstimated: resolveUsageEstimated(Boolean(streamUsage), config.defaultModel),
        status: 'success',
      })

      postStreamChunk(target, appId, requestId, 'data: [DONE]\n\n')
      postStreamEnd(target, appId, requestId, 200)
      aiDebugInfo(debug, `${LOG_PREFIX} stream end`, { appId, requestId, chunkCount })
      return
    }

    const response = await client.chat.completions.create(sharedParams)

    recordOpenAiCompletionUsage(response, context, {
      model: config.defaultModel,
      thinkingEnabled: config.thinkingEnabled,
      messages: toEventLogMessages(messages),
      session: logSession,
    })
    postResponse(target, appId, requestId, 200, JSON.stringify(response))
    aiDebugInfo(debug, `${LOG_PREFIX} response`, { appId, requestId })
  } catch (error) {
    const snapshot = logSession.snapshot()
    if (snapshot) {
      finishAiEventLogSession(logSession, context, {
        response: snapshot.response,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'AI 请求失败',
      })
    }
    const message = error instanceof Error ? error.message : 'AI 请求失败'
    aiDebugError(debug, `${LOG_PREFIX} failed`, { appId, requestId, stream, message })
    if (stream) {
      postStreamEnd(target, appId, requestId, 500, message)
      return
    }

    postResponse(target, appId, requestId, 500, openAiErrorBody(message))
  }
}

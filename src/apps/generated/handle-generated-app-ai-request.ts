import type OpenAI from 'openai'
import { buildThinkingRequestExtras } from '../../ai/ai-thinking.ts'
import { recordAiTokenUsage } from '../../ai/ai-token-usage.ts'
import { recordOpenAiCompletionUsage, snapshotFromOpenAiUsage } from '../../ai/openai-usage.ts'
import { hasOpenAiApiKey, mergeOpenAiConfig } from '../../ai/openai-config.ts'
import { getOpenAiClient } from '../../ai/openai-client.ts'
import type { GeneratedAppId } from '../../os/types.ts'
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

type ChatCompletionBody = {
  model?: string
  messages?: OpenAI.Chat.ChatCompletionMessageParam[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
  top_p?: number
  response_format?: OpenAI.Chat.ChatCompletionCreateParams['response_format']
}

type ReplyTarget = {
  postMessage: (message: unknown) => void
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

function usageContext(appId: GeneratedAppId, appName: string | undefined) {
  return {
    actor: appId,
    behavior: 'runtime-completion',
    behaviorLabel: '运行时 AI 调用',
    actorLabel: appName,
  }
}

function postResponse(
  target: ReplyTarget,
  appId: GeneratedAppId,
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
  target.postMessage(message)
}

function postStreamChunk(
  target: ReplyTarget,
  appId: GeneratedAppId,
  requestId: string,
  chunk: string,
): void {
  const message: GeneratedAppAiStreamMessage = {
    type: GENERATED_APP_AI_STREAM_MESSAGE_TYPE,
    appId,
    requestId,
    chunk,
  }
  target.postMessage(message)
}

function postStreamEnd(
  target: ReplyTarget,
  appId: GeneratedAppId,
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
  target.postMessage(message)
}

export async function handleGeneratedAppAiRequest(
  request: GeneratedAppAiRequestMessage,
  target: ReplyTarget,
  appName?: string,
): Promise<void> {
  const { appId, requestId } = request

  if (request.method.toUpperCase() !== 'POST' || request.path !== '/v1/chat/completions') {
    postResponse(
      target,
      appId,
      requestId,
      404,
      openAiErrorBody('仅支持 POST /v1/chat/completions'),
    )
    return
  }

  if (!hasOpenAiApiKey()) {
    postResponse(
      target,
      appId,
      requestId,
      401,
      openAiErrorBody('缺少 API Key。请在「系统设置 → 账户」中配置。'),
    )
    return
  }

  const body = parseChatCompletionBody(request.body)
  if (body === undefined) {
    postResponse(target, appId, requestId, 400, openAiErrorBody('请求体必须是 JSON'))
    return
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    postResponse(target, appId, requestId, 400, openAiErrorBody('messages 必须是非空数组'))
    return
  }

  const config = mergeOpenAiConfig()
  const client = getOpenAiClient(config)
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : config.defaultModel
  const stream = body.stream === true
  const context = usageContext(appId, appName)

  const sharedParams: OpenAI.Chat.ChatCompletionCreateParams = {
    model,
    messages: body.messages,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    top_p: body.top_p,
    response_format: body.response_format,
    ...buildThinkingRequestExtras(config.providerId, false),
  }

  try {
    if (stream) {
      const completionStream = await client.chat.completions.create({
        ...sharedParams,
        stream: true,
        stream_options: { include_usage: true },
      })

      for await (const chunk of completionStream) {
        const usage = snapshotFromOpenAiUsage(chunk.usage)
        if (usage) {
          recordAiTokenUsage(context, usage)
        }

        postStreamChunk(target, appId, requestId, `data: ${JSON.stringify(chunk)}\n\n`)
      }

      postStreamChunk(target, appId, requestId, 'data: [DONE]\n\n')
      postStreamEnd(target, appId, requestId, 200)
      return
    }

    const response = await client.chat.completions.create(sharedParams)

    recordOpenAiCompletionUsage(response, context)
    postResponse(target, appId, requestId, 200, JSON.stringify(response))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 请求失败'
    if (stream) {
      postStreamEnd(target, appId, requestId, 500, message)
      return
    }

    postResponse(target, appId, requestId, 500, openAiErrorBody(message))
  }
}

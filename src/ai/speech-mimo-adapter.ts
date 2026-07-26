/**
 * 小米 MiMo 语音识别 / 合成适配（OpenAI chat/completions 扩展约定）。
 * 公开系统语音 API 不应依赖本文件的请求细节。
 */
import type OpenAI from 'openai'
import type { AsrLanguagePreference } from '../os/speech-settings-storage.ts'
import {
  finishAiEventLogSession,
  startAiEventLogSession,
} from './ai-event-log.ts'
import { readStreamDelta } from './ai-thinking.ts'
import type { AiUsageContext } from './ai-usage-context.ts'
import { recordAiTokenUsage } from './ai-token-usage.ts'
import { getOpenAiClient } from './openai-client.ts'
import type { OpenAiConfig } from './openai-config.ts'
import { recordOpenAiCompletionUsage, snapshotFromOpenAiUsage } from './openai-usage.ts'
import {
  createChatCompletionStream,
  forEachStreamChunk,
  isStreamAbortError,
  throwIfStreamAborted,
} from './stream-abort.ts'

/** MiMo 流式 TTS 文档约定：24kHz / 16-bit / mono PCM */
export const MIMO_TTS_PCM_SAMPLE_RATE = 24_000

type ChatMessageWithAudio = OpenAI.Chat.ChatCompletionMessage & {
  audio?: { data?: string; id?: string; transcript?: string }
}

type DeltaWithAudio = {
  audio?: { data?: string } | string
}

function asrDataUrl(audioBase64: string, mimeType: string): string {
  return `data:${mimeType};base64,${audioBase64}`
}

function extractAssistantText(response: OpenAI.Chat.ChatCompletion): string {
  const content = response.choices[0]?.message?.content
  if (typeof content === 'string') {
    return content.trim()
  }
  if (Array.isArray(content)) {
    return (content as unknown[])
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: string }).text ?? '')
        }
        return ''
      })
      .join('')
      .trim()
  }
  return ''
}

function buildAsrMessages(
  audioBase64: string,
  mimeType: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return [
    {
      role: 'user',
      content: [
        {
          type: 'input_audio',
          input_audio: {
            data: asrDataUrl(audioBase64, mimeType),
          },
        } as OpenAI.Chat.ChatCompletionContentPart,
      ],
    },
  ]
}

export async function mimoRecognizeSpeech(options: {
  config: OpenAiConfig
  audioBase64: string
  mimeType: 'audio/wav' | 'audio/mpeg' | 'audio/mp3'
  language: AsrLanguagePreference
  usageContext?: AiUsageContext
}): Promise<string> {
  const client = getOpenAiClient(undefined, 'speech-recognition')
  const { config, mimeType, language } = options
  const messages = buildAsrMessages(options.audioBase64, mimeType)

  const response = await client.chat.completions.create({
    model: config.defaultModel,
    messages,
    asr_options: { language },
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)

  if (options.usageContext) {
    recordOpenAiCompletionUsage(response, options.usageContext, {
      model: config.defaultModel,
      messages: [
        {
          role: 'user',
          content: `[audio ${mimeType}] language=${language}`,
        },
      ],
    })
  }

  const text = extractAssistantText(response)
  if (!text) {
    throw new Error('识别结果为空')
  }
  return text
}

/**
 * 流式识别：整段音频上传后，转写文本经 SSE 逐步返回。
 * onTextChunk(delta, accumulated) 便于边收边展示。
 */
export async function mimoRecognizeSpeechStream(options: {
  config: OpenAiConfig
  audioBase64: string
  mimeType: 'audio/wav' | 'audio/mpeg' | 'audio/mp3'
  language: AsrLanguagePreference
  usageContext?: AiUsageContext
  signal?: AbortSignal
  onTextChunk?: (delta: string, accumulated: string) => void
}): Promise<string> {
  const client = getOpenAiClient(undefined, 'speech-recognition')
  const { config, mimeType, language } = options
  throwIfStreamAborted(options.signal)

  const messages = buildAsrMessages(options.audioBase64, mimeType)
  const logSession = options.usageContext
    ? startAiEventLogSession(options.usageContext, {
        model: config.defaultModel,
        messages: [
          {
            role: 'user',
            content: `[audio ${mimeType}] language=${language} stream`,
          },
        ],
      })
    : undefined

  let text = ''
  let usage: ReturnType<typeof snapshotFromOpenAiUsage>

  try {
    const stream = await createChatCompletionStream(
      client,
      {
        model: config.defaultModel,
        messages,
        stream: true,
        ...(options.usageContext ? { stream_options: { include_usage: true } } : {}),
        asr_options: { language },
      } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      options.signal,
    )

    await forEachStreamChunk(
      stream,
      (chunk) => {
        const chunkUsage = snapshotFromOpenAiUsage(chunk.usage)
        if (chunkUsage) {
          usage = chunkUsage
        }
        const { content } = readStreamDelta(chunk.choices[0]?.delta)
        if (!content) {
          return
        }
        logSession?.markFirstToken()
        text += content
        options.onTextChunk?.(content, text)
        logSession?.update({
          response: text,
          usage,
        })
      },
      options.signal,
    )

    const trimmed = text.trim()
    if (!trimmed) {
      throw new Error('识别结果为空')
    }

    if (options.usageContext && logSession) {
      recordAiTokenUsage(options.usageContext, usage)
      finishAiEventLogSession(logSession, options.usageContext, {
        response: trimmed,
        usage,
        usageEstimated: usage ? false : undefined,
        status: 'success',
      })
    }

    return trimmed
  } catch (error) {
    if (options.usageContext && logSession) {
      const snapshot = logSession.snapshot()
      if (snapshot) {
        finishAiEventLogSession(logSession, options.usageContext, {
          response: snapshot.response,
          usage:
            snapshot.completionTokens !== undefined
              ? {
                  promptTokens: snapshot.promptTokens ?? 0,
                  completionTokens: snapshot.completionTokens,
                  totalTokens: snapshot.totalTokens ?? snapshot.completionTokens,
                }
              : undefined,
          usageEstimated: snapshot.usageEstimated,
          status: isStreamAbortError(error, options.signal) ? 'aborted' : 'error',
          errorMessage: error instanceof Error ? error.message : '语音识别失败',
        })
      }
    }
    throw error
  }
}

function buildTtsMessages(
  text: string,
  styleInstruction: string | undefined,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  const style = styleInstruction?.trim()
  if (style) {
    messages.push({ role: 'user', content: style })
  }
  messages.push({ role: 'assistant', content: text })
  return messages
}

function ttsEventMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): { role: 'user' | 'assistant'; content: string }[] {
  return messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: typeof m.content === 'string' ? m.content : '[multimodal]',
  }))
}

function extractDeltaAudioBase64(delta: unknown): string | undefined {
  if (!delta || typeof delta !== 'object') {
    return undefined
  }
  const audio = (delta as DeltaWithAudio).audio
  if (typeof audio === 'string' && audio.trim()) {
    return audio.trim()
  }
  if (audio && typeof audio === 'object' && typeof audio.data === 'string') {
    const data = audio.data.trim()
    return data || undefined
  }
  return undefined
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export async function mimoSynthesizeSpeech(options: {
  config: OpenAiConfig
  text: string
  styleInstruction?: string
  voice: string
  format: 'wav' | 'mp3' | 'pcm16'
  usageContext?: AiUsageContext
}): Promise<{ audioBase64: string; format: string; model: string }> {
  const client = getOpenAiClient(undefined, 'speech-synthesis')
  const { config, format, voice } = options
  const text = options.text.trim()
  if (!text) {
    throw new Error('请输入要合成的文本')
  }

  const messages = buildTtsMessages(text, options.styleInstruction)

  const response = await client.chat.completions.create({
    model: config.defaultModel,
    messages,
    audio: {
      format,
      voice,
    },
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)

  if (options.usageContext) {
    recordOpenAiCompletionUsage(response, options.usageContext, {
      model: config.defaultModel,
      messages: ttsEventMessages(messages),
    })
  }

  const message = response.choices[0]?.message as ChatMessageWithAudio | undefined
  const audioBase64 = message?.audio?.data?.trim()
  if (!audioBase64) {
    throw new Error('合成结果中没有音频数据')
  }

  return {
    audioBase64,
    format,
    model: config.defaultModel,
  }
}

/**
 * 流式合成：pcm16 分片通过 onPcmChunk 回调；结束后返回拼接后的完整 PCM。
 * 取消时抛出 AbortError（signal.aborted）。
 */
export async function mimoSynthesizeSpeechStream(options: {
  config: OpenAiConfig
  text: string
  styleInstruction?: string
  voice: string
  usageContext?: AiUsageContext
  signal?: AbortSignal
  onPcmChunk: (pcm: Uint8Array) => void
}): Promise<{ pcm: Uint8Array; sampleRate: number; model: string }> {
  const client = getOpenAiClient(undefined, 'speech-synthesis')
  const { config, voice } = options
  const text = options.text.trim()
  if (!text) {
    throw new Error('请输入要合成的文本')
  }

  throwIfStreamAborted(options.signal)

  const messages = buildTtsMessages(text, options.styleInstruction)
  const eventMessages = ttsEventMessages(messages)
  const logSession = options.usageContext
    ? startAiEventLogSession(options.usageContext, {
        model: config.defaultModel,
        messages: eventMessages,
      })
    : undefined

  const pcmParts: Uint8Array[] = []
  let totalBytes = 0
  let usage: ReturnType<typeof snapshotFromOpenAiUsage>

  try {
    const stream = await createChatCompletionStream(
      client,
      {
        model: config.defaultModel,
        messages,
        stream: true,
        ...(options.usageContext ? { stream_options: { include_usage: true } } : {}),
        audio: {
          format: 'pcm16',
          voice,
        },
      } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      options.signal,
    )

    await forEachStreamChunk(
      stream,
      (chunk) => {
        const chunkUsage = snapshotFromOpenAiUsage(chunk.usage)
        if (chunkUsage) {
          usage = chunkUsage
        }

        const choice = chunk.choices[0]
        if (!choice) {
          return
        }

        const audioBase64 = extractDeltaAudioBase64(choice.delta)
        if (!audioBase64) {
          return
        }

        logSession?.markFirstToken()
        const pcm = base64ToUint8Array(audioBase64)
        if (pcm.byteLength === 0) {
          return
        }
        pcmParts.push(pcm)
        totalBytes += pcm.byteLength
        options.onPcmChunk(pcm)
        logSession?.update({
          response: `[audio pcm16 stream bytes=${totalBytes}]`,
          usage,
        })
      },
      options.signal,
    )

    if (totalBytes === 0) {
      throw new Error('合成结果中没有音频数据')
    }

    const pcm = concatUint8Arrays(pcmParts)

    if (options.usageContext && logSession) {
      recordAiTokenUsage(options.usageContext, usage)
      finishAiEventLogSession(logSession, options.usageContext, {
        response: `[audio pcm16 stream bytes=${totalBytes}]`,
        usage,
        usageEstimated: usage ? false : undefined,
        status: 'success',
      })
    }

    return {
      pcm,
      sampleRate: MIMO_TTS_PCM_SAMPLE_RATE,
      model: config.defaultModel,
    }
  } catch (error) {
    if (options.usageContext && logSession) {
      const snapshot = logSession.snapshot()
      if (snapshot) {
        finishAiEventLogSession(logSession, options.usageContext, {
          response: snapshot.response,
          usage:
            snapshot.completionTokens !== undefined
              ? {
                  promptTokens: snapshot.promptTokens ?? 0,
                  completionTokens: snapshot.completionTokens,
                  totalTokens: snapshot.totalTokens ?? snapshot.completionTokens,
                }
              : undefined,
          usageEstimated: snapshot.usageEstimated,
          status: isStreamAbortError(error, options.signal) ? 'aborted' : 'error',
          errorMessage: error instanceof Error ? error.message : '语音合成失败',
        })
      }
    }
    throw error
  }
}

function concatUint8Arrays(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0
  for (const part of parts) {
    total += part.byteLength
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

export const MIMO_TTS_VOICES = [
  { id: '冰糖', label: '冰糖（中文女）' },
  { id: '茉莉', label: '茉莉（中文女）' },
  { id: '苏打', label: '苏打（中文男）' },
  { id: '白桦', label: '白桦（中文男）' },
  { id: 'Mia', label: 'Mia（英文女）' },
  { id: 'Chloe', label: 'Chloe（英文女）' },
  { id: 'Milo', label: 'Milo（英文男）' },
  { id: 'Dean', label: 'Dean（英文男）' },
  { id: 'mimo_default', label: 'MiMo 默认' },
] as const

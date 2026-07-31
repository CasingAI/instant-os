/**
 * 火山方舟 Agent Plan 语音识别 / 合成适配。
 * - TTS：HTTP SSE（openspeech plan 路径）
 * - ASR：录音文件极速识别 HTTP（浏览器无法给 WebSocket 带鉴权头）
 * 公开系统语音 API 不应依赖本文件的请求细节。
 */
import type { AsrLanguagePreference } from '../os/speech-settings-storage.ts'
import {
  isProxyServerConnected,
  PROXY_SERVER_NOT_CONFIGURED_MESSAGE,
  proxiedFetch,
  ProxyServerApiError,
} from '../os/proxy-server-api.ts'
import {
  finishAiEventLogSession,
  startAiEventLogSession,
} from './ai-event-log.ts'
import type { AiUsageContext } from './ai-usage-context.ts'
import { recordAiTokenUsage } from './ai-token-usage.ts'
import type { OpenAiConfig } from './openai-config.ts'

/** 豆包 Seed TTS 2.0 常用采样率 */
export const ARK_TTS_PCM_SAMPLE_RATE = 24_000

const ARK_TTS_SSE_URL =
  'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional/sse'
const ARK_ASR_FLASH_URL =
  'https://openspeech.bytedance.com/api/v3/plan/auc/bigmodel/recognize/flash'

const ARK_TTS_RESOURCE_ID = 'seed-tts-2.0'
/** Agent Plan 文档中的流式 ASR 资源；文件极速识别优先用 seedasr.auc */
const ARK_ASR_RESOURCE_ID = 'volc.seedasr.auc'

export const ARK_TTS_VOICES = [
  { id: 'zh_female_vv_uranus_bigtts', label: '豆包 VV（女）' },
  { id: 'zh_female_xiaohe_uranus_bigtts', label: '豆包小荷（女）' },
  { id: 'zh_female_shuangkuaisisi_moon_bigtts', label: '爽快思思（女）' },
  { id: 'zh_male_ahu_conversation_wvae_bigtts', label: '阿虎（男）' },
  { id: 'zh_male_M392_conversation_wvae_bigtts', label: '对话男声' },
] as const

function arkFetch(_config: OpenAiConfig): typeof fetch {
  // 方舟 openspeech / plan 端点浏览器侧必须经代理
  return (input, init) => {
    if (!isProxyServerConnected()) {
      return Promise.reject(
        new ProxyServerApiError(PROXY_SERVER_NOT_CONFIGURED_MESSAGE),
      )
    }
    return proxiedFetch(input, init)
  }
}

function newRequestId(): string {
  return crypto.randomUUID()
}

function mimeToAsrFormat(
  mimeType: 'audio/wav' | 'audio/mpeg' | 'audio/mp3',
): 'wav' | 'mp3' {
  return mimeType === 'audio/wav' ? 'wav' : 'mp3'
}

function languageToExplicit(
  language: AsrLanguagePreference,
): string | undefined {
  if (language === 'zh') return 'zh-CN'
  if (language === 'en') return 'en-US'
  return undefined
}

function mapTtsFormat(
  format: 'wav' | 'mp3' | 'pcm16',
): { apiFormat: 'mp3' | 'pcm' | 'wav'; responseFormat: string } {
  if (format === 'pcm16') {
    return { apiFormat: 'pcm', responseFormat: 'pcm16' }
  }
  if (format === 'wav') {
    return { apiFormat: 'wav', responseFormat: 'wav' }
  }
  return { apiFormat: 'mp3', responseFormat: 'mp3' }
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
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

function ttsAuthHeaders(apiKey: string, requestId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Api-Key': apiKey,
    'X-Api-Resource-Id': ARK_TTS_RESOURCE_ID,
    'X-Api-Request-Id': requestId,
  }
}

function asrAuthHeaders(apiKey: string, requestId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Api-Key': apiKey,
    'X-Api-Resource-Id': ARK_ASR_RESOURCE_ID,
    'X-Api-Request-Id': requestId,
    'X-Api-Sequence': '-1',
  }
}

type SseEvent = { event?: string; data: string }

async function* iterateSse(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  if (!response.body) {
    throw new Error('语音合成响应无正文')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName: string | undefined
  let dataLines: string[] = []

  const flush = (): SseEvent | undefined => {
    if (dataLines.length === 0 && eventName === undefined) {
      return undefined
    }
    const data = dataLines.join('\n')
    const evt = { event: eventName, data }
    eventName = undefined
    dataLines = []
    return evt
  }

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line === '') {
          const evt = flush()
          if (evt) yield evt
          continue
        }
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim()
          continue
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart())
        }
      }
    }
    const trailing = flush()
    if (trailing) yield trailing
  } finally {
    reader.releaseLock()
  }
}

type TtsSsePayload = {
  code?: number
  message?: string
  data?: string | null
  usage?: { text_words?: number }
}

async function consumeTtsSse(options: {
  config: OpenAiConfig
  text: string
  styleInstruction?: string
  voice: string
  apiFormat: 'mp3' | 'pcm' | 'wav'
  usageContext?: AiUsageContext
  signal?: AbortSignal
  onAudioChunk?: (bytes: Uint8Array) => void
}): Promise<{ audio: Uint8Array; model: string }> {
  const text = options.text.trim()
  if (!text) {
    throw new Error('请输入要合成的文本')
  }

  const requestId = newRequestId()
  const doFetch = arkFetch(options.config)
  const additions: Record<string, unknown> = {}
  const style = options.styleInstruction?.trim()
  if (style) {
    additions.context_texts = [style]
  }

  const body = {
    user: { uid: 'instant-app' },
    req_params: {
      text,
      speaker: options.voice,
      audio_params: {
        format: options.apiFormat,
        sample_rate: ARK_TTS_PCM_SAMPLE_RATE,
      },
      ...(Object.keys(additions).length > 0
        ? { additions: JSON.stringify(additions) }
        : {}),
    },
  }

  const logSession = options.usageContext
    ? startAiEventLogSession(options.usageContext, {
        model: options.config.defaultModel || 'doubao-seed-tts-2.0',
        messages: [
          ...(style ? [{ role: 'user' as const, content: style }] : []),
          { role: 'assistant' as const, content: text },
        ],
      })
    : undefined

  const parts: Uint8Array[] = []
  let totalBytes = 0
  let usageWords = 0

  try {
    const response = await doFetch(ARK_TTS_SSE_URL, {
      method: 'POST',
      headers: ttsAuthHeaders(options.config.apiKey, requestId),
      body: JSON.stringify(body),
      signal: options.signal,
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(
        `方舟 TTS 请求失败（${response.status}）${errText ? `：${errText.slice(0, 200)}` : ''}`,
      )
    }

    for await (const evt of iterateSse(response, options.signal)) {
      if (!evt.data) continue
      let payload: TtsSsePayload
      try {
        payload = JSON.parse(evt.data) as TtsSsePayload
      } catch {
        continue
      }
      if (typeof payload.code === 'number' && payload.code !== 0 && payload.code !== 20000000) {
        throw new Error(
          payload.message?.trim() || `方舟 TTS 错误码 ${payload.code}`,
        )
      }
      if (payload.usage?.text_words && payload.usage.text_words > 0) {
        usageWords = payload.usage.text_words
      }
      if (typeof payload.data === 'string' && payload.data.trim()) {
        logSession?.markFirstToken()
        const bytes = base64ToUint8Array(payload.data.trim())
        if (bytes.byteLength > 0) {
          parts.push(bytes)
          totalBytes += bytes.byteLength
          options.onAudioChunk?.(bytes)
          logSession?.update({
            response: `[audio ark-tts stream bytes=${totalBytes}]`,
          })
        }
      }
    }

    if (totalBytes === 0) {
      throw new Error('合成结果中没有音频数据')
    }

    if (options.usageContext && usageWords > 0) {
      // 套餐按字符/词抵扣；用量面板用近似 token 记账
      const approx = Math.max(1, usageWords)
      recordAiTokenUsage(options.usageContext, {
        promptTokens: approx,
        completionTokens: 0,
        totalTokens: approx,
      })
    }

    if (logSession) {
      finishAiEventLogSession(logSession, options.usageContext!, {
        response: `[audio ark-tts bytes=${totalBytes}]`,
        usage:
          usageWords > 0
            ? {
                promptTokens: usageWords,
                completionTokens: 0,
                totalTokens: usageWords,
              }
            : undefined,
        status: 'success',
      })
    }

    return {
      audio: concatUint8Arrays(parts),
      model: options.config.defaultModel || 'doubao-seed-tts-2.0',
    }
  } catch (error) {
    if (logSession && options.usageContext) {
      finishAiEventLogSession(logSession, options.usageContext, {
        response: '',
        status: options.signal?.aborted ? 'aborted' : 'error',
        errorMessage: error instanceof Error ? error.message : '语音合成失败',
      })
    }
    throw error
  }
}

export async function arkSynthesizeSpeech(options: {
  config: OpenAiConfig
  text: string
  styleInstruction?: string
  voice: string
  format: 'wav' | 'mp3' | 'pcm16'
  usageContext?: AiUsageContext
}): Promise<{ audioBase64: string; format: string; model: string }> {
  const mapped = mapTtsFormat(options.format)
  const result = await consumeTtsSse({
    config: options.config,
    text: options.text,
    styleInstruction: options.styleInstruction,
    voice: options.voice,
    apiFormat: mapped.apiFormat,
    usageContext: options.usageContext,
  })
  return {
    audioBase64: uint8ArrayToBase64(result.audio),
    format: mapped.responseFormat,
    model: result.model,
  }
}

export async function arkSynthesizeSpeechStream(options: {
  config: OpenAiConfig
  text: string
  styleInstruction?: string
  voice: string
  usageContext?: AiUsageContext
  signal?: AbortSignal
  onPcmChunk: (pcm: Uint8Array) => void
}): Promise<{ pcm: Uint8Array; sampleRate: number; model: string }> {
  const result = await consumeTtsSse({
    config: options.config,
    text: options.text,
    styleInstruction: options.styleInstruction,
    voice: options.voice,
    apiFormat: 'pcm',
    usageContext: options.usageContext,
    signal: options.signal,
    onAudioChunk: options.onPcmChunk,
  })
  return {
    pcm: result.audio,
    sampleRate: ARK_TTS_PCM_SAMPLE_RATE,
    model: result.model,
  }
}

type AsrFlashPayload = {
  code?: number | string
  message?: string
  result?: {
    text?: string
    utterances?: Array<{ text?: string }>
  }
  data?: {
    result?: {
      text?: string
      utterances?: Array<{ text?: string }>
    }
  }
}

function extractAsrText(payload: AsrFlashPayload): string {
  const result = payload.result ?? payload.data?.result
  const direct = result?.text?.trim()
  if (direct) return direct
  const parts =
    result?.utterances
      ?.map((item) => item.text?.trim() ?? '')
      .filter(Boolean) ?? []
  return parts.join('').trim()
}

export async function arkRecognizeSpeech(options: {
  config: OpenAiConfig
  audioBase64: string
  mimeType: 'audio/wav' | 'audio/mpeg' | 'audio/mp3'
  language: AsrLanguagePreference
  usageContext?: AiUsageContext
  signal?: AbortSignal
  onTextChunk?: (delta: string, accumulated: string) => void
}): Promise<string> {
  const requestId = newRequestId()
  const doFetch = arkFetch(options.config)
  const format = mimeToAsrFormat(options.mimeType)
  const language = languageToExplicit(options.language)

  const logSession = options.usageContext
    ? startAiEventLogSession(options.usageContext, {
        model: options.config.defaultModel || 'doubao-seed-asr-2.0',
        messages: [
          {
            role: 'user',
            content: `[audio ${options.mimeType}] language=${options.language}`,
          },
        ],
      })
    : undefined

  try {
    const response = await doFetch(ARK_ASR_FLASH_URL, {
      method: 'POST',
      headers: asrAuthHeaders(options.config.apiKey, requestId),
      body: JSON.stringify({
        user: { uid: 'instant-app' },
        audio: {
          data: options.audioBase64,
          format,
          ...(language ? { language } : {}),
        },
        request: {
          model_name: 'bigmodel',
          enable_itn: true,
          enable_punc: true,
          enable_ddc: true,
        },
      }),
      signal: options.signal,
    })

    const rawText = await response.text()
    if (!response.ok) {
      throw new Error(
        `方舟 ASR 请求失败（${response.status}）${rawText ? `：${rawText.slice(0, 200)}` : ''}`,
      )
    }

    let payload: AsrFlashPayload = {}
    if (rawText.trim()) {
      try {
        payload = JSON.parse(rawText) as AsrFlashPayload
      } catch {
        throw new Error('方舟 ASR 返回无法解析')
      }
    }

    const code = payload.code
    if (
      code !== undefined &&
      code !== 0 &&
      code !== '0' &&
      code !== 20000000 &&
      String(code) !== '20000000'
    ) {
      throw new Error(
        payload.message?.trim() || `方舟 ASR 错误码 ${String(code)}`,
      )
    }

    const text = extractAsrText(payload)
    if (!text) {
      throw new Error('识别结果为空')
    }

    logSession?.markFirstToken()
    options.onTextChunk?.(text, text)

    if (logSession && options.usageContext) {
      finishAiEventLogSession(logSession, options.usageContext, {
        response: text,
        status: 'success',
      })
    }

    return text
  } catch (error) {
    if (logSession && options.usageContext) {
      finishAiEventLogSession(logSession, options.usageContext, {
        response: '',
        status: options.signal?.aborted ? 'aborted' : 'error',
        errorMessage: error instanceof Error ? error.message : '语音识别失败',
      })
    }
    throw error
  }
}

export async function arkRecognizeSpeechStream(options: {
  config: OpenAiConfig
  audioBase64: string
  mimeType: 'audio/wav' | 'audio/mpeg' | 'audio/mp3'
  language: AsrLanguagePreference
  usageContext?: AiUsageContext
  signal?: AbortSignal
  onTextChunk?: (delta: string, accumulated: string) => void
}): Promise<string> {
  // Agent Plan 浏览器侧走 HTTP 极速识别；完成后一次性回调增量。
  return arkRecognizeSpeech(options)
}

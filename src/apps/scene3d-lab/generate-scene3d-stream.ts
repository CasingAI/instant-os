import {
  extractScene3dHtmlFromAiText,
  extractScene3dPartialHtmlFromStream,
} from './extract-scene3d-html.ts'
import {
  buildThinkingRequestExtras,
  readStreamDelta,
  resolveAppGenerationPhase,
  totalStreamTextLength,
} from '../../ai/ai-thinking.ts'
import { recordAiTokenUsage } from '../../ai/ai-token-usage.ts'
import { mergeOpenAiConfig } from '../../ai/openai-config.ts'
import { getOpenAiClient } from '../../ai/openai-client.ts'
import { buildScene3dBuilderPrompt } from '../../assets/3d/scene3d-prompt-sections.ts'
import type { TokenUsageSnapshot } from '../browser/browser-token-usage.ts'
import {
  buildLiveTokenUsage,
  estimatePromptTokens,
  finalizeTokenUsage,
  type LiveTokenUsage,
} from '../browser/estimate-token-usage.ts'

export type Scene3dGenerationPhase = 'waiting' | 'thinking' | 'generating'

export type Scene3dGenerationUpdate = {
  phase: Scene3dGenerationPhase
  progress: number
  textLength: number
  reasoningText: string
  contentText: string
  rawText: string
  html: string
  usage: LiveTokenUsage
  streamConnected?: boolean
}

export type Scene3dGenerationResult = {
  html: string
  rawText: string
  usage: LiveTokenUsage
}

export type Scene3dGenerationOptions = {
  physicsEnabled?: boolean
}

const EXPECTED_MAX_CHARS = 84 * 1000
const PROGRESS_START = 10
const PROGRESS_CAP = 92
const STREAM_EMIT_INTERVAL_MS = 120

function formatScene3dRawOutput(reasoningText: string, contentText: string): string {
  const reasoning = reasoningText.trim()
  const content = contentText.trim()
  if (!reasoning) {
    return contentText
  }
  if (!content) {
    return reasoningText
  }
  return `${reasoningText}\n\n${contentText}`
}

function pushUpdate(
  onUpdate: (update: Scene3dGenerationUpdate) => void,
  promptTokenEstimate: number,
  reasoningText: string,
  contentText: string,
  streamStarted: boolean,
  usage: TokenUsageSnapshot | undefined,
) {
  const phase = resolveAppGenerationPhase(reasoningText, contentText, streamStarted)
  const textLength = totalStreamTextLength(reasoningText, contentText)
  const generating = phase !== 'waiting'
  const liveUsage = buildLiveTokenUsage(
    promptTokenEstimate,
    formatScene3dRawOutput(reasoningText, contentText),
    !usage,
  )
  onUpdate({
    phase,
    progress: progressFromTextLength(textLength, generating),
    textLength,
    reasoningText,
    contentText,
    rawText: formatScene3dRawOutput(reasoningText, contentText),
    html: contentText.trim() ? extractScene3dPartialHtmlFromStream(contentText) : '',
    usage: liveUsage,
  })
}

function progressFromTextLength(textLength: number, generating: boolean): number {
  if (!generating) {
    return 0
  }
  if (textLength <= 0) {
    return PROGRESS_START
  }
  const ratio = Math.min(1, textLength / EXPECTED_MAX_CHARS)
  return PROGRESS_START + ratio * (PROGRESS_CAP - PROGRESS_START)
}

type OpenAIUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

function snapshotFromUsage(usage: OpenAIUsage | undefined): TokenUsageSnapshot | undefined {
  if (!usage) {
    return undefined
  }

  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  }
}

export function buildScene3dUserMessage(userPrompt: string, physicsEnabled = false): string {
  const physicsLabel = physicsEnabled ? ' · Rapier 物理已启用' : ''
  return `运行时：Three.js${physicsLabel}\n\n用户场景描述：\n${userPrompt.trim()}`
}

/** 调试面板用：展示与 OpenAI API 一致的 system + user 消息全文。 */
export function formatScene3dOutboundPrompt(userPrompt: string, physicsEnabled = false): string {
  const systemPrompt = buildScene3dBuilderPrompt(physicsEnabled)
  const userMessage = buildScene3dUserMessage(userPrompt, physicsEnabled)
  return [
    '──────── system ────────',
    systemPrompt,
    '',
    '──────── user ────────',
    userMessage,
  ].join('\n')
}

export async function generateScene3dHtmlStreaming(
  userPrompt: string,
  onUpdate: (update: Scene3dGenerationUpdate) => void,
  options: Scene3dGenerationOptions = {},
): Promise<Scene3dGenerationResult> {
  const config = mergeOpenAiConfig()
  const client = getOpenAiClient(config)
  const model = config.defaultModel
  const physicsEnabled = options.physicsEnabled === true
  const systemPrompt = buildScene3dBuilderPrompt(physicsEnabled)
  const userMessage = buildScene3dUserMessage(userPrompt, physicsEnabled)
  const promptTokenEstimate = estimatePromptTokens(systemPrompt, userMessage)

  let reasoningText = ''
  let contentText = ''
  let streamStarted = false
  let usage: TokenUsageSnapshot | undefined
  let liveUsage = buildLiveTokenUsage(promptTokenEstimate, '')
  let lastEmitAt = 0

  const emit = (force = false) => {
    const now = Date.now()
    if (!force && now - lastEmitAt < STREAM_EMIT_INTERVAL_MS) {
      return
    }
    lastEmitAt = now
    pushUpdate(onUpdate, promptTokenEstimate, reasoningText, contentText, streamStarted, usage)
  }

  onUpdate({
    phase: 'waiting',
    progress: 0,
    textLength: 0,
    reasoningText: '',
    contentText: '',
    rawText: '',
    html: '',
    usage: liveUsage,
  })

  const stream = await client.chat.completions.create({
    model,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    ...buildThinkingRequestExtras(config.providerId, config.thinkingEnabled),
  })

  emit(true)
  onUpdate({
    phase: 'waiting',
    progress: 0,
    textLength: 0,
    reasoningText: '',
    contentText: '',
    rawText: '',
    html: '',
    usage: buildLiveTokenUsage(promptTokenEstimate, '', true),
    streamConnected: true,
  })

  for await (const chunk of stream) {
    streamStarted = true
    if (chunk.usage) {
      usage = snapshotFromUsage(chunk.usage)
    }

    const { reasoning, content } = readStreamDelta(chunk.choices[0]?.delta)
    if (reasoning) {
      reasoningText += reasoning
      emit()
      continue
    }
    if (!content) {
      continue
    }

    contentText += content
    emit()
  }

  if (!contentText.trim()) {
    throw new Error('AI 未返回任何 3D 页面内容')
  }

  emit(true)
  liveUsage = finalizeTokenUsage(
    buildLiveTokenUsage(promptTokenEstimate, formatScene3dRawOutput(reasoningText, contentText), !usage),
    usage,
  )
  const html = extractScene3dHtmlFromAiText(contentText)
  const rawText = formatScene3dRawOutput(reasoningText, contentText)
  recordAiTokenUsage(
    { actor: 'scene3d-lab', behavior: 'generate-scene', behaviorLabel: '生成 3D 场景' },
    usage,
  )

  const result: Scene3dGenerationResult = { html, rawText, usage: liveUsage }
  onUpdate({
    phase: 'generating',
    progress: 100,
    textLength: totalStreamTextLength(reasoningText, contentText),
    reasoningText,
    contentText,
    rawText,
    html,
    usage: liveUsage,
  })
  return result
}

/** 内置示例提示词，便于在实验室中快速测试素材目录。 */
export const SCENE3D_SAMPLE_PROMPTS = [
  '布置一个 cozy 客厅：沙发、茶几、落地灯和地毯，中间留 walking space',
  '做一个简单卧室：双人床、台灯、小柜子和一张椅子',
  '户外小场景：房子、两棵树、邮箱、长椅和地面',
  '办公室角落：桌子、两把椅子、书架和仙人掌盆栽',
  '物理演示：大地面上空一排彩色箱子，再叠两层，启动后自然掉落堆叠',
] as const

export const SCENE3D_DEFAULT_PROMPT = SCENE3D_SAMPLE_PROMPTS[0]

import { extractHtmlFromAiText } from '../../ai/parse-json-response.ts'
import {
  buildThinkingRequestExtras,
  readStreamDelta,
  resolveAppGenerationPhase,
  resolveAppGenerationThinkingEnabled,
  totalStreamTextLength,
} from '../../ai/ai-thinking.ts'
import { recordAiTokenUsage } from '../../ai/ai-token-usage.ts'
import { snapshotFromOpenAiUsage } from '../../ai/openai-usage.ts'
import { mergeOpenAiConfig } from '../../ai/openai-config.ts'
import { getOpenAiClient } from '../../ai/openai-client.ts'
import { forEachStreamChunk, isStreamAbortError, raceWithAbortSignal } from '../../ai/stream-abort.ts'
import {
  buildApp3dSystemPromptExtension,
  resolveApp3dGenerationOptions,
} from '../appstore/app-3d-generation-prompt.ts'
import {
  buildAppAiSystemPromptExtension,
  resolveAppAiGenerationOptions,
} from '../appstore/app-ai-generation-prompt.ts'
import { formatListingTagsForPrompt } from '../appstore/listing-tags.ts'
import type { StoreListing } from '../appstore/types.ts'
import type { AppGenerationPhase } from '../appstore/generate-app-stream.ts'
import { progressFromTextLength } from '../appstore/generate-app-stream.ts'
import type { ICodeChatMessage } from './icode-types.ts'
import {
  IcodeGenerationAbortedError,
  throwIfIcodeGenerationAborted,
} from './icode-generation-abort.ts'
import {
  addLineNumbers,
  applyStreamEdits,
  createAiderBlockFeed,
  parseAiderEditBlocks,
  pickLastReplyParagraph,
  stripAiderEditBlocksFromContent,
  extractNaturalLanguageReply,
  type ICodeReplaceEdit,
} from './icode-apply-edits.ts'
import {
  buildIcodeBootstrapEditRules,
  buildIcodeCapabilityRequestPromptExtension,
  buildIcodeCapabilityUserPromptSection,
  shouldRevertUngrantedCapabilityCode,
} from './icode-capability-request.ts'

const ICODE_EDIT_SYSTEM_PROMPT = `你是 Instant OS 微应用的源码编辑助手。
用户已有完整 HTML 单页应用源码。你可以回答问题、解释代码，也可以按指令修改源码。

运行环境：你在 iCode 编辑器内工作。你输出的源码会自动写入当前项目并在预览区运行，用户无需也不应手动保存文件或粘贴代码。
自然语言部分只简述做了什么、实现了什么功能或如何操作应用本身；不提示「保存为 .html 文件」「粘贴到微应用/编辑器」「复制代码后运行」等脱离 iCode 的手动步骤。

回复结构（按顺序）：
1. 先用自然语言直接回答用户（解释、确认、提问澄清等）。这段会展示给用户，请用中文，简洁清楚。
2. 若且仅若需要改代码，在文字之后另起一段，输出 Aider 风格的 SEARCH/REPLACE 块；若只是提问或讨论、不需要改代码，不要输出任何 SEARCH/REPLACE 块。

SEARCH/REPLACE 格式：

\`\`\`html
<<<<<<< SEARCH
原有代码（必须与现有源码逐字一致）
=======
替换后的代码
>>>>>>> REPLACE
\`\`\`

编辑规则：
- 用户未要求修改时，只输出自然语言，不要输出 SEARCH/REPLACE
- SEARCH 段必须与现有源码逐字匹配（含空白、缩进、换行），且在全文内唯一出现
- SEARCH 段应足够长以唯一定位（建议至少 3 行或 40 个字符）
- 每个块只替换第一处匹配；多处修改请拆成多个块
- 禁止输出完整 HTML 文档代替 SEARCH/REPLACE
- 保持 HTML 完整合法；CSS 继续内联在 <style> 中
- 不使用外部 CDN、图片 URL 或网络请求；不使用 alert/confirm/prompt
- 需要持久化的数据继续使用 localStorage
- 预览在 iframe 内运行：尺寸应基于根容器（如 #app、canvas 父级）的 getBoundingClientRect 或 ResizeObserver，不要假设首帧即有正确宽高；勿依赖外层 OS 窗口 resize`

export type ICodeEditGenerationUpdate = {
  phase: AppGenerationPhase
  progress: number
  textLength: number
  reasoningText: string
  contentText: string
  visibleReply: string
  partialHtml?: string
  appliedEdits: number
}

export type ICodeEditGenerationResult = {
  html: string
  assistantSummary: string
  assistantReply: string
  appliedEdits: number
  failedEdits: number
  reasoningText: string
  outputText: string
  edits: ICodeReplaceEdit[]
}

function buildEditUserPrompt(
  listing: StoreListing,
  existingHtml: string,
  instruction: string,
): string {
  const trimmedHtml = existingHtml.trim()
  const isBootstrap = trimmedHtml.length === 0
  const numberedSource = isBootstrap ? '（空，尚无源码）' : addLineNumbers(trimmedHtml)
  const capabilitySection = buildIcodeCapabilityUserPromptSection(listing.tags)

  return [
    capabilitySection,
    '',
    `应用名称：${listing.name}`,
    `描述：${listing.description}`,
    `分类：${listing.category}`,
    `能力标签：${formatListingTagsForPrompt(listing.tags)}`,
    '',
    '【用户消息】',
    instruction.trim(),
    '',
    isBootstrap
      ? '【当前源码】空项目，尚未生成应用。'
      : '【当前源码（行号仅作参考，SEARCH 中不要包含行号前缀）】',
    numberedSource,
    '',
    isBootstrap
      ? '若不需要未授予能力，可输出完整 HTML；若需要未授予能力，只能 REQUEST_CAPABILITY，不要写代码。'
      : '若不需要未授予能力，请先自然语言回复，再附 SEARCH/REPLACE；若需要未授予能力，只能 REQUEST_CAPABILITY，不要写代码。',
  ].join('\n')
}

function buildEditSystemPrompt(listing: StoreListing, existingHtml: string): string {
  const isBootstrap = existingHtml.trim().length === 0
  const { is3d, physicsEnabled } = resolveApp3dGenerationOptions(listing, undefined, existingHtml)
  const { isAi } = resolveAppAiGenerationOptions(listing, undefined, existingHtml)

  const sections = [buildIcodeCapabilityRequestPromptExtension(listing.tags), ICODE_EDIT_SYSTEM_PROMPT]
  if (isBootstrap) {
    sections.push(buildIcodeBootstrapEditRules())
  }
  if (is3d) {
    sections.push(buildApp3dSystemPromptExtension(physicsEnabled))
  }
  if (isAi) {
    sections.push(buildAppAiSystemPromptExtension())
  }

  return sections.join('\n\n')
}

function chatMessageForApi(message: ICodeChatMessage): string {
  if (message.role === 'user') {
    return message.content.trim()
  }

  return (message.fullReply ?? message.content).trim()
}

type EditApiMessage = {
  role: 'user' | 'assistant'
  content: string
}

export function buildEditApiMessages(
  listing: StoreListing,
  existingHtml: string,
  instruction: string,
  priorChat: ICodeChatMessage[] = [],
): EditApiMessage[] {
  const messages: EditApiMessage[] = []

  for (const message of priorChat) {
    const content = chatMessageForApi(message)
    if (content) {
      messages.push({ role: message.role, content })
    }
  }

  messages.push({
    role: 'user',
    content: buildEditUserPrompt(listing, existingHtml, instruction),
  })

  return messages
}

const ICODE_CONTEXT_CHARS_PER_TOKEN = 2.5

function estimateIcodeTokensFromText(text: string): number {
  if (!text) {
    return 0
  }

  return Math.max(1, Math.ceil(text.length / ICODE_CONTEXT_CHARS_PER_TOKEN))
}

export type IcodeContextPayloadStats = {
  characters: number
  tokens: number
}

export function measureIcodeEditContextPayload(
  listing: StoreListing,
  existingHtml: string,
  instruction: string,
  priorChat: ICodeChatMessage[] = [],
): IcodeContextPayloadStats {
  const systemPrompt = buildEditSystemPrompt(listing, existingHtml)
  const conversation = buildEditApiMessages(listing, existingHtml, instruction, priorChat)
  let characters = systemPrompt.length + 8
  let tokens = estimateIcodeTokensFromText(systemPrompt) + 8

  for (const message of conversation) {
    characters += message.content.length + 4
    tokens += estimateIcodeTokensFromText(message.content) + 4
  }

  return { characters, tokens }
}

export function estimateIcodeEditContextTokens(
  listing: StoreListing,
  existingHtml: string,
  instruction: string,
  priorChat: ICodeChatMessage[] = [],
): number {
  return measureIcodeEditContextPayload(listing, existingHtml, instruction, priorChat).tokens
}

function looksLikeFullHtml(text: string): boolean {
  const trimmed = text.trim()
  return (
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html') ||
    /```(?:html)?\s*[\s\S]*<!DOCTYPE/i.test(trimmed)
  )
}

function buildAssistantReply(contentText: string): string {
  return extractNaturalLanguageReply(contentText)
}

function fallbackReply(appliedCount: number, failedEdits: number): string {
  if (appliedCount <= 0) {
    return '已完成。'
  }

  const base =
    appliedCount === 1 ? '已更新 1 处代码。' : `已更新 ${appliedCount} 处代码。`
  return failedEdits > 0 ? `${base}（${failedEdits} 处编辑未能匹配）` : base
}

function finalizeEditGenerationResult(
  result: ICodeEditGenerationResult,
  listing: StoreListing,
  existingHtml: string,
): ICodeEditGenerationResult {
  if (!shouldRevertUngrantedCapabilityCode(result.outputText, result.html, existingHtml, listing.tags)) {
    return result
  }

  return {
    ...result,
    html: existingHtml,
    appliedEdits: 0,
    failedEdits: 0,
    edits: [],
  }
}

export type ICodeEditStreamOptions = {
  signal?: AbortSignal
}

export async function generateIcodeHtmlEditsStreaming(
  listing: StoreListing,
  existingHtml: string,
  instruction: string,
  onUpdate?: (update: ICodeEditGenerationUpdate) => void,
  priorChat: ICodeChatMessage[] = [],
  options: ICodeEditStreamOptions = {},
): Promise<ICodeEditGenerationResult> {
  const config = mergeOpenAiConfig()
  const client = getOpenAiClient(config)
  const model = config.defaultModel
  const { is3d } = resolveApp3dGenerationOptions(listing, undefined, existingHtml)

  onUpdate?.({
    phase: 'waiting',
    progress: 0,
    textLength: 0,
    reasoningText: '',
    contentText: '',
    visibleReply: '',
    appliedEdits: 0,
  })

  const systemPrompt = buildEditSystemPrompt(listing, existingHtml)
  const apiMessages = buildEditApiMessages(listing, existingHtml, instruction, priorChat)

  const stream = await raceWithAbortSignal(
    client.chat.completions.create({
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: systemPrompt },
        ...apiMessages,
      ],
      ...buildThinkingRequestExtras(
        config.providerId,
        resolveAppGenerationThinkingEnabled(config.providerId, config.thinkingEnabled, model),
      ),
      ...(options.signal ? { signal: options.signal } : {}),
    }),
    options.signal,
  )

  let contentText = ''
  let reasoningText = ''
  let streamStarted = false
  let usage = snapshotFromOpenAiUsage(undefined)
  let lastEmitAt = 0
  let currentHtml = existingHtml
  const pendingEdits: ICodeReplaceEdit[] = []
  let appliedEditCount = 0

  const blockFeed = createAiderBlockFeed((edit) => {
    pendingEdits.push(edit)
    const result = applyStreamEdits(currentHtml, [edit])
    if (result.appliedCount > 0) {
      currentHtml = result.html
      appliedEditCount += 1
    }
  })

  const emit = (force = false) => {
    const now = Date.now()
    if (!force && now - lastEmitAt < 120) {
      return
    }
    lastEmitAt = now

    const phase = resolveAppGenerationPhase(reasoningText, contentText, streamStarted)
    const textLength = totalStreamTextLength(reasoningText, contentText)
    const generating = phase !== 'waiting'

    onUpdate?.({
      phase,
      progress: progressFromTextLength(textLength, generating, is3d),
      textLength,
      reasoningText,
      contentText,
      visibleReply: buildAssistantReply(contentText),
      partialHtml: appliedEditCount > 0 ? currentHtml : undefined,
      appliedEdits: appliedEditCount,
    })
  }

  try {
    await forEachStreamChunk(
      stream,
      (chunk) => {
        streamStarted = true
        const chunkUsage = snapshotFromOpenAiUsage(chunk.usage)
        if (chunkUsage) {
          usage = chunkUsage
        }
        const { reasoning, content } = readStreamDelta(chunk.choices[0]?.delta)
        if (reasoning) {
          reasoningText += reasoning
          emit()
          return
        }
        if (!content) {
          return
        }

        contentText += content
        blockFeed.push(content)
        emit()
      },
      options.signal,
    )
  } catch (error) {
    if (isStreamAbortError(error, options.signal)) {
      recordAiTokenUsage(
        { actor: 'icode', behavior: 'edit-app', behaviorLabel: '编辑应用' },
        usage,
      )
      throw new IcodeGenerationAbortedError()
    }
    throw error
  }

  throwIfIcodeGenerationAborted(options.signal)

  blockFeed.flush()

  emit(true)

  recordAiTokenUsage(
    { actor: 'icode', behavior: 'edit-app', behaviorLabel: '编辑应用' },
    usage,
  )

  const parsedEdits = parseAiderEditBlocks(contentText)
  const editsForFinal = parsedEdits.length > 0 ? parsedEdits : pendingEdits
  const assistantReply = buildAssistantReply(contentText)
  const fullReply = stripAiderEditBlocksFromContent(contentText)

  if (appliedEditCount === 0 && looksLikeFullHtml(contentText)) {
    const html = extractHtmlFromAiText(contentText)
    return finalizeEditGenerationResult(
      {
        html,
        assistantSummary: assistantReply || '已根据你的修改意见更新应用源码。',
        assistantReply: assistantReply || fullReply,
        appliedEdits: 0,
        failedEdits: 0,
        reasoningText,
        outputText: contentText,
        edits: [],
      },
      listing,
      existingHtml,
    )
  }

  const finalResult = applyStreamEdits(existingHtml, editsForFinal)
  const failedEdits = finalResult.failedEdits.length

  if (finalResult.appliedCount === 0) {
    if (looksLikeFullHtml(contentText)) {
      const html = extractHtmlFromAiText(contentText)
      return finalizeEditGenerationResult(
        {
          html,
          assistantSummary: assistantReply || '已根据你的修改意见更新应用源码。',
          assistantReply: assistantReply || fullReply,
          appliedEdits: 0,
          failedEdits: 0,
          reasoningText,
          outputText: contentText,
          edits: [],
        },
        listing,
        existingHtml,
      )
    }

    if (assistantReply || fullReply) {
      const displayReply = extractNaturalLanguageReply(contentText) || assistantReply
      return finalizeEditGenerationResult(
        {
          html: existingHtml,
          assistantSummary: displayReply || pickLastReplyParagraph(fullReply),
          assistantReply: displayReply || pickLastReplyParagraph(fullReply),
          appliedEdits: 0,
          failedEdits,
          reasoningText,
          outputText: contentText,
          edits: editsForFinal,
        },
        listing,
        existingHtml,
      )
    }

    const detail =
      finalResult.failedEdits[0]?.error ??
      (editsForFinal.length === 0 ? 'AI 未返回有效回复' : '所有编辑均未成功应用')
    throw new Error(`处理失败：${detail}`)
  }

  const summary = assistantReply || fallbackReply(finalResult.appliedCount, failedEdits)

  return finalizeEditGenerationResult(
    {
      html: finalResult.html,
      assistantSummary: summary,
      assistantReply: assistantReply || summary,
      appliedEdits: finalResult.appliedCount,
      failedEdits,
      reasoningText,
      outputText: contentText,
      edits: editsForFinal,
    },
    listing,
    existingHtml,
  )
}

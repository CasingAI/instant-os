import type OpenAI from 'openai'
import { createAgent } from '../../ai/create-agent.ts'
import type {
  AgentReasoningDeltaEvent,
  AgentTextDeltaEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AgentUsageEvent,
} from '../../ai/run-agent.ts'
import { osNowMs } from '../../os/os-clock.ts'
import type { VscodeAiMode } from './vscode-ai-mode.ts'
import {
  buildVscodeAiContextSection,
  buildVscodeAiSystemPrompt,
  type VscodeAiContextInput,
} from './vscode-ai-context.ts'
import {
  createVscodeAiTools,
  VSCODE_AI_TOOL_LABELS,
  type VscodeAiToolsHost,
} from './vscode-ai-tools.ts'
import type { OpenAiConfig } from '../../ai/openai-config.ts'
import { createOpenAiClient } from '../../ai/openai-client.ts'
import type { VscodeAiPendingEdit } from './vscode-ai-chat-storage.ts'
import {
  openAiConfigForVscodeAiModelKey,
  parseVscodeAiModelRefKey,
  tokenizerFamilyForVscodeAiModelKey,
} from './vscode-ai-models.ts'
import {
  applyVscodeAiPromptTokenUpdate,
  measureVscodeAiContextUsage,
  prepareVscodeAiContextUsage,
  type VscodeAiContextUsage,
} from './vscode-ai-context-usage.ts'

const VSCODE_AI_MAX_STEPS = 30
const TOOL_RESULT_LINE_LIMIT = 120
const TOOL_RESULT_CHAR_LIMIT = 12_000

export type VscodeAiActivity = {
  id: string
  label: string
  /** 摘要行副文案（如终端 description） */
  detail?: string
  /** 展开后展示的正文（如实际执行的代码） */
  content?: string
  /** 工具返回结果（如终端 stdout） */
  result?: string
  done?: boolean
}

export type VscodeAiTimelineItem =
  | {
      kind: 'activity'
      id: string
      label: string
      detail?: string
      content?: string
      result?: string
      done: boolean
    }
  | {
      kind: 'reasoning'
      id: string
      content: string
      done: boolean
      startedAt: number
      durationMs?: number
    }
  | {
      kind: 'text'
      id: string
      content: string
      done: boolean
    }

export type VscodeAiInvestigationStep =
  | Extract<VscodeAiTimelineItem, { kind: 'activity' }>
  | Extract<VscodeAiTimelineItem, { kind: 'reasoning' }>

export type VscodeAiInvestigation = {
  activities: VscodeAiActivity[]
  /** 与输出过程一致的步骤顺序（工具 / 思考穿插，不含正文） */
  timeline: VscodeAiInvestigationStep[]
  reasoningText?: string
  reasoningDurationMs?: number
  toolCallCount: number
  durationMs: number
}

export type VscodeAiAgentProgress = {
  activities: VscodeAiActivity[]
  timeline: VscodeAiTimelineItem[]
  answerText: string
  reasoningText: string
  toolCallCount: number
  pendingEdits: VscodeAiPendingEdit[]
  contextUsage?: VscodeAiContextUsage
}

export type VscodeAiAgentResult = {
  text: string
  toolCallCount: number
  pendingEdits: VscodeAiPendingEdit[]
  investigation: VscodeAiInvestigation
  incomplete?: boolean
  messages?: OpenAI.Chat.ChatCompletionMessageParam[]
}

function formatArgsSuffix(args: unknown): string {
  if (!Array.isArray(args)) return ''
  const parts = args.filter((item): item is string => typeof item === 'string')
  if (parts.length === 0) return ''
  return ` ${parts.join(' ')}`
}

function truncateToolResultForDisplay(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return '（无输出）'
  const lines = trimmed.split('\n')
  const sliced =
    lines.length > TOOL_RESULT_LINE_LIMIT
      ? lines.slice(-TOOL_RESULT_LINE_LIMIT).join('\n')
      : trimmed
  if (sliced.length <= TOOL_RESULT_CHAR_LIMIT) return sliced
  return `…（输出已截断）\n${sliced.slice(-TOOL_RESULT_CHAR_LIMIT)}`
}

function describeToolCall(event: AgentToolCallEvent): {
  label: string
  detail?: string
  content?: string
} {
  const label = VSCODE_AI_TOOL_LABELS[event.toolName] ?? event.toolName
  const args = event.arguments
  if (event.toolName === 'run_in_terminal') {
    const description =
      typeof args.description === 'string' ? args.description.trim() : ''
    const command = typeof args.command === 'string' ? args.command.trim() : ''
    return {
      label,
      detail: description || undefined,
      content: command || undefined,
    }
  }
  if (event.toolName === 'npm_run') {
    const script = typeof args.script === 'string' ? args.script.trim() : ''
    if (!script) return { label }
    const command = `npm run ${script}${formatArgsSuffix(args.args)}`
    return { label, detail: script, content: command }
  }
  if (event.toolName === 'npx') {
    const pkg = typeof args.package === 'string' ? args.package.trim() : ''
    if (!pkg) return { label }
    const command = `npx ${pkg}${formatArgsSuffix(args.args)}`
    return { label, detail: pkg, content: command }
  }
  const path =
    typeof args.path === 'string'
      ? args.path
      : typeof args.source === 'string'
        ? args.source
        : undefined
  const query = typeof args.query === 'string' ? args.query.trim() : undefined
  return {
    label,
    detail: query ? query.slice(0, 48) : path ? path.slice(-48) : undefined,
  }
}

function markTimelineDone(timeline: VscodeAiTimelineItem[]): VscodeAiTimelineItem[] {
  const now = osNowMs()
  return timeline.map((item) => {
    if (item.done) {
      return item
    }
    if (item.kind === 'reasoning') {
      return {
        ...item,
        done: true,
        durationMs: Math.max(0, now - item.startedAt),
      }
    }
    return { ...item, done: true }
  })
}

function activitiesFromTimeline(timeline: VscodeAiTimelineItem[]): VscodeAiActivity[] {
  return timeline
    .filter(
      (item): item is Extract<VscodeAiTimelineItem, { kind: 'activity' }> =>
        item.kind === 'activity',
    )
    .map((item) => ({
      id: item.id,
      label: item.label,
      detail: item.detail,
      content: item.content,
      result: item.result,
      done: item.done,
    }))
}

function combinedReasoningText(timeline: VscodeAiTimelineItem[]): string {
  return timeline
    .filter(
      (item): item is Extract<VscodeAiTimelineItem, { kind: 'reasoning' }> =>
        item.kind === 'reasoning',
    )
    .map((item) => item.content)
    .join('\n\n')
    .trim()
}

function totalReasoningDurationMs(timeline: VscodeAiTimelineItem[]): number | undefined {
  let total = 0
  let hasReasoning = false
  const now = osNowMs()
  for (const item of timeline) {
    if (item.kind !== 'reasoning') {
      continue
    }
    hasReasoning = true
    if (item.durationMs !== undefined) {
      total += item.durationMs
    } else if (!item.done) {
      total += Math.max(0, now - item.startedAt)
    }
  }
  return hasReasoning ? total : undefined
}

function investigationStepsFromTimeline(
  timeline: VscodeAiTimelineItem[],
): VscodeAiInvestigationStep[] {
  const now = osNowMs()
  return timeline
    .filter(
      (item): item is VscodeAiInvestigationStep =>
        item.kind === 'activity' || item.kind === 'reasoning',
    )
    .map((item) => {
      if (item.kind === 'reasoning') {
        return {
          ...item,
          done: true,
          durationMs: item.durationMs ?? Math.max(0, now - item.startedAt),
        }
      }
      return { ...item, done: true }
    })
}

export function buildVscodeAiInvestigationFromTimeline(
  timeline: VscodeAiTimelineItem[],
  options?: { toolCallCount?: number; startedAt?: number },
): VscodeAiInvestigation {
  const finalizedTimeline = markTimelineDone(timeline)
  const activities = activitiesFromTimeline(finalizedTimeline).map((item) => ({
    ...item,
    done: true,
  }))
  const reasoningText = combinedReasoningText(finalizedTimeline)
  const toolCallCount =
    options?.toolCallCount ??
    activities.length
  const startedAt = options?.startedAt ?? osNowMs()
  return {
    activities,
    timeline: investigationStepsFromTimeline(finalizedTimeline),
    reasoningText: reasoningText || undefined,
    reasoningDurationMs: totalReasoningDurationMs(finalizedTimeline),
    toolCallCount,
    durationMs: Math.max(0, osNowMs() - startedAt),
  }
}

export async function askVscodeAiAgent(options: {
  mode: VscodeAiMode
  userMessage: string
  context: VscodeAiContextInput
  toolsHost: VscodeAiToolsHost
  history?: OpenAI.Chat.ChatCompletionMessageParam[]
  signal?: AbortSignal
  modelKey?: string | undefined
  onProgress?: (progress: VscodeAiAgentProgress) => void
}): Promise<VscodeAiAgentResult> {
  const pendingEdits: VscodeAiPendingEdit[] = []
  const tools = createVscodeAiTools(options.mode, {
    ...options.toolsHost,
    onProposeEdit: (edit) => {
      pendingEdits.push(edit)
      options.toolsHost.onProposeEdit(edit)
    },
  })

  const system = `${buildVscodeAiSystemPrompt(options.mode)}\n\n【当前工作区快照】\n${buildVscodeAiContextSection(options.context)}`

  const modelConfig: OpenAiConfig = openAiConfigForVscodeAiModelKey(options.modelKey)
  const client = createOpenAiClient(modelConfig, 'text')
  const model = modelConfig.defaultModel
  const tokenizerFamily = tokenizerFamilyForVscodeAiModelKey(options.modelKey)

  await prepareVscodeAiContextUsage(model, tokenizerFamily)
  const modelRef = parseVscodeAiModelRefKey(options.modelKey)
  let contextUsage = measureVscodeAiContextUsage({
    mode: options.mode,
    context: options.context,
    history: options.history,
    userMessage: options.userMessage,
    model,
    providerEntryId: modelRef?.providerEntryId,
    tokenizerFamily,
    tools,
  })

  const agent = createAgent({
    prompt: system,
    tools,
    maxSteps: VSCODE_AI_MAX_STEPS,
    config: modelConfig,
    client,
    model,
    usageContext: {
      actor: 'vscode',
      behavior: options.mode,
      actorLabel: 'Virtual Studio Code',
      behaviorLabel:
        options.mode === 'ask' ? '问答' : options.mode === 'edit' ? '编辑' : '代理',
    },
  })

  const startedAt = osNowMs()
  let toolCallCount = 0
  const activities: VscodeAiActivity[] = []
  let timeline: VscodeAiTimelineItem[] = []
  let answerText = ''
  let reasoningText = ''
  let reasoningItemId: string | undefined
  let pendingActivityId: string | undefined

  const emit = () => {
    options.onProgress?.({
      activities: [...activities],
      timeline: [...timeline],
      answerText,
      reasoningText,
      toolCallCount,
      pendingEdits: [...pendingEdits],
      contextUsage,
    })
  }

  emit()

  let contextUsageCalibrated = false
  const onUsage = (event: AgentUsageEvent) => {
    if (event.promptTokens <= 0) return
    const next = applyVscodeAiPromptTokenUpdate(
      contextUsage,
      event.promptTokens,
      contextUsageCalibrated,
    )
    contextUsage = next.usage
    contextUsageCalibrated = next.calibrated
    emit()
  }

  const onToolCall = (event: AgentToolCallEvent) => {
    toolCallCount += 1
    const desc = describeToolCall(event)
    const id = `vscode-ai-act-${osNowMs()}-${toolCallCount}`
    pendingActivityId = id
    activities.push({
      id,
      label: desc.label,
      detail: desc.detail,
      content: desc.content,
      done: false,
    })
    timeline = markTimelineDone(timeline)
    timeline.push({
      kind: 'activity',
      id,
      label: desc.label,
      detail: desc.detail,
      content: desc.content,
      done: false,
    })
    emit()
  }

  const onToolResult = (event: AgentToolResultEvent) => {
    const id = pendingActivityId
    pendingActivityId = undefined
    if (!id) return
    const resultText = truncateToolResultForDisplay(event.result)
    const activityIndex = activities.findIndex((item) => item.id === id)
    if (activityIndex >= 0) {
      const current = activities[activityIndex]
      activities[activityIndex] = {
        ...current,
        result: resultText,
        done: true,
      }
    }
    timeline = timeline.map((item) => {
      if (item.kind !== 'activity' || item.id !== id) return item
      return { ...item, result: resultText, done: true }
    })
    emit()
  }

  const onTextDelta = (event: AgentTextDeltaEvent) => {
    answerText = event.accumulated
    const last = timeline[timeline.length - 1]
    if (last?.kind === 'text' && !last.done) {
      timeline = [...timeline.slice(0, -1), { ...last, content: answerText }]
    } else {
      timeline = markTimelineDone(timeline)
      timeline.push({
        kind: 'text',
        id: `vscode-ai-text-${osNowMs()}`,
        content: answerText,
        done: false,
      })
    }
    emit()
  }

  const onReasoningDelta = (event: AgentReasoningDeltaEvent) => {
    reasoningText = event.accumulated
    const last = timeline[timeline.length - 1]
    if (last?.kind === 'reasoning' && last.id === reasoningItemId) {
      timeline = [...timeline.slice(0, -1), { ...last, content: reasoningText }]
    } else {
      reasoningItemId = `vscode-ai-reason-${osNowMs()}`
      timeline = markTimelineDone(timeline)
      timeline.push({
        kind: 'reasoning',
        id: reasoningItemId,
        content: reasoningText,
        done: false,
        startedAt: osNowMs(),
      })
    }
    emit()
  }

  const result = await agent.run({
    input: options.userMessage,
    messages: options.history,
    signal: options.signal,
    onToolCall,
    onToolResult,
    onTextDelta,
    onReasoningDelta,
    onUsage,
  })

  timeline = markTimelineDone(timeline)
  emit()

  const investigation = buildVscodeAiInvestigationFromTimeline(timeline, {
    toolCallCount,
    startedAt,
  })

  return {
    text: result.text.trim() || answerText.trim(),
    toolCallCount,
    pendingEdits,
    investigation,
    incomplete: result.incomplete,
    messages: result.messages,
  }
}

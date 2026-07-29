import type OpenAI from 'openai'
import { createAgent } from '../../ai/create-agent.ts'
import type {
  AgentReasoningDeltaEvent,
  AgentTextDeltaEvent,
  AgentToolCallDeltaEvent,
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
import { wrapVscodeAiUserMessage } from './vscode-ai-system-reminder.ts'
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
import {
  extractPartialJsonStringField,
  isVscodeAiWriteTool,
  writeToolPreviewField,
  writeToolTitleField,
} from './vscode-ai-streaming-json.ts'

const VSCODE_AI_MAX_STEPS = 30
const WRITE_PREVIEW_STORE_LIMIT = 8_000
/** 工具结果 / 命令输出落盘与内存上限，降低长 Agent 回合 OOM 风险 */
const TOOL_RESULT_STORE_LIMIT = 4_000
const ACTIVITY_CONTENT_STORE_LIMIT = 4_000
const REASONING_STORE_LIMIT = 12_000

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

export type VscodeAiWritePhase = 'streaming' | 'writing' | 'done'

export type VscodeAiWriteItem = {
  kind: 'write'
  id: string
  toolName: string
  /** 显示名：计划名或文件路径 */
  title: string
  /** 流式/最终正文预览 */
  preview: string
  phase: VscodeAiWritePhase
  done: boolean
  result?: string
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
  | VscodeAiWriteItem

export type VscodeAiInvestigationStep =
  | Extract<VscodeAiTimelineItem, { kind: 'activity' }>
  | Extract<VscodeAiTimelineItem, { kind: 'reasoning' }>
  | Extract<VscodeAiTimelineItem, { kind: 'write' }>

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

function formatToolResultForDisplay(text: string): string {
  const trimmed = text.trim()
  return trimmed || '（无输出）'
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
    if (item.kind === 'write') {
      return {
        ...item,
        done: true,
        phase: 'done',
        preview: truncateWritePreview(item.preview),
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
  return truncateReasoningText(
    timeline
      .filter(
        (item): item is Extract<VscodeAiTimelineItem, { kind: 'reasoning' }> =>
          item.kind === 'reasoning',
      )
      .map((item) => item.content)
      .join('\n\n')
      .trim(),
  )
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

function truncateStoredText(text: string, limit: number, suffix = '\n…（已截断）'): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}${suffix}`
}

function truncateWritePreview(text: string): string {
  return truncateStoredText(text, WRITE_PREVIEW_STORE_LIMIT, '\n…（预览已截断）')
}

function truncateToolResult(text: string): string {
  return truncateStoredText(text, TOOL_RESULT_STORE_LIMIT)
}

function truncateActivityContent(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  return truncateStoredText(text, ACTIVITY_CONTENT_STORE_LIMIT)
}

function truncateReasoningText(text: string): string {
  return truncateStoredText(text, REASONING_STORE_LIMIT)
}

function writeCardTitle(
  toolName: string,
  phase: VscodeAiWritePhase,
): string {
  if (toolName === 'write_plan') {
    if (phase === 'streaming') return '正在生成计划'
    if (phase === 'writing') return '正在写入计划'
    return '已写入计划'
  }
  if (toolName === 'propose_file_edit') {
    if (phase === 'streaming') return '正在生成文件'
    if (phase === 'writing') return '正在提交修改'
    return '已提交修改提案'
  }
  const label = VSCODE_AI_TOOL_LABELS[toolName] ?? toolName
  if (phase === 'done') return label
  return `正在${label}`
}

export function formatVscodeAiWriteCardHeading(
  toolName: string,
  phase: VscodeAiWritePhase,
): string {
  return writeCardTitle(toolName, phase)
}

function parseWriteToolArgs(
  toolName: string,
  args: Record<string, unknown>,
): { title: string; preview: string } {
  const titleKey = writeToolTitleField(toolName)
  const previewKey = writeToolPreviewField(toolName)
  const titleRaw =
    titleKey && typeof args[titleKey] === 'string' ? (args[titleKey] as string).trim() : ''
  const previewRaw =
    previewKey && typeof args[previewKey] === 'string' ? (args[previewKey] as string) : ''
  return {
    title: titleRaw || (toolName === 'write_plan' ? '未命名计划' : '未命名文件'),
    preview: previewRaw,
  }
}

function parseWriteToolArgsRaw(
  toolName: string,
  argumentsRaw: string,
): { title: string; preview: string } {
  const titleKey = writeToolTitleField(toolName)
  const previewKey = writeToolPreviewField(toolName)
  const title =
    (titleKey ? extractPartialJsonStringField(argumentsRaw, titleKey)?.trim() : undefined) ||
    (toolName === 'write_plan' ? '计划' : '文件')
  const preview =
    (previewKey ? extractPartialJsonStringField(argumentsRaw, previewKey) : undefined) ?? ''
  return { title, preview }
}

function investigationStepsFromTimeline(
  timeline: VscodeAiTimelineItem[],
): VscodeAiInvestigationStep[] {
  const now = osNowMs()
  return timeline
    .filter(
      (item): item is VscodeAiInvestigationStep =>
        item.kind === 'activity' || item.kind === 'reasoning' || item.kind === 'write',
    )
    .map((item) => {
      if (item.kind === 'reasoning') {
        return {
          ...item,
          content: truncateReasoningText(item.content),
          done: true,
          durationMs: item.durationMs ?? Math.max(0, now - item.startedAt),
        }
      }
      if (item.kind === 'write') {
        return {
          ...item,
          done: true,
          phase: 'done',
          preview: truncateWritePreview(item.preview),
          result: item.result ? truncateToolResult(item.result) : item.result,
        }
      }
      return {
        ...item,
        content: truncateActivityContent(item.content),
        result: item.result ? truncateToolResult(item.result) : item.result,
        done: true,
      }
    })
}

export function buildVscodeAiInvestigationFromTimeline(
  timeline: VscodeAiTimelineItem[],
  options?: { toolCallCount?: number; startedAt?: number },
): VscodeAiInvestigation {
  const finalizedTimeline = markTimelineDone(timeline)
  const activities = activitiesFromTimeline(finalizedTimeline).map((item) => ({
    ...item,
    content: truncateActivityContent(item.content),
    result: item.result ? truncateToolResult(item.result) : item.result,
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
  /** 本轮已算好的 system-reminder 正文（可为空）；由 panel 按事件收集 */
  reminderText?: string
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
  const wrappedUserMessage = wrapVscodeAiUserMessage(
    options.userMessage,
    options.reminderText ?? '',
  )

  const modelConfig: OpenAiConfig = openAiConfigForVscodeAiModelKey(options.modelKey)
  const client = createOpenAiClient(modelConfig, 'text')
  const model = modelConfig.defaultModel
  const tokenizerFamily = tokenizerFamilyForVscodeAiModelKey(options.modelKey)

  await prepareVscodeAiContextUsage(model, tokenizerFamily)
  const modelRef = parseVscodeAiModelRefKey(options.modelKey)
  let contextUsage = await measureVscodeAiContextUsage({
    mode: options.mode,
    context: options.context,
    history: options.history,
    userMessage: wrappedUserMessage,
    reminderText: options.reminderText,
    userMessageAlreadyWrapped: true,
    model,
    providerEntryId: modelRef?.providerEntryId,
    tokenizerFamily,
    tools,
  })

  const behaviorLabel =
    options.mode === 'ask'
      ? '问答'
      : options.mode === 'plan'
        ? '计划'
        : options.mode === 'edit'
          ? '编辑'
          : '代理'

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
      behaviorLabel,
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
  let pendingWriteId: string | undefined
  /** step → index → write timeline id（流式阶段） */
  const writeIdsByStepIndex = new Map<string, string>()

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

  const onToolCallDelta = (event: AgentToolCallDeltaEvent) => {
    if (!isVscodeAiWriteTool(event.toolName)) return
    const key = `${event.step}:${event.index}`
    let id = writeIdsByStepIndex.get(key)
    const parsed = parseWriteToolArgsRaw(event.toolName, event.argumentsRaw)
    if (!id) {
      id = `vscode-ai-write-${osNowMs()}-${event.step}-${event.index}`
      writeIdsByStepIndex.set(key, id)
      timeline = markTimelineDone(timeline)
      timeline.push({
        kind: 'write',
        id,
        toolName: event.toolName,
        title: parsed.title,
        preview: truncateWritePreview(parsed.preview),
        phase: 'streaming',
        done: false,
      })
      emit()
      return
    }
    timeline = timeline.map((item) => {
      if (item.kind !== 'write' || item.id !== id || item.done) return item
      return {
        ...item,
        toolName: event.toolName || item.toolName,
        title: parsed.title || item.title,
        preview: truncateWritePreview(parsed.preview),
        phase: 'streaming',
      }
    })
    emit()
  }

  const onToolCall = (event: AgentToolCallEvent) => {
    toolCallCount += 1
    if (isVscodeAiWriteTool(event.toolName)) {
      const parsed = parseWriteToolArgs(event.toolName, event.arguments)
      const key =
        event.index !== undefined ? `${event.step}:${event.index}` : undefined
      const existingId = key ? writeIdsByStepIndex.get(key) : undefined
      const existing = existingId
        ? timeline.find(
            (item): item is VscodeAiWriteItem =>
              item.kind === 'write' && item.id === existingId,
          )
        : [...timeline]
            .reverse()
            .find(
              (item): item is VscodeAiWriteItem =>
                item.kind === 'write' &&
                !item.done &&
                item.toolName === event.toolName &&
                item.phase === 'streaming',
            )
      if (existing) {
        pendingWriteId = existing.id
        timeline = timeline.map((item) => {
          if (item.kind !== 'write' || item.id !== existing.id) return item
          return {
            ...item,
            title: parsed.title,
            preview: truncateWritePreview(parsed.preview),
            phase: 'writing',
            done: false,
          }
        })
        emit()
        return
      }
      const id = `vscode-ai-write-${osNowMs()}-${toolCallCount}`
      pendingWriteId = id
      if (key) writeIdsByStepIndex.set(key, id)
      timeline = markTimelineDone(timeline)
      timeline.push({
        kind: 'write',
        id,
        toolName: event.toolName,
        title: parsed.title,
        preview: truncateWritePreview(parsed.preview),
        phase: 'writing',
        done: false,
      })
      emit()
      return
    }

    const desc = describeToolCall(event)
    const id = `vscode-ai-act-${osNowMs()}-${toolCallCount}`
    pendingActivityId = id
    const content = truncateActivityContent(desc.content)
    activities.push({
      id,
      label: desc.label,
      detail: desc.detail,
      content,
      done: false,
    })
    timeline = markTimelineDone(timeline)
    timeline.push({
      kind: 'activity',
      id,
      label: desc.label,
      detail: desc.detail,
      content,
      done: false,
    })
    emit()
  }

  const onToolResult = (event: AgentToolResultEvent) => {
    const resultText = truncateToolResult(formatToolResultForDisplay(event.result))
    if (pendingWriteId) {
      const id = pendingWriteId
      pendingWriteId = undefined
      let titleFromResult: string | undefined
      if (event.toolName === 'write_plan') {
        const match = /已写入计划并打开：(.+)$/.exec(event.result.trim())
        if (match?.[1]) titleFromResult = match[1].trim()
      } else if (event.toolName === 'propose_file_edit') {
        const match = /已提交修改提案：(.+?)（/.exec(event.result.trim())
        if (match?.[1]) titleFromResult = match[1].trim()
      }
      timeline = timeline.map((item) => {
        if (item.kind !== 'write' || item.id !== id) return item
        return {
          ...item,
          title: titleFromResult || item.title,
          preview: truncateWritePreview(item.preview),
          phase: 'done',
          done: true,
          result: resultText,
        }
      })
      emit()
      return
    }

    const id = pendingActivityId
    pendingActivityId = undefined
    if (!id) return
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
    reasoningText = truncateReasoningText(event.accumulated)
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
    input: wrappedUserMessage,
    messages: options.history,
    signal: options.signal,
    onToolCall,
    onToolResult,
    onToolCallDelta,
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

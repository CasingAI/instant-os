import type OpenAI from 'openai'
import { createAgent } from '../../ai/create-agent.ts'
import type {
  AgentCompressionEvent,
  AgentReasoningDeltaEvent,
  AgentTextDeltaEvent,
  AgentToolCallDeltaEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AgentUsageEvent,
} from '../../ai/run-agent.ts'
import { formatSpillHint } from '../../ai/context-compression/index.ts'
import { osNowMs } from '../../os/os-clock.ts'
import type { VscodeAiMode } from './vscode-ai-mode.ts'
import {
  buildVscodeAiContextSection,
  buildVscodeAiSystemPrompt,
  type VscodeAiContextInput,
} from './vscode-ai-context.ts'
import {
  buildSubAgentDelegationPromptSection,
  createDelegateSubAgentTool,
  listAvailableSubAgents,
  type RunSubAgentFn,
  type SubAgentHostConfig,
} from '../../ai/subagent/index.ts'
import {
  startRun,
  updateProgress,
  completeRun,
  failRun,
} from './vscode-subagent-store.ts'
import {
  createVscodeAiTools,
  VSCODE_AI_TOOL_LABELS,
  type VscodeAiToolsHost,
} from './vscode-ai-tools.ts'
import { wrapVscodeAiUserMessage } from './vscode-ai-system-reminder.ts'
import type { OpenAiConfig } from '../../ai/openai-config.ts'
import { createOpenAiClient } from '../../ai/openai-client.ts'
import {
  labelForVscodeAiModel,
  listVscodeAiTextModels,
  openAiConfigForVscodeAiModelKey,
  parseVscodeAiModelRefKey,
  tokenizerFamilyForVscodeAiModelKey,
} from './vscode-ai-models.ts'
import {
  applyVscodeAiPromptTokenUpdate,
  measureVscodeAiContextUsage,
  prepareVscodeAiContextUsage,
  resolveModelContextWindow,
  type VscodeAiContextUsage,
} from './vscode-ai-context-usage.ts'
import {
  extractPartialJsonStringField,
  isVscodeAiWriteTool,
  writeToolPreviewField,
  writeToolTitleField,
} from './vscode-ai-streaming-json.ts'
import { TERMINAL_OUTPUT_SPILL_UI_RESULT_LIMIT, writeSpillFile } from './vscode-ai-output-spill.ts'
import { formatCompactTokenCount } from '../browser/format-token-count.ts'

const VSCODE_AI_MAX_STEPS = 30
const WRITE_PREVIEW_STORE_LIMIT = 8_000
/** 工具结果 / 命令输出落盘与内存上限；对齐 spill preview（16K + header/hint 余量） */
const TOOL_RESULT_STORE_LIMIT = TERMINAL_OUTPUT_SPILL_UI_RESULT_LIMIT
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
  /** 关联的 Sub Agent runId，用于打开详情 Tab */
  subagentRunId?: string
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
      subagentRunId?: string
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
  | {
      kind: 'compression'
      id: string
      label: string
      detail?: string
      summaryPreview?: string
      beforeTokens: number
      afterTokens: number
      compressionKind: AgentCompressionEvent['kind']
      done: boolean
    }
  | VscodeAiWriteItem

export type VscodeAiInvestigationStep =
  | Extract<VscodeAiTimelineItem, { kind: 'activity' }>
  | Extract<VscodeAiTimelineItem, { kind: 'reasoning' }>
  | Extract<VscodeAiTimelineItem, { kind: 'write' }>
  | Extract<VscodeAiTimelineItem, { kind: 'compression' }>

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
  contextUsage?: VscodeAiContextUsage
}

export type VscodeAiAgentResult = {
  text: string
  toolCallCount: number
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
  if (event.toolName === 'delegate_subagent') {
    const agentId = typeof args.agent_id === 'string' ? args.agent_id.trim() : ''
    const description =
      typeof args.description === 'string' ? args.description.trim() : ''
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
    return {
      label: agentId ? `${label} · ${agentId}` : label,
      detail: description || undefined,
      content: prompt || undefined,
    }
  }
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
    title: titleRaw || (toolName === 'write_plan' ? '未命名计划' : toolName),
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
    (toolName === 'write_plan' ? '计划' : toolName)
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
        item.kind === 'activity' ||
        item.kind === 'reasoning' ||
        item.kind === 'write' ||
        item.kind === 'compression',
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
      if (item.kind === 'compression') {
        return { ...item, done: true }
      }
      return {
        ...item,
        content: truncateActivityContent(item.content),
        result: item.result ? truncateToolResult(item.result) : item.result,
        done: true,
      }
    })
}

function formatCompressionLabel(event: AgentCompressionEvent): string {
  const before = formatCompactTokenCount(event.beforeTokens)
  const after = formatCompactTokenCount(event.afterTokens)
  switch (event.kind) {
    case 'tool_budget':
      return event.spilled
        ? `工具输出已外置（约 ${before} → ${after}）`
        : `工具输出已裁剪（约 ${before} → ${after}）`
    case 'structure_fold':
      return `已折叠工具轨迹（约 ${before} → ${after}）`
    case 'reasoning_prune':
      return `已修剪思维链（约 ${before} → ${after}）`
    case 'tail_window':
      return `已省略更早回合（约 ${before} → ${after}）`
    case 'llm_compact':
      return `上下文已压缩（约 ${before} → ${after}）`
    case 'self_compact':
      return `模型请求压缩（约 ${before} → ${after}）`
    default:
      return `上下文已压缩（约 ${before} → ${after}）`
  }
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
  /** 应用侧构建的 Sub Agent 配置；enabled 且有可用 Agent 时注册委派工具 */
  subAgentConfig?: SubAgentHostConfig
  onProgress?: (progress: VscodeAiAgentProgress) => void
  /** 子 Agent 运行时：覆盖默认 system prompt（使用子 Agent 自带 prompt） */
  systemPromptOverride?: string
  /** 子 Agent 运行时：覆盖默认 maxSteps */
  maxStepsOverride?: number
  /** 单轮流空闲超时后的额外重试次数（不含首次）；默认 10 */
  idleRetryCount?: number
}): Promise<VscodeAiAgentResult> {
  const tools = createVscodeAiTools(options.mode, options.toolsHost)

  const contextSection = buildVscodeAiContextSection(options.context)
  let system = options.systemPromptOverride
    ? `${options.systemPromptOverride}\n\n【当前工作区快照】\n${contextSection}`
    : `${buildVscodeAiSystemPrompt(options.mode)}\n\n【当前工作区快照】\n${contextSection}`

  const subAgentConfig = options.subAgentConfig
  if (subAgentConfig) {
    const available = listAvailableSubAgents(subAgentConfig)

    /** 为每个子 Agent 运行解析模型标签 */
    const modelLabelFor = (modelKey: string | undefined): string => {
      if (!modelKey) return '未配置'
      const ref = parseVscodeAiModelRefKey(modelKey)
      if (!ref) return modelKey
      const model = listVscodeAiTextModels().find(
        (item) =>
          item.providerEntryId === ref.providerEntryId && item.modelId === ref.modelId,
      )
      return model ? labelForVscodeAiModel(model) : modelKey
    }

    /** 子 Agent 运行函数：复用 askVscodeAiAgent，获得完整 timeline/investigation/messages */
    const runSubAgentFn: RunSubAgentFn = async ({ definition, taskPrompt, signal, onProgress }) => {
      const subMode = definition.access === 'readonly' ? 'ask' : 'agent'
      const result = await askVscodeAiAgent({
        mode: subMode,
        userMessage: taskPrompt,
        context: options.context,
        toolsHost: options.toolsHost,
        signal: signal ?? options.signal,
        modelKey: definition.modelKey ?? options.modelKey,
        systemPromptOverride: definition.systemPrompt,
        idleRetryCount: options.idleRetryCount,
        onProgress: (progress) => {
          onProgress?.(progress)
        },
      })
      return {
        text: result.text,
        toolCallCount: result.toolCallCount,
        incomplete: result.incomplete,
        finalResult: result,
      }
    }

    const delegateTool = createDelegateSubAgentTool({
      config: subAgentConfig,
      getToolsForAccess: (access) =>
        createVscodeAiTools(access === 'readonly' ? 'ask' : 'agent', options.toolsHost),
      getEnvironmentSection: () => contextSection,
      signal: options.signal,
      runSubAgentFn,
      onSubAgentProgress: (event) => {
        if (event.phase === 'started') {
          startRun(
            event.runId,
            event.agentId,
            event.description,
            event.taskPrompt ?? event.description,
            event.modelKey,
            modelLabelFor(event.modelKey),
          )
          pendingSubagentRunId = event.runId
          subagentCompleted = false
          // 立即把 runId 关联到正在进行的 activity，让「查看详情」按钮在运行中即可出现
          if (pendingActivityId) {
            const actIdx = activities.findIndex((item) => item.id === pendingActivityId)
            if (actIdx >= 0) {
              activities[actIdx] = { ...activities[actIdx], subagentRunId: event.runId }
            }
            timeline = timeline.map((item) => {
              if (item.kind !== 'activity' || item.id !== pendingActivityId) return item
              return { ...item, subagentRunId: event.runId }
            })
            emit()
          }
        }
        if (event.phase === 'progress' && event.progress) {
          updateProgress(event.runId, event.progress as VscodeAiAgentProgress)
        }
        if (event.phase === 'done') {
          completeRun(
            event.runId,
            (event.finalResult as VscodeAiAgentResult | undefined) ?? {
              text: event.text ?? '',
              toolCallCount: event.toolCallCount ?? 0,
              investigation: {
                activities: [],
                timeline: [],
                toolCallCount: event.toolCallCount ?? 0,
                durationMs: 0,
              },
              incomplete: event.incomplete,
            },
          )
          subagentCompleted = true
        }
      },
    })
    if (delegateTool) {
      tools.push(delegateTool)
      const section = buildSubAgentDelegationPromptSection(available)
      if (section) {
        system = `${system}\n\n${section}`
      }
    }
  }
  const wrappedUserMessage = wrapVscodeAiUserMessage(
    options.userMessage,
    options.reminderText ?? '',
  )

  const modelConfig: OpenAiConfig = openAiConfigForVscodeAiModelKey(options.modelKey)
  const client = createOpenAiClient(modelConfig, 'text')
  const model = modelConfig.defaultModel
  const tokenizerFamily = tokenizerFamilyForVscodeAiModelKey(options.modelKey)

  await prepareVscodeAiContextUsage(model, tokenizerFamily)
  const modelRef = parseVscodeAiModelRefKey(options.modelKey ?? '')
  let contextUsage = await measureVscodeAiContextUsage({
    mode: options.mode,
    context: options.context,
    history: options.history,
    userMessage: wrappedUserMessage,
    reminderText: options.reminderText,
    userMessageAlreadyWrapped: true,
    model,
    providerEntryId: modelRef?.providerEntryId,
    modelKey: options.modelKey,
    tokenizerFamily,
    tools,
  })

  const behaviorLabel =
    options.mode === 'ask' ? '问答' : options.mode === 'plan' ? '计划' : '代理'

  const contextWindow = resolveModelContextWindow(model, {
    providerEntryId: modelRef?.providerEntryId,
    modelKey: options.modelKey,
  })

  const tmpDir = options.context.aiTerminal?.tmpdir?.trim()

  const agent = createAgent({
    prompt: system,
    tools,
    maxSteps: options.maxStepsOverride ?? VSCODE_AI_MAX_STEPS,
    config: modelConfig,
    client,
    model,
    idleTimeoutMs: 60_000,
    idleRetryCount: options.idleRetryCount ?? 10,
    usageContext: {
      actor: 'vscode',
      behavior: options.mode,
      actorLabel: 'Virtual Studio Code',
      behaviorLabel,
    },
    compression: {
      enabled: true,
      contextWindow,
      spill: tmpDir
        ? {
            write: async (text) =>
              writeSpillFile({ fullText: text, tmpDir, subdir: 'context-spill' }),
            hint: formatSpillHint,
          }
        : undefined,
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
  let pendingSubagentRunId: string | undefined
  let subagentCompleted = false
  /** step → index → write timeline id（流式阶段） */
  const writeIdsByStepIndex = new Map<string, string>()

  const emit = () => {
    options.onProgress?.({
      activities: [...activities],
      timeline: [...timeline],
      answerText,
      reasoningText,
      toolCallCount,
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

  const onContextCompression = (event: AgentCompressionEvent) => {
    // 跳过过于嘈杂的单条 tool_budget（除非 spilled）；结构/LLM 压缩始终展示
    if (event.kind === 'tool_budget' && !event.spilled) return
    timeline = markTimelineDone(timeline)
    timeline.push({
      kind: 'compression',
      id: event.id,
      label: formatCompressionLabel(event),
      detail: event.note,
      summaryPreview: event.summaryPreview,
      beforeTokens: event.beforeTokens,
      afterTokens: event.afterTokens,
      compressionKind: event.kind,
      done: true,
    })
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
    if (!event.synthetic) {
      toolCallCount += 1
    }
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
    const id = `vscode-ai-act-${osNowMs()}-${toolCallCount}${event.synthetic ? '-syn' : ''}`
    pendingActivityId = id
    const label = event.synthetic ? `${desc.label} · 自动` : desc.label
    const content = truncateActivityContent(desc.content)
    activities.push({
      id,
      label,
      detail: desc.detail,
      content,
      done: false,
    })
    timeline = markTimelineDone(timeline)
    timeline.push({
      kind: 'activity',
      id,
      label,
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
    const subagentRunId = pendingSubagentRunId
    pendingSubagentRunId = undefined
    if (!id) return
    const activityIndex = activities.findIndex((item) => item.id === id)
    if (activityIndex >= 0) {
      const current = activities[activityIndex]
      activities[activityIndex] = {
        ...current,
        result: resultText,
        done: true,
        subagentRunId: subagentRunId || current.subagentRunId,
      }
    }
    // 如果子 Agent 未正常完成（抛错），标记失败
    if (subagentRunId && !subagentCompleted) {
      failRun(subagentRunId, resultText)
    }
    subagentCompleted = false
    timeline = timeline.map((item) => {
      if (item.kind !== 'activity' || item.id !== id) return item
      return { ...item, result: resultText, done: true, subagentRunId: subagentRunId || item.subagentRunId }
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
    onContextCompression,
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
    investigation,
    incomplete: result.incomplete,
    messages: result.messages,
  }
}

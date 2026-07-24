import type OpenAI from 'openai'
import { createAgent } from '../../ai/create-agent.ts'
import type {
  AgentReasoningDeltaEvent,
  AgentTextDeltaEvent,
  AgentToolCallEvent,
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
import { openAiConfigForVscodeAiModelKey } from './vscode-ai-models.ts'

const VSCODE_AI_MAX_STEPS = 30

export type VscodeAiActivity = {
  id: string
  label: string
  detail?: string
  done?: boolean
}

export type VscodeAiTimelineItem =
  | {
      kind: 'activity'
      id: string
      label: string
      detail?: string
      done: boolean
    }
  | {
      kind: 'reasoning'
      id: string
      content: string
      done: boolean
    }
  | {
      kind: 'text'
      id: string
      content: string
      done: boolean
    }

export type VscodeAiAgentProgress = {
  activities: VscodeAiActivity[]
  timeline: VscodeAiTimelineItem[]
  answerText: string
  reasoningText: string
  toolCallCount: number
  pendingEdits: VscodeAiPendingEdit[]
}

export type VscodeAiAgentResult = {
  text: string
  toolCallCount: number
  pendingEdits: VscodeAiPendingEdit[]
  incomplete?: boolean
  messages?: OpenAI.Chat.ChatCompletionMessageParam[]
}

function describeToolCall(event: AgentToolCallEvent): { label: string; detail?: string } {
  const label = VSCODE_AI_TOOL_LABELS[event.toolName] ?? event.toolName
  const args = event.arguments
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
  return timeline.map((item) => {
    if (item.kind === 'activity' && !item.done) {
      return { ...item, done: true }
    }
    if (item.kind === 'reasoning' && !item.done) {
      return { ...item, done: true }
    }
    if (item.kind === 'text' && !item.done) {
      return { ...item, done: true }
    }
    return item
  })
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

  const agent = createAgent({
    prompt: system,
    tools,
    maxSteps: VSCODE_AI_MAX_STEPS,
    config: modelConfig,
    client,
    model: modelConfig.defaultModel,
    usageContext: {
      actor: 'vscode',
      behavior: options.mode,
      actorLabel: 'Virtual Studio Code',
      behaviorLabel:
        options.mode === 'ask' ? '问答' : options.mode === 'edit' ? '编辑' : '代理',
    },
  })

  let toolCallCount = 0
  const activities: VscodeAiActivity[] = []
  let timeline: VscodeAiTimelineItem[] = []
  let answerText = ''
  let reasoningText = ''
  let reasoningItemId: string | undefined

  const emit = () => {
    options.onProgress?.({
      activities: [...activities],
      timeline: [...timeline],
      answerText,
      reasoningText,
      toolCallCount,
      pendingEdits: [...pendingEdits],
    })
  }

  const onToolCall = (event: AgentToolCallEvent) => {
    toolCallCount += 1
    const desc = describeToolCall(event)
    const id = `vscode-ai-act-${osNowMs()}-${toolCallCount}`
    activities.push({ id, label: desc.label, detail: desc.detail, done: true })
    timeline = markTimelineDone(timeline)
    timeline.push({
      kind: 'activity',
      id,
      label: desc.label,
      detail: desc.detail,
      done: true,
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
      timeline.push({
        kind: 'reasoning',
        id: reasoningItemId,
        content: reasoningText,
        done: false,
      })
    }
    emit()
  }

  const result = await agent.run({
    input: options.userMessage,
    messages: options.history,
    signal: options.signal,
    onToolCall,
    onTextDelta,
    onReasoningDelta,
  })

  timeline = markTimelineDone(timeline)
  emit()

  return {
    text: result.text.trim() || answerText.trim(),
    toolCallCount,
    pendingEdits,
    incomplete: result.incomplete,
    messages: result.messages,
  }
}

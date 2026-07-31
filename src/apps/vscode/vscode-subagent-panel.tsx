import type OpenAI from 'openai'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { VscodeAiPanel } from './vscode-ai-panel.tsx'
import type { VscodeAiChatMessage } from './vscode-ai-chat-storage.ts'
import type {
  VscodeAiAgentResult,
  VscodeAiInvestigation,
  VscodeAiTimelineItem,
} from './vscode-ai-agent.ts'
import { createVscodeAiChatMessage } from './vscode-ai-chat-storage.ts'
import { getRun, subscribe, type SubagentRunState } from './vscode-subagent-store.ts'
import type { VscodeAiContextInput } from './vscode-ai-context.ts'
import { isSyntheticUserContextMessage } from './vscode-ai-transcript.ts'

export type VscodeSubagentPanelProps = {
  runId: string
  /** 父对话提供的工作区上下文（只读展示，无写操作） */
  getContext: () => VscodeAiContextInput
  /** 父对话提供的模型来源/键（仅用于展示，readOnly 下不触发切换） */
  aiModelSource?: 'text-secondary' | 'text' | 'custom'
  aiModelKey?: string
  dark?: boolean
  workspaceFolder?: string
}

/** 空上下文：子 Agent 详情只读展示，不参与实际运行 */
function emptyContext(): VscodeAiContextInput {
  return {
    workspaceFolder: undefined,
    tabs: [],
    activeTabId: undefined,
    editor: { activePath: undefined, cursorLine: 0, cursorColumn: 0, selectionText: undefined },
    problems: [],
  }
}

function statusLabel(state: SubagentRunState): string {
  return state.status
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part) {
        return String((part as { text?: unknown }).text ?? '')
      }
      return ''
    })
    .join('')
}

/** 去掉注入的 system-reminder，详情里只展示主 Agent 原话 */
function stripSystemReminder(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, '').trim()
}

/** 从完成结果构建一条 assistant 消息（含 investigation） */
function buildAssistantMessage(
  text: string,
  result?: VscodeAiAgentResult,
  extras?: { isError?: boolean },
): VscodeAiChatMessage {
  const investigation: VscodeAiInvestigation | undefined =
    result && result.investigation.timeline.length > 0 ? result.investigation : undefined
  return createVscodeAiChatMessage('assistant', text || '（无输出）', {
    incomplete: result?.incomplete,
    investigation,
    isError: extras?.isError,
  })
}

/**
 * 从 API transcript 抽出可读的 user/assistant 轮次（跳过 tool / 合成上下文）。
 */
function buildMessagesFromTranscript(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  lastResult?: VscodeAiAgentResult,
): VscodeAiChatMessage[] {
  const out: VscodeAiChatMessage[] = []
  const textTurns: { role: 'user' | 'assistant'; text: string }[] = []

  for (const message of messages) {
    if (message.role === 'user') {
      const raw = contentToText('content' in message ? message.content : '')
      if (isSyntheticUserContextMessage(raw)) continue
      const text = stripSystemReminder(raw)
      if (!text) continue
      textTurns.push({ role: 'user', text })
      continue
    }
    if (message.role === 'assistant') {
      const text = contentToText('content' in message ? message.content : '').trim()
      if (!text) continue
      textTurns.push({ role: 'assistant', text })
    }
  }

  for (let i = 0; i < textTurns.length; i += 1) {
    const turn = textTurns[i]
    if (turn.role === 'user') {
      out.push(createVscodeAiChatMessage('user', turn.text))
      continue
    }
    const isLast = i === textTurns.length - 1
    out.push(
      buildAssistantMessage(turn.text, isLast ? lastResult : undefined),
    )
  }
  return out
}

function buildDetailMessages(run: SubagentRunState): VscodeAiChatMessage[] {
  const prior =
    run.result?.messages && run.result.messages.length > 0
      ? buildMessagesFromTranscript(
          run.result.messages,
          run.status === 'done' ? run.result : undefined,
        )
      : [createVscodeAiChatMessage('user', run.taskPrompt || run.description)]

  if (run.status === 'running') {
    // 首轮：只有任务气泡；追问轮：保留上一轮 transcript + 新追问气泡
    if (run.lastFollowUpPrompt) {
      const base =
        run.result?.messages && run.result.messages.length > 0
          ? buildMessagesFromTranscript(run.result.messages)
          : [createVscodeAiChatMessage('user', run.taskPrompt || run.description)]
      return [...base, createVscodeAiChatMessage('user', run.lastFollowUpPrompt)]
    }
    return [createVscodeAiChatMessage('user', run.taskPrompt || run.description)]
  }

  if (run.status === 'error') {
    if (run.result?.messages && run.result.messages.length > 0) {
      const base = buildMessagesFromTranscript(run.result.messages)
      if (run.lastFollowUpPrompt) {
        return [
          ...base,
          createVscodeAiChatMessage('user', run.lastFollowUpPrompt),
          buildAssistantMessage(run.error ?? '运行失败', undefined, { isError: true }),
        ]
      }
      return [
        ...base.slice(0, -1),
        buildAssistantMessage(run.error ?? '运行失败', undefined, { isError: true }),
      ]
    }
    return [
      createVscodeAiChatMessage('user', run.taskPrompt || run.description),
      buildAssistantMessage(run.error ?? '运行失败', undefined, { isError: true }),
    ]
  }

  // done
  if (run.result?.messages && run.result.messages.length > 0) {
    return prior
  }
  if (run.result) {
    return [
      createVscodeAiChatMessage('user', run.taskPrompt || run.description),
      buildAssistantMessage(run.result.text, run.result),
    ]
  }
  return [createVscodeAiChatMessage('user', run.taskPrompt || run.description)]
}

/**
 * 子 Agent 只读详情面板：复用 VscodeAiPanel，以 readOnly 模式渲染。
 * 运行中：用 store 的 liveProgress 驱动 liveTimeline/liveAnswer。
 * 完成后：用 result.messages 重建多轮 transcript。
 */
export function VscodeSubagentPanel({
  runId,
  getContext,
  aiModelSource = 'text',
  aiModelKey,
  dark,
  workspaceFolder,
}: VscodeSubagentPanelProps) {
  // 订阅 store：用版本号触发重渲染
  const [, setVersion] = useState(0)
  useEffect(() => subscribe(() => setVersion((v) => v + 1)), [])

  const run = getRun(runId)

  // 运行中：从 liveProgress 提取 timeline / answerText
  const externalLiveTimeline: VscodeAiTimelineItem[] | undefined = useMemo(() => {
    if (!run || run.status !== 'running') return undefined
    return run.liveProgress?.timeline
  }, [run?.liveProgress, run?.status])

  const externalLiveAnswer: string | undefined = useMemo(() => {
    if (!run || run.status !== 'running') return undefined
    return run.liveProgress?.answerText ?? ''
  }, [run?.liveProgress, run?.status])

  const externalContextUsage = run?.contextUsage
  const externalToolCallCount =
    run?.status === 'running'
      ? run.liveProgress?.toolCallCount
      : run?.result?.toolCallCount

  const messages: VscodeAiChatMessage[] = useMemo(() => {
    if (!run) return []
    return buildDetailMessages(run)
  }, [
    run?.status,
    run?.result,
    run?.error,
    run?.taskPrompt,
    run?.description,
    run?.lastFollowUpPrompt,
  ])

  if (!run) {
    return (
      <div class="vscode__group-empty">
        子 Agent 运行记录已清除
      </div>
    )
  }

  return (
    <div class="vscode__ai-chat-body">
      <VscodeAiPanel
        sessionId={`subagent-${runId}`}
        messages={messages}
        onMessagesChange={() => undefined}
        mode="agent"
        onModeChange={() => undefined}
        aiModelSource={aiModelSource}
        aiModelKey={run.modelKey ?? aiModelKey}
        onAiModelSelectionChange={() => undefined}
        aiModelOptions={{}}
        onAiModelOptionsChange={() => undefined}
        dark={dark}
        workspaceFolder={workspaceFolder}
        getContext={getContext ?? emptyContext}
        problems={[]}
        getNpmLastChangesSlot={() => ({ current: undefined })}
        getLastChangeSourceSlot={() => ({ current: undefined })}
        ensureAiTerminal={async () => ({ handle: undefined as never, sessionId: '', created: false, reason: 'new' as const })}
        getAiTerminalHandle={() => undefined}
        getAiTerminalSnapshot={() => ({ status: 'none' as const })}
        openPlanFile={async () => undefined}
        readOnly
        headerInfo={{
          agentId: run.agentId,
          modelLabel: run.modelLabel,
          status: statusLabel(run),
        }}
        externalLiveTimeline={externalLiveTimeline}
        externalLiveAnswer={externalLiveAnswer}
        externalContextUsage={externalContextUsage}
        externalToolCallCount={externalToolCallCount}
      />
    </div>
  )
}

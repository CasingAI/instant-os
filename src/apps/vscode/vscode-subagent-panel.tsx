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
import type { VscodeAiImageAttachment } from './vscode-ai-attachments.ts'
import {
  attachmentsFromMultimodalContent,
  parseVscodeAiImagePathsFromText,
} from './vscode-ai-attachments.ts'
import {
  getRun,
  subscribe,
  type SubagentRunState,
  type SubagentUserTurn,
} from './vscode-subagent-store.ts'
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
  onOpenCompressionDetail?: (sessionId: string, compressionId: string) => void
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

function attachmentsFromPaths(
  messageId: string,
  paths: readonly string[] | undefined,
): VscodeAiImageAttachment[] | undefined {
  if (!paths || paths.length === 0) return undefined
  return paths.map((path, index) => ({
    id: `${messageId}-img-${index}`,
    path,
    name: path.split('/').pop() || path,
    mimeType: 'image/png',
  }))
}

function resolveTurnImagePaths(
  run: SubagentRunState,
  turnIndex: number,
  turn: SubagentUserTurn | undefined,
  messageText: string,
): string[] | undefined {
  if (turn?.imagePaths && turn.imagePaths.length > 0) {
    return turn.imagePaths
  }
  const fromMessage = parseVscodeAiImagePathsFromText(messageText)
  if (fromMessage.length > 0) return fromMessage
  if (turn?.prompt) {
    const fromTurnPrompt = parseVscodeAiImagePathsFromText(turn.prompt)
    if (fromTurnPrompt.length > 0) return fromTurnPrompt
  }
  if (turnIndex === 0) {
    if (run.firstImagePaths && run.firstImagePaths.length > 0) {
      return run.firstImagePaths
    }
    const fromTask = parseVscodeAiImagePathsFromText(run.taskPrompt)
    if (fromTask.length > 0) return fromTask
  }
  return undefined
}

function withTurnAttachments(
  message: VscodeAiChatMessage,
  run: SubagentRunState,
  turnIndex: number,
  turn: SubagentUserTurn | undefined,
): VscodeAiChatMessage {
  if (message.attachments && message.attachments.length > 0) return message
  const paths = resolveTurnImagePaths(run, turnIndex, turn, message.content)
  const attachments = attachmentsFromPaths(message.id, paths)
  if (!attachments) return message
  return { ...message, attachments }
}

/** 按用户气泡顺序贴上各轮 image_paths */
function applyUserTurnAttachments(
  messages: VscodeAiChatMessage[],
  run: SubagentRunState,
): VscodeAiChatMessage[] {
  const turns = run.userTurns ?? []
  let userIndex = 0
  return messages.map((message) => {
    if (message.role !== 'user') return message
    const turn = turns[userIndex]
    const next = withTurnAttachments(message, run, userIndex, turn)
    userIndex += 1
    return next
  })
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
 * 同一轮内工具调用之间的中间 assistant 旁白合并为一条（只保留最后一段），
 * 与主对话「一轮一条气泡」一致，避免详情里连发多条相似总结。
 * 多模态 user 的 image_url 会挂到气泡 attachments（previewUrl），不依赖 VFS。
 */
function buildMessagesFromTranscript(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  lastResult?: VscodeAiAgentResult,
): VscodeAiChatMessage[] {
  const out: VscodeAiChatMessage[] = []
  const textTurns: {
    role: 'user' | 'assistant'
    text: string
    content?: unknown
  }[] = []

  for (const message of messages) {
    if (message.role === 'user') {
      const content = 'content' in message ? message.content : ''
      const raw = contentToText(content)
      if (isSyntheticUserContextMessage(raw)) continue
      const text = stripSystemReminder(raw)
      // 纯图轮次（极少）：仍占一个 user 槽，方便对齐 userTurns
      textTurns.push({ role: 'user', text: text || '（图片）', content })
      continue
    }
    if (message.role === 'assistant') {
      const text = contentToText('content' in message ? message.content : '').trim()
      if (!text) continue
      const prev = textTurns[textTurns.length - 1]
      if (prev?.role === 'assistant') {
        prev.text = text
      } else {
        textTurns.push({ role: 'assistant', text })
      }
    }
  }

  for (let i = 0; i < textTurns.length; i += 1) {
    const turn = textTurns[i]
    if (turn.role === 'user') {
      const message = createVscodeAiChatMessage(
        'user',
        turn.text === '（图片）' ? '' : turn.text,
      )
      const fromContent = attachmentsFromMultimodalContent(message.id, turn.content)
      const fromText = attachmentsFromPaths(
        message.id,
        parseVscodeAiImagePathsFromText(turn.text),
      )
      const attachments = fromContent ?? fromText
      out.push(attachments ? { ...message, attachments } : message)
      continue
    }
    const isLastAssistant = !textTurns.slice(i + 1).some((item) => item.role === 'assistant')
    const text =
      isLastAssistant && lastResult?.text?.trim() ? lastResult.text.trim() : turn.text
    out.push(buildAssistantMessage(text, isLastAssistant ? lastResult : undefined))
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
      : [
          createVscodeAiChatMessage('user', run.taskPrompt || run.description),
        ]

  if (run.status === 'running') {
    // 首轮：只有任务气泡；追问轮：保留上一轮 transcript + 新追问气泡
    if (run.lastFollowUpPrompt) {
      const base =
        run.result?.messages && run.result.messages.length > 0
          ? buildMessagesFromTranscript(run.result.messages)
          : [createVscodeAiChatMessage('user', run.taskPrompt || run.description)]
      const withHistory = applyUserTurnAttachments(base, run)
      const followUp = createVscodeAiChatMessage('user', run.lastFollowUpPrompt)
      const followTurn = run.userTurns[Math.max(0, run.userTurns.length - 1)]
      const followIndex = withHistory.filter((item) => item.role === 'user').length
      return [
        ...withHistory,
        withTurnAttachments(followUp, run, followIndex, followTurn),
      ]
    }
    return applyUserTurnAttachments(
      [createVscodeAiChatMessage('user', run.taskPrompt || run.description)],
      run,
    )
  }

  if (run.status === 'error') {
    if (run.result?.messages && run.result.messages.length > 0) {
      const base = buildMessagesFromTranscript(run.result.messages)
      if (run.lastFollowUpPrompt) {
        const followUp = createVscodeAiChatMessage('user', run.lastFollowUpPrompt)
        const followTurn = run.userTurns[Math.max(0, run.userTurns.length - 1)]
        const baseWithTurns = applyUserTurnAttachments(base, run)
        const followIndex = baseWithTurns.filter((item) => item.role === 'user').length
        return [
          ...baseWithTurns,
          withTurnAttachments(followUp, run, followIndex, followTurn),
          buildAssistantMessage(run.error ?? '运行失败', undefined, { isError: true }),
        ]
      }
      return [
        ...applyUserTurnAttachments(base.slice(0, -1), run),
        buildAssistantMessage(run.error ?? '运行失败', undefined, { isError: true }),
      ]
    }
    return [
      ...applyUserTurnAttachments(
        [createVscodeAiChatMessage('user', run.taskPrompt || run.description)],
        run,
      ),
      buildAssistantMessage(run.error ?? '运行失败', undefined, { isError: true }),
    ]
  }

  // done
  if (run.result?.messages && run.result.messages.length > 0) {
    return applyUserTurnAttachments(prior, run)
  }
  if (run.result) {
    return [
      ...applyUserTurnAttachments(
        [createVscodeAiChatMessage('user', run.taskPrompt || run.description)],
        run,
      ),
      buildAssistantMessage(run.result.text, run.result),
    ]
  }
  return applyUserTurnAttachments(
    [createVscodeAiChatMessage('user', run.taskPrompt || run.description)],
    run,
  )
}

/**
 * 子 Agent 只读详情面板：复用 VscodeAiPanel，以 readOnly 模式渲染。
 * 运行中：用 store 的 liveProgress 驱动 liveTimeline/liveAnswer。
 * 完成后：用 result.messages 重建多轮对话（每轮只保留一条最终 assistant）。
 */
export function VscodeSubagentPanel({
  runId,
  getContext,
  aiModelSource = 'text',
  aiModelKey,
  dark,
  workspaceFolder,
  onOpenCompressionDetail,
}: VscodeSubagentPanelProps) {
  // 订阅 store：用版本号触发重渲染
  const [, setVersion] = useState(0)
  useEffect(() => subscribe(() => setVersion((v) => v + 1)), [])

  const run = getRun(runId)

  // 运行中每秒刷新一次，驱动「已运行 X」实时显示
  const [, setElapsedTick] = useState(0)
  useEffect(() => {
    if (!run || run.status !== 'running') return
    const id = window.setInterval(() => setElapsedTick((v) => v + 1), 1000)
    return () => window.clearInterval(id)
  }, [run?.status])

  // 运行中的实时耗时（随 tick 刷新）；完成后为总耗时
  const externalElapsedMs =
    run && run.status === 'running' && run.startedAt > 0
      ? Math.max(0, Date.now() - run.startedAt)
      : undefined
  const externalDurationMs = useMemo(() => {
    if (!run || run.status === 'running') return undefined
    if (run.endedAt !== undefined) return Math.max(0, run.endedAt - run.startedAt)
    return run.result?.investigation?.durationMs
  }, [run?.status, run?.endedAt, run?.startedAt, run?.result])

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
    run?.userTurns,
    run?.firstImagePaths,
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
        externalElapsedMs={externalElapsedMs}
        externalDurationMs={externalDurationMs}
        onOpenCompressionDetail={onOpenCompressionDetail}
      />
    </div>
  )
}

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

/** 从完成结果构建一条 assistant 消息（含 investigation） */
function buildAssistantMessage(result: VscodeAiAgentResult): VscodeAiChatMessage {
  const investigation: VscodeAiInvestigation | undefined =
    result.investigation.timeline.length > 0 ? result.investigation : undefined
  return createVscodeAiChatMessage('assistant', result.text || '（无输出）', {
    incomplete: result.incomplete,
    investigation,
    pendingEdits: result.pendingEdits.length > 0 ? result.pendingEdits : undefined,
  })
}

/**
 * 子 Agent 只读详情面板：复用 VscodeAiPanel，以 readOnly 模式渲染。
 * 运行中：用 store 的 liveProgress 驱动 liveTimeline/liveAnswer。
 * 完成后：用 result 构造 assistant 消息展示完整调查过程与回答。
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

  // 消息列表：首条固定为主 Agent 下发的任务 Prompt（用户气泡），
  // 群聊式观感——主 Agent 发言，子 Agent 随后处理/回复。
  const messages: VscodeAiChatMessage[] = useMemo(() => {
    if (!run) return []
    const userMessage = createVscodeAiChatMessage('user', run.taskPrompt || run.description)
    if (run.status === 'done' && run.result) {
      return [userMessage, buildAssistantMessage(run.result)]
    }
    if (run.status === 'error') {
      return [
        userMessage,
        createVscodeAiChatMessage('assistant', run.error ?? '运行失败', {
          isError: true,
        }),
      ]
    }
    // 运行中：只有用户气泡，子 Agent 的输出走 live 气泡实时渲染
    return [userMessage]
  }, [run?.status, run?.result, run?.error, run?.taskPrompt, run?.description])

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
        getOpenFilesForSearch={() => []}
        problems={[]}
        getNpmLastChangesSlot={() => ({ current: undefined })}
        getLastChangeSourceSlot={() => ({ current: undefined })}
        ensureAiTerminal={async () => ({ handle: undefined as never, sessionId: '', created: false, reason: 'new' as const })}
        getAiTerminalHandle={() => undefined}
        getAiTerminalSnapshot={() => ({ status: 'none' as const })}
        openPlanFile={async () => undefined}
        onApplyEdit={async () => undefined}
        onRejectEdit={() => undefined}
        readOnly
        headerInfo={{
          agentId: run.agentId,
          modelLabel: run.modelLabel,
          status: statusLabel(run),
        }}
        externalLiveTimeline={externalLiveTimeline}
        externalLiveAnswer={externalLiveAnswer}
      />
    </div>
  )
}

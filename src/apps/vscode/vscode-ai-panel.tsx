import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type OpenAI from 'openai'
import { isStreamAbortError } from '../../ai/stream-abort.ts'
import { HelpMarkdown } from '../help/help-markdown.tsx'
import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'
import { HelpIcon } from '../../icons/app-icons.tsx'
import type { MonacoProblem } from '../../monaco/monaco-markers.ts'
import type {
  VscodeAgentTerminalEnsureResult,
} from './vscode-ai-run-command.ts'
import type { TerminalChangeSet } from '../../terminal/terminal-changeset.ts'
import type { TerminalReplHandle } from '../terminal/terminal-repl-panel.tsx'
import type { VscodeAgentTerminalSnapshot } from './vscode-terminal-sessions.ts'
import {
  isVscodeAiMode,
  VSCODE_AI_MODE_LABELS,
  type VscodeAiMode,
} from './vscode-ai-mode.ts'
import type { VscodeAiContextInput } from './vscode-ai-context.ts'
import {
  askVscodeAiAgent,
  buildVscodeAiInvestigationFromTimeline,
  type VscodeAiActivity,
  type VscodeAiInvestigation,
  type VscodeAiInvestigationStep,
  type VscodeAiTimelineItem,
} from './vscode-ai-agent.ts'
import type { VscodeAiToolsHost } from './vscode-ai-tools.ts'
import type { VscodeAiRunCommandHost } from './vscode-ai-run-command.ts'
import {
  createVscodeAiChatMessage,
  type VscodeAiChatMessage,
  type VscodeAiPendingEdit,
} from './vscode-ai-chat-storage.ts'
import type { VscodeWorkspaceSearchOpenFile } from './vscode-workspace-search.ts'
import {
  formatVscodeAiModelRefKey,
  labelForVscodeAiModel,
  resolveVscodeAiModelRefKey,
  useVscodeAiTextModels,
} from './vscode-ai-models.ts'
import { osNowMs } from '../../os/os-clock.ts'
import '../help/help.css'
import './vscode-ai.css'

const SAMPLE_PROMPTS = [
  '这个项目结构是怎样的？',
  '解释当前打开的文件',
  '帮我修一下 Problems 里的错误',
  '在工作区里搜索某个符号',
] as const

const VSCODE_AI_MODE_OPTIONS = (['ask', 'edit', 'agent'] as const).map((item) => ({
  id: item as string,
  label: VSCODE_AI_MODE_LABELS[item],
}))

const INVESTIGATION_STEP_STAGGER_MS = 55
const INVESTIGATION_STEP_ANIM_MS = 320
const INVESTIGATION_COLLAPSE_MS = 280

export type VscodeAiPanelProps = {
  sessionId: string
  messages: VscodeAiChatMessage[]
  onMessagesChange: (messages: VscodeAiChatMessage[]) => void
  mode: VscodeAiMode
  onModeChange: (mode: VscodeAiMode) => void
  aiModelKey: string | undefined
  onAiModelKeyChange: (key: string) => void
  dark?: boolean
  workspaceFolder: string | undefined
  getContext: () => VscodeAiContextInput
  getOpenFilesForSearch: () => VscodeWorkspaceSearchOpenFile[]
  problems: readonly MonacoProblem[]
  /** npm/npx 受控变更槽（与内嵌终端共用回滚状态） */
  npmLastChanges: { current: TerminalChangeSet | undefined }
  onChangesAvailable?: (available: boolean) => void
  ensureAgentTerminal: (chatSessionId: string, chatTitle: string) => Promise<VscodeAgentTerminalEnsureResult>
  getAgentTerminalHandle: (chatSessionId: string) => TerminalReplHandle | undefined
  getAgentTerminalSnapshot: (chatSessionId: string) => VscodeAgentTerminalSnapshot
  onApplyEdit: (edit: VscodeAiPendingEdit) => Promise<void>
  onRejectEdit: (editId: string) => void
}

function formatError(err: unknown): string {
  if (isStreamAbortError(err)) return '已停止生成'
  if (err instanceof Error) return err.message
  return String(err)
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return '不到 1 秒'
  }
  const seconds = durationMs / 1000
  if (seconds < 10) {
    return `${seconds.toFixed(1)} 秒`
  }
  return `${Math.round(seconds)} 秒`
}

function formatThinkingDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return '思考了不到 1 秒'
  }
  const seconds = durationMs / 1000
  if (seconds < 10) {
    return `思考了 ${seconds.toFixed(1)} 秒`
  }
  return `思考了 ${Math.round(seconds)} 秒`
}

function formatInvestigationSummary(investigation: VscodeAiInvestigation): string {
  const parts = ['已完成调查']
  if (investigation.reasoningDurationMs !== undefined) {
    parts.push(formatThinkingDuration(investigation.reasoningDurationMs))
  }
  parts.push(
    investigation.toolCallCount > 0
      ? `调用 ${investigation.toolCallCount} 个工具`
      : '未调用工具',
  )
  parts.push(`用时 ${formatDuration(investigation.durationMs)}`)
  return parts.join(' · ')
}

function ActivityRow({
  activity,
  live,
  isCurrent,
}: {
  activity: VscodeAiActivity
  live?: boolean
  isCurrent?: boolean
}) {
  const done = Boolean(activity.done) || !live
  const current = Boolean(live) && Boolean(isCurrent) && !activity.done
  return (
    <li
      class={`help-app__activity-item${done && !current ? ' help-app__activity-item--done' : ''}${current ? ' help-app__activity-item--current' : ''}`}
    >
      <span class="help-app__activity-mark" aria-hidden="true">
        {current ? '…' : done ? '✓' : '•'}
      </span>
      <span class="help-app__activity-body">
        <span class="help-app__activity-label">{activity.label}</span>
        {activity.detail ? (
          <span class="help-app__activity-detail">{activity.detail}</span>
        ) : undefined}
      </span>
    </li>
  )
}

function ReasoningStatus({
  text,
  streaming,
  durationMs,
}: {
  text: string
  streaming?: boolean
  durationMs?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const reasoningBody = text.trim()

  if (streaming) {
    return (
      <div class="help-app__reasoning-status help-app__reasoning-status--live" aria-live="polite">
        <span class="help-app__reasoning-status-label">模型正在思考</span>
      </div>
    )
  }

  if (durationMs === undefined) {
    return undefined
  }

  return (
    <div
      class={`help-app__reasoning-panel${expanded ? ' help-app__reasoning-panel--expanded' : ''}`}
    >
      <button
        type="button"
        class="help-app__reasoning-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span
          class={`help-app__investigation-chevron${expanded ? ' help-app__investigation-chevron--expanded' : ''}`}
          aria-hidden="true"
        />
        <span class="help-app__reasoning-summary">
          {formatThinkingDuration(durationMs)}
        </span>
      </button>
      {expanded ? (
        <pre class="help-app__reasoning-body">
          {reasoningBody || '（这次没有留下可展示的思考原文）'}
        </pre>
      ) : undefined}
    </div>
  )
}

function InvestigationSteps({
  timeline,
  exiting = false,
}: {
  timeline: VscodeAiInvestigationStep[]
  exiting?: boolean
}) {
  if (timeline.length === 0) {
    return undefined
  }

  return (
    <div class="help-app__investigation-steps">
      {timeline.map((item, index) => {
        const stepStyle = exiting
          ? undefined
          : {
              animationDelay: `${index * INVESTIGATION_STEP_STAGGER_MS}ms`,
              animationDuration: `${INVESTIGATION_STEP_ANIM_MS}ms`,
            }

        return (
          <div
            key={item.id}
            class={`help-app__investigation-step${exiting ? ' help-app__investigation-step--out' : ''}`}
            style={stepStyle}
          >
            {item.kind === 'activity' ? (
              <ol class="help-app__activity-list help-app__activity-list--inline">
                <ActivityRow activity={item} />
              </ol>
            ) : (
              <ReasoningStatus text={item.content} durationMs={item.durationMs} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function InvestigationPanel({
  investigation,
}: {
  investigation: VscodeAiInvestigation
}) {
  const [expanded, setExpanded] = useState(false)
  const [bodyMounted, setBodyMounted] = useState(false)
  const [clipOpen, setClipOpen] = useState(false)
  const [exiting, setExiting] = useState(false)
  const exitTimerRef = useRef<number | undefined>(undefined)
  const openFrameRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== undefined) {
        window.clearTimeout(exitTimerRef.current)
      }
      if (openFrameRef.current !== undefined) {
        window.cancelAnimationFrame(openFrameRef.current)
      }
    }
  }, [])

  if (investigation.timeline.length === 0) {
    return undefined
  }

  const handleToggle = () => {
    if (exitTimerRef.current !== undefined) {
      window.clearTimeout(exitTimerRef.current)
      exitTimerRef.current = undefined
    }
    if (openFrameRef.current !== undefined) {
      window.cancelAnimationFrame(openFrameRef.current)
      openFrameRef.current = undefined
    }

    if (!expanded) {
      setExiting(false)
      setBodyMounted(true)
      setExpanded(true)
      setClipOpen(false)
      openFrameRef.current = window.requestAnimationFrame(() => {
        openFrameRef.current = window.requestAnimationFrame(() => {
          openFrameRef.current = undefined
          setClipOpen(true)
        })
      })
      return
    }

    setExpanded(false)
    setExiting(true)
    setClipOpen(false)
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = undefined
      setExiting(false)
      setBodyMounted(false)
    }, INVESTIGATION_COLLAPSE_MS)
  }

  return (
    <div
      class={`help-app__investigation${expanded ? ' help-app__investigation--expanded' : ''}${exiting ? ' help-app__investigation--exiting' : ''}`}
    >
      <button
        type="button"
        class="help-app__investigation-toggle"
        aria-expanded={expanded}
        onClick={handleToggle}
      >
        <span
          class={`help-app__investigation-chevron${expanded ? ' help-app__investigation-chevron--expanded' : ''}`}
          aria-hidden="true"
        />
        <span class="help-app__investigation-summary">
          {formatInvestigationSummary(investigation)}
        </span>
      </button>
      {bodyMounted ? (
        <div
          class={`help-app__investigation-clip${clipOpen ? ' help-app__investigation-clip--open' : ''}`}
          style={{
            ['--help-investigation-collapse-ms' as string]: `${INVESTIGATION_COLLAPSE_MS}ms`,
          }}
        >
          <div class="help-app__investigation-clip-inner">
            <div class="help-app__investigation-body">
              <InvestigationSteps
                timeline={investigation.timeline}
                exiting={exiting}
              />
            </div>
          </div>
        </div>
      ) : undefined}
    </div>
  )
}

function LiveTimeline({ items }: { items: VscodeAiTimelineItem[] }) {
  if (items.length === 0) return undefined
  return (
    <div class="help-app__live-timeline">
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        if (item.kind === 'activity') {
          return (
            <ol key={item.id} class="help-app__activity-list help-app__activity-list--inline">
              <ActivityRow
                activity={{
                  id: item.id,
                  label: item.label,
                  detail: item.detail,
                  done: item.done,
                }}
                live
                isCurrent={isLast && !item.done}
              />
            </ol>
          )
        }
        if (item.kind === 'reasoning') {
          return (
            <ReasoningStatus
              key={item.id}
              text={item.content}
              streaming={!item.done}
              durationMs={item.durationMs}
            />
          )
        }
        return (
          <div key={item.id} class="help-app__live-answer help-app__live-answer--streaming">
            <HelpMarkdown text={item.content} streaming />
          </div>
        )
      })}
    </div>
  )
}

function PendingEditCard({
  edit,
  onApply,
  onReject,
}: {
  edit: VscodeAiPendingEdit
  onApply: () => void
  onReject: () => void
}) {
  if (edit.status !== 'pending') return undefined
  return (
    <div class="vscode-ai__edit-card">
      <div class="vscode-ai__edit-card-title">修改提案</div>
      <div class="vscode-ai__edit-card-path">{edit.path}</div>
      <div class="vscode-ai__edit-card-actions">
        <button type="button" class="help-app__sample" onClick={onApply}>
          应用
        </button>
        <button type="button" class="help-app__sample" onClick={onReject}>
          拒绝
        </button>
      </div>
    </div>
  )
}

export function VscodeAiPanel({
  sessionId,
  messages,
  onMessagesChange,
  mode,
  onModeChange,
  aiModelKey,
  onAiModelKeyChange,
  dark,
  workspaceFolder,
  getContext,
  getOpenFilesForSearch,
  problems,
  npmLastChanges,
  onChangesAvailable,
  ensureAgentTerminal,
  getAgentTerminalHandle,
  getAgentTerminalSnapshot,
  onApplyEdit,
  onRejectEdit,
}: VscodeAiPanelProps) {
  const textModels = useVscodeAiTextModels()
  const resolvedModelKey = useMemo(
    () => resolveVscodeAiModelRefKey(aiModelKey),
    [aiModelKey, textModels],
  )
  const modelOptions = useMemo(
    () =>
      textModels.map((model) => ({
        id: formatVscodeAiModelRefKey({
          providerEntryId: model.providerEntryId,
          modelId: model.modelId,
        }),
        label: labelForVscodeAiModel(model),
      })),
    [textModels],
  )

  useEffect(() => {
    if (!resolvedModelKey) return
    if (aiModelKey === resolvedModelKey) return
    onAiModelKeyChange(resolvedModelKey)
  }, [aiModelKey, onAiModelKeyChange, resolvedModelKey])

  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [liveTimeline, setLiveTimeline] = useState<VscodeAiTimelineItem[]>([])
  const [liveAnswer, setLiveAnswer] = useState('')
  const abortRef = useRef<AbortController | undefined>(undefined)
  const historyRef = useRef<OpenAI.Chat.ChatCompletionMessageParam[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingEditsRef = useRef<VscodeAiPendingEdit[]>([])
  const liveTimelineRef = useRef<VscodeAiTimelineItem[]>([])
  const liveAnswerRef = useRef('')
  const liveToolCallCountRef = useRef(0)
  const liveStartedAtRef = useRef(0)
  const sessionIdRef = useRef(sessionId)
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  useEffect(() => {
    if (sessionIdRef.current === sessionId) return
    sessionIdRef.current = sessionId
    setDraft('')
    setBusy(false)
    setLiveTimeline([])
    setLiveAnswer('')
    liveTimelineRef.current = []
    liveAnswerRef.current = ''
    liveToolCallCountRef.current = 0
    liveStartedAtRef.current = 0
    abortRef.current?.abort()
    abortRef.current = undefined
    historyRef.current = []
    pendingEditsRef.current = []
  }, [sessionId])

  const chatTitle = useMemo(() => {
    const firstUser = messages.find((m) => m.role === 'user')?.content?.trim()
    return firstUser?.slice(0, 40) || '对话'
  }, [messages])

  const runCommandHost = useMemo<VscodeAiRunCommandHost>(
    () => ({
      workspaceFolder,
      npmLastChanges,
      onChangesAvailable,
      ensureAgentTerminal: () =>
        ensureAgentTerminal(sessionIdRef.current, messagesRef.current.find((m) => m.role === 'user')?.content?.trim().slice(0, 40) || chatTitle),
      getAgentTerminalHandle: () => getAgentTerminalHandle(sessionIdRef.current),
      getAgentTerminalSnapshot: () => getAgentTerminalSnapshot(sessionIdRef.current),
    }),
    [
      chatTitle,
      ensureAgentTerminal,
      getAgentTerminalHandle,
      getAgentTerminalSnapshot,
      npmLastChanges,
      onChangesAvailable,
      workspaceFolder,
    ],
  )

  const contextWithTerminal = useCallback((): VscodeAiContextInput => {
    const base = getContext()
    return {
      ...base,
      agentTerminal: getAgentTerminalSnapshot(sessionId),
    }
  }, [getAgentTerminalSnapshot, getContext, sessionId])

  const toolsHost = useMemo<VscodeAiToolsHost>(
    () => ({
      getContext: contextWithTerminal,
      getProblems: () => problems,
      getOpenFilesForSearch,
      onProposeEdit: (edit) => {
        pendingEditsRef.current = [...pendingEditsRef.current, edit]
      },
      runCommandHost,
    }),
    [contextWithTerminal, getOpenFilesForSearch, problems, runCommandHost],
  )

  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, liveTimeline, liveAnswer, scrollToBottom])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = undefined
  }, [])

  const send = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? draft).trim()
      if (!text || busy) return
      if (!textOverride) setDraft('')
      setBusy(true)
      setLiveTimeline([])
      setLiveAnswer('')
      liveTimelineRef.current = []
      liveAnswerRef.current = ''
      liveToolCallCountRef.current = 0
      liveStartedAtRef.current = osNowMs()
      pendingEditsRef.current = []

      const userMessage = createVscodeAiChatMessage('user', text)
      const withUser = [...messages, userMessage]
      onMessagesChange(withUser)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const result = await askVscodeAiAgent({
          mode,
          userMessage: text,
          context: contextWithTerminal(),
          toolsHost,
          history: historyRef.current.length > 0 ? historyRef.current : undefined,
          signal: controller.signal,
          modelKey: aiModelKey,
          onProgress: (progress) => {
            liveTimelineRef.current = progress.timeline
            liveAnswerRef.current = progress.answerText
            liveToolCallCountRef.current = progress.toolCallCount
            setLiveTimeline(progress.timeline)
            setLiveAnswer(progress.answerText)
            pendingEditsRef.current = progress.pendingEdits
          },
        })

        if (result.messages) {
          historyRef.current = result.messages
        }

        const investigation =
          result.investigation.timeline.length > 0
            ? result.investigation
            : liveTimelineRef.current.length > 0
              ? buildVscodeAiInvestigationFromTimeline(liveTimelineRef.current, {
                  toolCallCount: liveToolCallCountRef.current,
                  startedAt: liveStartedAtRef.current,
                })
              : undefined

        const assistantMessage = createVscodeAiChatMessage(
          'assistant',
          result.text || liveAnswerRef.current,
          {
            pendingEdits: result.pendingEdits.length > 0 ? result.pendingEdits : undefined,
            incomplete: result.incomplete,
            investigation,
          },
        )
        onMessagesChange([...withUser, assistantMessage])
      } catch (error) {
        const snapshotTimeline = liveTimelineRef.current
        const investigation =
          snapshotTimeline.length > 0
            ? buildVscodeAiInvestigationFromTimeline(snapshotTimeline, {
                toolCallCount: liveToolCallCountRef.current,
                startedAt: liveStartedAtRef.current,
              })
            : undefined
        const aborted = isStreamAbortError(error, controller.signal)
        const content = aborted
          ? liveAnswerRef.current.trim() || formatError(error)
          : formatError(error)
        const assistantMessage = createVscodeAiChatMessage('assistant', content, {
          isError: !aborted,
          investigation,
        })
        onMessagesChange([...withUser, assistantMessage])
      } finally {
        setBusy(false)
        setLiveTimeline([])
        setLiveAnswer('')
        liveTimelineRef.current = []
        liveAnswerRef.current = ''
        liveToolCallCountRef.current = 0
        abortRef.current = undefined
      }
    },
    [
      aiModelKey,
      busy,
      contextWithTerminal,
      draft,
      messages,
      mode,
      onMessagesChange,
      toolsHost,
    ],
  )

  const applyEdit = useCallback(
    async (edit: VscodeAiPendingEdit) => {
      await onApplyEdit(edit)
      onMessagesChange(
        messages.map((message) => {
          if (!message.pendingEdits) return message
          return {
            ...message,
            pendingEdits: message.pendingEdits.map((item) =>
              item.id === edit.id ? { ...item, status: 'applied' as const } : item,
            ),
          }
        }),
      )
    },
    [messages, onApplyEdit, onMessagesChange],
  )

  const showWelcome = messages.length === 0 && !busy
  const showLive = busy && liveTimeline.length > 0

  return (
    <div class="help-app vscode-ai help-app--width-full">
      <div class="help-app__chat vscode-ai__chat" ref={scrollRef}>
        {showWelcome ? (
          <div class="help-app__welcome vscode-ai__welcome">
            <div class="help-app__welcome-icon" aria-hidden="true">
              <HelpIcon size={56} />
            </div>
            <h2 class="help-app__welcome-title">代码助手</h2>
            <p class="help-app__welcome-sub">
              可阅读工作区、改文件或运行命令。切换 Ask / Edit / Agent 控制权限。
            </p>
            <div class="help-app__samples" aria-label="示例提问">
              {SAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  class="help-app__sample"
                  onClick={() => void send(prompt)}
                  disabled={busy}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div class="help-app__messages">
            {messages.map((message) => (
              <div
                key={message.id}
                class={`help-app__message help-app__message--${message.role}${message.isError ? ' help-app__message--error' : ''}`}
              >
                <span class="help-app__avatar" aria-hidden="true">
                  {message.isError ? '!' : message.role === 'assistant' ? (
                    <HelpIcon size={30} />
                  ) : (
                    '🙂'
                  )}
                </span>
                <div
                  class={`help-app__bubble${message.isError ? ' help-app__bubble--error' : ''}${message.investigation ? ' help-app__bubble--with-investigation' : ''}`}
                >
                  {message.investigation ? (
                    <InvestigationPanel investigation={message.investigation} />
                  ) : undefined}
                  {message.role === 'assistant' && !message.isError ? (
                    <div class="help-app__answer">
                      <HelpMarkdown text={message.content} />
                    </div>
                  ) : (
                    <div class="help-app__answer help-app__answer--plain">{message.content}</div>
                  )}
                  {message.pendingEdits?.map((edit) => (
                    <PendingEditCard
                      key={edit.id}
                      edit={edit}
                      onApply={() => void applyEdit(edit)}
                      onReject={() => onRejectEdit(edit.id)}
                    />
                  ))}
                </div>
              </div>
            ))}

            {showLive ? (
              <div class="help-app__message help-app__message--assistant">
                <span class="help-app__avatar" aria-hidden="true">
                  <HelpIcon size={30} />
                </span>
                <div class="help-app__bubble help-app__bubble--with-investigation help-app__bubble--live">
                  <LiveTimeline items={liveTimeline} />
                  {liveAnswer && !liveTimeline.some((item) => item.kind === 'text') ? (
                    <div class="help-app__live-answer help-app__live-answer--streaming">
                      <HelpMarkdown text={liveAnswer} streaming />
                    </div>
                  ) : undefined}
                </div>
              </div>
            ) : undefined}
          </div>
        )}
      </div>

      <div class="help-app__composer-wrap vscode-ai__composer-wrap">
        <div class="help-app__composer vscode-ai__composer">
          <textarea
            class="help-app__input"
            rows={2}
            placeholder={
              mode === 'ask'
                ? '只读问答…'
                : mode === 'edit'
                  ? '描述要做的修改…'
                  : '描述任务…'
            }
            value={draft}
            disabled={busy}
            onInput={(event) => setDraft((event.target as HTMLTextAreaElement).value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <div class="vscode-ai__composer-footer">
            <label class="vscode-ai__footer-field vscode-ai__footer-field--mode">
              <span class="vscode-ai__footer-label">模式</span>
              <SettingsChoiceField
                label="AI 模式"
                value={mode}
                options={VSCODE_AI_MODE_OPTIONS}
                onChange={(value) => {
                  if (isVscodeAiMode(value)) onModeChange(value)
                }}
                disabled={busy}
                wideLayout
                dark={dark}
              >
                {({ open, setOpen, triggerRef, displayValue, disabled: triggerDisabled }) => (
                  <button
                    ref={triggerRef}
                    type="button"
                    class={`vscode-ai__footer-select vscode-ai__footer-select--trigger${open ? ' vscode-ai__footer-select--open' : ''}`}
                    disabled={triggerDisabled}
                    aria-haspopup="listbox"
                    aria-expanded={open}
                    aria-label="AI 模式"
                    onClick={() => setOpen(!open)}
                  >
                    {displayValue}
                  </button>
                )}
              </SettingsChoiceField>
            </label>
            <label class="vscode-ai__footer-field vscode-ai__footer-field--model">
              <span class="vscode-ai__footer-label">模型</span>
              <SettingsChoiceField
                label="模型"
                value={resolvedModelKey ?? ''}
                options={
                  modelOptions.length === 0
                    ? [{ id: '', label: '未配置文本模型' }]
                    : modelOptions
                }
                onChange={onAiModelKeyChange}
                disabled={busy || textModels.length === 0}
                wideLayout
                dark={dark}
              >
                {({ open, setOpen, triggerRef, displayValue, disabled: triggerDisabled }) => (
                  <button
                    ref={triggerRef}
                    type="button"
                    class={`vscode-ai__footer-select vscode-ai__footer-select--trigger${open ? ' vscode-ai__footer-select--open' : ''}`}
                    disabled={triggerDisabled}
                    aria-haspopup="listbox"
                    aria-expanded={open}
                    aria-label="模型"
                    onClick={() => setOpen(!open)}
                  >
                    {displayValue}
                  </button>
                )}
              </SettingsChoiceField>
            </label>
            {busy ? (
              <button
                type="button"
                class="help-app__stop"
                aria-label="停止"
                title="停止"
                onClick={stop}
              >
                ■
              </button>
            ) : (
              <button
                type="button"
                class="help-app__send"
                aria-label="发送"
                title="发送"
                disabled={!draft.trim() || textModels.length === 0}
                onClick={() => void send()}
              >
                ↑
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

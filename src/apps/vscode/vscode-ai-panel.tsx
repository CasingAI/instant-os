import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type OpenAI from 'openai'
import { isStreamAbortError } from '../../ai/stream-abort.ts'
import { buildLiveAnswerClassName, HelpMarkdown } from '../help/help-markdown.tsx'
import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { HelpIcon } from '../../icons/app-icons.tsx'
import type { MonacoProblem } from '../../monaco/monaco-markers.ts'
import type {
  VscodeAgentTerminalEnsureResult,
  VscodeAiLastChangeSource,
} from './vscode-ai-run-command.ts'
import type { TerminalChangeSet } from '../../terminal/terminal-changeset.ts'
import type { TerminalReplHandle } from '../terminal/terminal-repl-panel.tsx'
import type {
  VscodeAgentTerminalSnapshot,
  VscodeAiTerminalKind,
} from './vscode-terminal-sessions.ts'
import {
  isVscodeAiMode,
  VSCODE_AI_MODE_LABELS,
  type VscodeAiMode,
} from './vscode-ai-mode.ts'
import type { VscodeAiContextInput } from './vscode-ai-context.ts'
import {
  askVscodeAiAgent,
  buildVscodeAiInvestigationFromTimeline,
  formatVscodeAiWriteCardHeading,
  type VscodeAiActivity,
  type VscodeAiInvestigation,
  type VscodeAiInvestigationStep,
  type VscodeAiTimelineItem,
  type VscodeAiWriteItem,
} from './vscode-ai-agent.ts'
import type { VscodeAiToolsHost } from './vscode-ai-tools.ts'
import {
  collectPathsFromChangeSets,
  revertVscodeAiChangeSessions,
  type VscodeAiRunCommandHost,
} from './vscode-ai-run-command.ts'
import { VscodeAiUnifiedDiffView } from './vscode-ai-change-review.tsx'
import {
  createVscodeAiChatMessage,
  type VscodeAiChatMessage,
  type VscodeAiPendingEdit,
  type VscodeAiReviewStatus,
} from './vscode-ai-chat-storage.ts'
import {
  buildVscodeAiSystemReminder,
  collectVscodeAiReminderEvents,
  type VscodeAiLastSentTerminal,
} from './vscode-ai-system-reminder.ts'
import type { VscodeWorkspaceSearchOpenFile } from './vscode-workspace-search.ts'
import { VscodeAiModelPicker } from './vscode-ai-model-picker.tsx'
import {
  openAiConfigForVscodeAiModelKey,
  parseVscodeAiModelRefKey,
  resolveVscodeAiModelRefKey,
  tokenizerFamilyForVscodeAiModelKey,
  useVscodeAiTextModels,
} from './vscode-ai-models.ts'
import type { VscodeAiModelOptionPrefs } from './vscode-prefs.ts'
import {
  measureVscodeAiContextUsage,
  prepareVscodeAiContextUsage,
  type VscodeAiContextUsage,
} from './vscode-ai-context-usage.ts'
import { VscodeAiContextUsageView } from './vscode-ai-context-usage-view.tsx'
import { osNowMs } from '../../os/os-clock.ts'
import '../help/help.css'
import './vscode-ai.css'

const CONTEXT_USAGE_DEBOUNCE_MS = 280

const VSCODE_AI_MODAL_THEME = '#2f87e2'

const SAMPLE_PROMPTS = [
  '这个项目结构是怎样的？',
  '解释当前打开的文件',
  '帮我修一下 Problems 里的错误',
  '在工作区里搜索某个符号',
] as const

const VSCODE_AI_MODE_OPTIONS = (['ask', 'plan', 'edit', 'agent'] as const).map((item) => ({
  id: item as string,
  label: VSCODE_AI_MODE_LABELS[item],
}))

const INVESTIGATION_STEP_STAGGER_MS = 55
const INVESTIGATION_STEP_ANIM_MS = 320
const INVESTIGATION_COLLAPSE_MS = 280
const COMPOSER_INPUT_MAX_LINES = 5

export type VscodeAiPanelProps = {
  sessionId: string
  messages: VscodeAiChatMessage[]
  onMessagesChange: (messages: VscodeAiChatMessage[]) => void
  mode: VscodeAiMode
  onModeChange: (mode: VscodeAiMode) => void
  aiModelKey: string | undefined
  onAiModelKeyChange: (key: string) => void
  aiModelOptions: Record<string, VscodeAiModelOptionPrefs>
  onAiModelOptionsChange: (next: Record<string, VscodeAiModelOptionPrefs>) => void
  /** Debug：展示本轮注入的 system-reminder */
  aiDebugSystemReminder?: boolean
  dark?: boolean
  workspaceFolder: string | undefined
  /** 上一轮发送时的终端快照（持久化在 chat session） */
  lastSentTerminal?: VscodeAiLastSentTerminal
  onLastSentTerminalChange?: (value: VscodeAiLastSentTerminal | undefined) => void
  getContext: () => VscodeAiContextInput
  getOpenFilesForSearch: () => VscodeWorkspaceSearchOpenFile[]
  problems: readonly MonacoProblem[]
  /** 按对话取 npm/npx 受控变更槽 */
  getNpmLastChangesSlot: (chatSessionId: string) => {
    current: TerminalChangeSet | undefined
  }
  /** 按对话取最近一次有 fs 改动的来源 */
  getLastChangeSourceSlot: (chatSessionId: string) => {
    current: VscodeAiLastChangeSource | undefined
  }
  onChangesAvailable?: (available: boolean) => void
  ensureAiTerminal: (
    kind: VscodeAiTerminalKind,
    chatSessionId: string,
    chatTitle: string,
  ) => Promise<VscodeAgentTerminalEnsureResult>
  getAiTerminalHandle: (
    kind: VscodeAiTerminalKind,
    chatSessionId: string,
  ) => TerminalReplHandle | undefined
  getAiTerminalSnapshot: (
    kind: VscodeAiTerminalKind,
    chatSessionId: string,
  ) => VscodeAgentTerminalSnapshot
  openPlanFile: (path: string) => Promise<void>
  onApplyEdit: (edit: VscodeAiPendingEdit) => Promise<void>
  onRejectEdit: (editId: string) => void
  /** 本轮 Agent/Ask/Plan 是否在运行，供编辑器 Tab 显示加载指示 */
  onBusyChange?: (busy: boolean) => void
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
  if (
    investigation.reasoningDurationMs !== undefined &&
    investigation.reasoningDurationMs >= 5000
  ) {
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

function WaitingDots() {
  return (
    <span class="help-app__waiting-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  )
}

function latestReasoningSnippet(text: string, maxLen = 56): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) {
    return ''
  }
  if (cleaned.length <= maxLen) {
    return cleaned
  }
  return `…${cleaned.slice(-maxLen)}`
}

function WaitingStatus({ label = '等待响应' }: { label?: string }) {
  return (
    <div class="help-app__reasoning-status help-app__reasoning-status--waiting" aria-live="polite">
      <span class="help-app__reasoning-status-label">{label}</span>
    </div>
  )
}

function WriteFileCard({
  item,
  live,
}: {
  item: VscodeAiWriteItem
  live?: boolean
}) {
  const [expanded, setExpanded] = useState(!item.done)
  const previewRef = useRef<HTMLPreElement>(null)
  const streaming = Boolean(live) && !item.done
  const preview = item.preview.trim()
  const heading = formatVscodeAiWriteCardHeading(item.toolName, item.phase)

  useLayoutEffect(() => {
    if (!streaming || !expanded) return
    const el = previewRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [streaming, expanded, item.preview])

  useEffect(() => {
    if (item.done) setExpanded(false)
  }, [item.done])

  return (
    <div
      class={`vscode-ai__write-card${streaming ? ' vscode-ai__write-card--live' : ''}${item.done ? ' vscode-ai__write-card--done' : ''}`}
      aria-live={streaming ? 'polite' : undefined}
    >
      <button
        type="button"
        class="vscode-ai__write-card-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span
          class={`help-app__investigation-chevron${expanded ? ' help-app__investigation-chevron--expanded' : ''}`}
          aria-hidden="true"
        />
        <span class="vscode-ai__write-card-heading">
          {streaming ? <WaitingDots /> : undefined}
          <span class="vscode-ai__write-card-title">{heading}</span>
          {item.title ? (
            <span class="vscode-ai__write-card-path"> · {item.title}</span>
          ) : undefined}
        </span>
      </button>
      {expanded ? (
        <pre ref={previewRef} class="vscode-ai__write-card-preview">
          {preview || (streaming ? '…' : '（无预览）')}
        </pre>
      ) : undefined}
    </div>
  )
}

function ActivityStatus({
  activity,
  live,
  isCurrent,
}: {
  activity: VscodeAiActivity
  live?: boolean
  isCurrent?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const current = Boolean(live) && Boolean(isCurrent) && !activity.done
  const content = activity.content?.trim() ?? ''
  const result = activity.result?.trim() ?? ''
  const expandable = Boolean(content || result)
  const summary = (
    <>
      {activity.label}
      {activity.detail ? (
        <span class="help-app__reasoning-summary-detail"> · {activity.detail}</span>
      ) : undefined}
    </>
  )

  if (current) {
    return (
      <div
        class="help-app__reasoning-status help-app__reasoning-status--waiting"
        aria-live="polite"
      >
        <WaitingDots />
        <span class="help-app__reasoning-status-label">{summary}</span>
      </div>
    )
  }

  if (!expandable) {
    return (
      <div class="help-app__reasoning-status">
        <span class="help-app__reasoning-status-label">{summary}</span>
      </div>
    )
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
        <span class="help-app__reasoning-summary">{summary}</span>
      </button>
      {expanded ? (
        <div class="help-app__reasoning-body help-app__reasoning-body--stack">
          {content ? (
            <pre class="help-app__reasoning-body help-app__reasoning-body--code">{content}</pre>
          ) : undefined}
          {result ? (
            <>
              <div class="help-app__reasoning-result-label">输出</div>
              <pre class="help-app__reasoning-body help-app__reasoning-body--code">{result}</pre>
            </>
          ) : undefined}
        </div>
      ) : undefined}
    </div>
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
    if (!reasoningBody) {
      return <WaitingStatus />
    }
    const snippet = latestReasoningSnippet(text)
    return (
      <div class="help-app__reasoning-status help-app__reasoning-status--live" aria-live="polite">
        <WaitingDots />
        <span class="help-app__reasoning-status-label">模型正在思考</span>
        {snippet ? (
          <span class="help-app__reasoning-status-snippet">{snippet}</span>
        ) : undefined}
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
              <ActivityStatus activity={item} />
            ) : item.kind === 'write' ? (
              <WriteFileCard item={item} />
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
  if (items.length === 0) {
    return <ReasoningStatus text="" streaming />
  }
  const waitingForNext = items.every((item) => item.done)
  return (
    <div class="help-app__live-timeline">
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        if (item.kind === 'activity') {
          return (
            <ActivityStatus
              key={item.id}
              activity={{
                id: item.id,
                label: item.label,
                detail: item.detail,
                content: item.content,
                result: item.result,
                done: item.done,
              }}
              live
              isCurrent={isLast && !item.done}
            />
          )
        }
        if (item.kind === 'write') {
          return <WriteFileCard key={item.id} item={item} live />
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
        const separated = items.slice(0, index).some((entry) => entry.kind !== 'text')

        return (
          <div
            key={item.id}
            class={buildLiveAnswerClassName({ streaming: !item.done, separated })}
          >
            <HelpMarkdown text={item.content} streaming={!item.done} />
          </div>
        )
      })}
      {waitingForNext ? <WaitingStatus /> : undefined}
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
  if (edit.status === 'applied') {
    return (
      <div class="vscode-ai__edit-card">
        <div class="vscode-ai__edit-card-title">已应用修改</div>
        <div class="vscode-ai__edit-card-path">{edit.path}</div>
      </div>
    )
  }
  if (edit.status === 'rejected') {
    return (
      <div class="vscode-ai__edit-card">
        <div class="vscode-ai__edit-card-title">已拒绝修改</div>
        <div class="vscode-ai__edit-card-path">{edit.path}</div>
      </div>
    )
  }
  return (
    <div class="vscode-ai__edit-card">
      <div class="vscode-ai__edit-card-title">修改提案</div>
      <div class="vscode-ai__edit-card-path">{edit.path}</div>
      <VscodeAiUnifiedDiffView original={edit.previousText} modified={edit.nextText} />
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
  aiModelOptions,
  onAiModelOptionsChange,
  aiDebugSystemReminder = false,
  dark,
  workspaceFolder,
  lastSentTerminal,
  onLastSentTerminalChange,
  getContext,
  getOpenFilesForSearch,
  problems,
  getNpmLastChangesSlot,
  getLastChangeSourceSlot,
  onChangesAvailable,
  ensureAiTerminal,
  getAiTerminalHandle,
  getAiTerminalSnapshot,
  openPlanFile,
  onApplyEdit,
  onRejectEdit,
  onBusyChange,
}: VscodeAiPanelProps) {
  const modal = useWindowModal()
  const textModels = useVscodeAiTextModels()
  const resolvedModelKey = useMemo(
    () => resolveVscodeAiModelRefKey(aiModelKey),
    [aiModelKey, textModels],
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
  const [contextUsage, setContextUsage] = useState<VscodeAiContextUsage | undefined>(undefined)
  const abortRef = useRef<AbortController | undefined>(undefined)
  const historyRef = useRef<OpenAI.Chat.ChatCompletionMessageParam[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerWrapRef = useRef<HTMLDivElement>(null)
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const composerInputHeightRef = useRef<number | undefined>(undefined)
  const pendingEditsRef = useRef<VscodeAiPendingEdit[]>([])
  const liveTimelineRef = useRef<VscodeAiTimelineItem[]>([])
  const liveAnswerRef = useRef('')
  const liveToolCallCountRef = useRef(0)
  const liveStartedAtRef = useRef(0)
  const sessionIdRef = useRef(sessionId)
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const turnChangeSessionsRef = useRef<TerminalChangeSet[]>([])
  const lastSentModeRef = useRef<VscodeAiMode | undefined>(undefined)
  const lastSentTerminalRef = useRef<VscodeAiLastSentTerminal | undefined>(lastSentTerminal)
  lastSentTerminalRef.current = lastSentTerminal
  const busyRef = useRef(false)
  busyRef.current = busy
  const onBusyChangeRef = useRef(onBusyChange)
  onBusyChangeRef.current = onBusyChange

  useEffect(() => {
    onBusyChangeRef.current?.(busy)
  }, [busy])

  useEffect(() => {
    return () => onBusyChangeRef.current?.(false)
  }, [])
  const [editingUserId, setEditingUserId] = useState<string | undefined>(undefined)
  const [editingDraft, setEditingDraft] = useState('')
  const [reviewBusy, setReviewBusy] = useState(false)
  const [composerInset, setComposerInset] = useState(96)

  const resolvedModelId = useMemo(
    () => openAiConfigForVscodeAiModelKey(resolvedModelKey).defaultModel,
    [resolvedModelKey],
  )
  const resolvedProviderEntryId = useMemo(
    () => parseVscodeAiModelRefKey(resolvedModelKey)?.providerEntryId,
    [resolvedModelKey],
  )
  const resolvedTokenizerFamily = useMemo(
    () => tokenizerFamilyForVscodeAiModelKey(resolvedModelKey),
    [resolvedModelKey],
  )

  useLayoutEffect(() => {
    const el = composerInputRef.current
    if (!el) return

    const styles = getComputedStyle(el)
    const lineHeight = Number.parseFloat(styles.lineHeight) || 18
    const paddingY =
      (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0)
    const minHeight = lineHeight + paddingY
    const maxHeight = lineHeight * COMPOSER_INPUT_MAX_LINES + paddingY
    const previousHeight = composerInputHeightRef.current ?? Math.max(el.offsetHeight, minHeight)

    el.style.transition = 'none'
    el.style.minHeight = '0'
    el.style.height = '0px'
    const contentHeight = el.scrollHeight
    const nextHeight = Math.min(Math.max(contentHeight, minHeight), maxHeight)
    el.style.minHeight = ''
    el.style.height = `${previousHeight}px`
    void el.offsetHeight
    el.style.transition = ''
    el.style.height = `${nextHeight}px`
    el.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden'
    composerInputHeightRef.current = nextHeight
  }, [draft])

  useLayoutEffect(() => {
    const el = composerWrapRef.current
    if (!el) return
    const updateInset = () => setComposerInset(el.offsetHeight)
    updateInset()
    const observer = new ResizeObserver(updateInset)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (sessionIdRef.current === sessionId) return
    // 先中止旧轮次，让 in-flight catch 仍能读到 live*Ref 快照
    abortRef.current?.abort()
    abortRef.current = undefined
    sessionIdRef.current = sessionId
    setDraft('')
    setBusy(false)
    setLiveTimeline([])
    setLiveAnswer('')
    setContextUsage(undefined)
    // refs 由旧 send 的 finally / catch 自行收尾；此处只重置 UI
    historyRef.current = []
    pendingEditsRef.current = []
    turnChangeSessionsRef.current = []
    lastSentModeRef.current = undefined
    setEditingUserId(undefined)
    setEditingDraft('')
  }, [sessionId])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = undefined
    }
  }, [])

  const chatTitle = useMemo(() => {
    const firstUser = messages.find((m) => m.role === 'user')?.content?.trim()
    return firstUser?.slice(0, 40) || '对话'
  }, [messages])

  const aiTerminalKind: VscodeAiTerminalKind | undefined =
    mode === 'ask' ? 'ask' : mode === 'plan' ? 'plan' : mode === 'agent' ? 'agent' : undefined

  const runCommandHost = useMemo<VscodeAiRunCommandHost>(
    () => ({
      workspaceFolder,
      npmLastChanges: getNpmLastChangesSlot(sessionId),
      lastChangeSource: getLastChangeSourceSlot(sessionId),
      turnChangeSessions: turnChangeSessionsRef,
      onChangesAvailable,
      ensureAgentTerminal: () => {
        if (!aiTerminalKind) {
          return Promise.reject(new Error('当前模式不支持终端'))
        }
        return ensureAiTerminal(
          aiTerminalKind,
          sessionIdRef.current,
          messagesRef.current.find((m) => m.role === 'user')?.content?.trim().slice(0, 40) ||
            chatTitle,
        )
      },
      getAgentTerminalHandle: () =>
        aiTerminalKind
          ? getAiTerminalHandle(aiTerminalKind, sessionIdRef.current)
          : undefined,
      getAgentTerminalSnapshot: () =>
        aiTerminalKind
          ? getAiTerminalSnapshot(aiTerminalKind, sessionIdRef.current)
          : { status: 'none' },
    }),
    [
      aiTerminalKind,
      chatTitle,
      ensureAiTerminal,
      getAiTerminalHandle,
      getAiTerminalSnapshot,
      getLastChangeSourceSlot,
      getNpmLastChangesSlot,
      onChangesAvailable,
      sessionId,
      workspaceFolder,
    ],
  )

  const pendingReview = useMemo(() => {
    const paths = new Set<string>()
    const sessionIds: string[] = []
    for (const message of messages) {
      if (message.role !== 'assistant') continue
      const status: VscodeAiReviewStatus | undefined =
        message.reviewStatus ??
        (message.changeSessionIds?.length || message.terminalChangeReview?.status === 'pending'
          ? message.terminalChangeReview?.status ?? 'pending'
          : undefined)
      if (status !== 'pending') continue
      const ids =
        message.changeSessionIds ??
        (message.terminalChangeReview ? [message.terminalChangeReview.sessionId] : [])
      for (const id of ids) {
        if (!sessionIds.includes(id)) sessionIds.push(id)
      }
      const messagePaths =
        message.changePaths ??
        message.terminalChangeReview?.files.map((file) => file.path) ??
        []
      for (const path of messagePaths) paths.add(path)
    }
    return { fileCount: paths.size, sessionIds }
  }, [messages])

  const contextWithTerminal = useCallback((): VscodeAiContextInput => {
    const base = getContext()
    if (!aiTerminalKind) return base
    return {
      ...base,
      aiTerminal: getAiTerminalSnapshot(aiTerminalKind, sessionId),
      aiTerminalKind,
    }
  }, [aiTerminalKind, getAiTerminalSnapshot, getContext, sessionId])

  const toolsHost = useMemo<VscodeAiToolsHost>(
    () => ({
      getContext: contextWithTerminal,
      getProblems: () => problems,
      getOpenFilesForSearch,
      onProposeEdit: (edit) => {
        pendingEditsRef.current = [...pendingEditsRef.current, edit]
      },
      runCommandHost,
      openPlanFile,
    }),
    [contextWithTerminal, getOpenFilesForSearch, openPlanFile, problems, runCommandHost],
  )

  useEffect(() => {
    void prepareVscodeAiContextUsage(resolvedModelId, resolvedTokenizerFamily)
  }, [resolvedModelId, resolvedTokenizerFamily])

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
    if (aiTerminalKind) {
      getAiTerminalHandle(aiTerminalKind, sessionIdRef.current)?.abort()
    }
  }, [aiTerminalKind, getAiTerminalHandle])

  const rebuildHistoryFromMessages = useCallback((source: readonly VscodeAiChatMessage[]) => {
    const next: OpenAI.Chat.ChatCompletionMessageParam[] = []
    for (const message of source) {
      if (message.role === 'user') {
        next.push({ role: 'user', content: message.content })
        continue
      }
      if (message.role === 'assistant' && !message.isError) {
        next.push({ role: 'assistant', content: message.content })
      }
    }
    return next
  }, [])

  useEffect(() => {
    if (busy) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        await prepareVscodeAiContextUsage(
          resolvedModelId,
          resolvedTokenizerFamily,
        )
        if (cancelled || busyRef.current) return
        const history =
          historyRef.current.length > 0
            ? historyRef.current
            : rebuildHistoryFromMessages(messages)
        const currentTerminal = aiTerminalKind
          ? getAiTerminalSnapshot(aiTerminalKind, sessionId)
          : undefined
        const reminderText = buildVscodeAiSystemReminder(
          collectVscodeAiReminderEvents({
            mode,
            previousMode: lastSentModeRef.current,
            aiTerminalKind,
            currentTerminal,
            lastSentTerminal: lastSentTerminalRef.current,
          }),
        )
        const usage = measureVscodeAiContextUsage({
          mode,
          context: contextWithTerminal(),
          history,
          userMessage: draft,
          reminderText,
          model: resolvedModelId,
          providerEntryId: resolvedProviderEntryId,
          tokenizerFamily: resolvedTokenizerFamily,
          toolsHost,
        })
        if (cancelled || busyRef.current) return
        setContextUsage(usage)
      })()
    }, CONTEXT_USAGE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    aiTerminalKind,
    busy,
    contextWithTerminal,
    draft,
    getAiTerminalSnapshot,
    messages,
    mode,
    problems,
    rebuildHistoryFromMessages,
    resolvedModelId,
    resolvedProviderEntryId,
    resolvedTokenizerFamily,
    sessionId,
    toolsHost,
    workspaceFolder,
  ])

  const collectSessionIdsAfter = useCallback(
    (source: readonly VscodeAiChatMessage[], fromIndex: number): string[] => {
      const ids: string[] = []
      for (let index = fromIndex; index < source.length; index += 1) {
        const message = source[index]
        if (message.role !== 'assistant') continue
        const sessionIds =
          message.changeSessionIds ??
          (message.terminalChangeReview ? [message.terminalChangeReview.sessionId] : [])
        for (const id of sessionIds) {
          if (!ids.includes(id)) ids.push(id)
        }
      }
      return ids
    },
    [],
  )

  const turnChangeExtras = useCallback(() => {
    const sessions = turnChangeSessionsRef.current
    if (sessions.length === 0) return undefined
    return {
      changeSessionIds: sessions.map((session) => session.sessionId),
      changePaths: collectPathsFromChangeSets(sessions),
      reviewStatus: 'pending' as const,
    }
  }, [])

  const send = useCallback(
    async (textOverride?: string, options?: { replaceFromUserId?: string }) => {
      const text = (textOverride ?? draft).trim()
      if (!text || busy) return

      let withUser: VscodeAiChatMessage[]
      const currentTerminal = aiTerminalKind
        ? getAiTerminalSnapshot(aiTerminalKind, sessionId)
        : undefined
      const reminderText = buildVscodeAiSystemReminder(
        collectVscodeAiReminderEvents({
          mode,
          previousMode: lastSentModeRef.current,
          aiTerminalKind,
          currentTerminal,
          lastSentTerminal: lastSentTerminalRef.current,
        }),
      )
      const reminderForStorage = reminderText.trim() || undefined
      if (options?.replaceFromUserId) {
        const index = messages.findIndex((message) => message.id === options.replaceFromUserId)
        if (index < 0 || messages[index]?.role !== 'user') return
        const sessionIds = collectSessionIdsAfter(messages, index + 1)
        if (sessionIds.length > 0) {
          setReviewBusy(true)
          try {
            await revertVscodeAiChangeSessions(runCommandHost, sessionIds)
          } finally {
            setReviewBusy(false)
          }
        }
        const editedUser: VscodeAiChatMessage = {
          ...messages[index],
          content: text,
          createdAt: Date.now(),
          systemReminder: reminderForStorage,
        }
        withUser = [...messages.slice(0, index), editedUser]
        historyRef.current = rebuildHistoryFromMessages(messages.slice(0, index))
        onMessagesChange(withUser)
        setEditingUserId(undefined)
        setEditingDraft('')
      } else {
        if (!textOverride) setDraft('')
        const userMessage = createVscodeAiChatMessage('user', text, {
          systemReminder: reminderForStorage,
        })
        withUser = [...messages, userMessage]
        onMessagesChange(withUser)
      }

      setBusy(true)
      setLiveTimeline([])
      setLiveAnswer('')
      liveTimelineRef.current = []
      liveAnswerRef.current = ''
      liveToolCallCountRef.current = 0
      liveStartedAtRef.current = osNowMs()
      pendingEditsRef.current = []
      turnChangeSessionsRef.current = []

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const result = await askVscodeAiAgent({
          mode,
          userMessage: text,
          reminderText,
          context: contextWithTerminal(),
          toolsHost,
          history: historyRef.current.length > 0 ? historyRef.current : undefined,
          signal: controller.signal,
          modelKey: aiModelKey,
          onProgress: (progress) => {
            if (controller.signal.aborted) return
            liveTimelineRef.current = progress.timeline
            liveAnswerRef.current = progress.answerText
            liveToolCallCountRef.current = progress.toolCallCount
            setLiveTimeline(progress.timeline)
            setLiveAnswer(progress.answerText)
            pendingEditsRef.current = progress.pendingEdits
            if (progress.contextUsage) {
              setContextUsage(progress.contextUsage)
            }
          },
        })
        lastSentModeRef.current = mode
        if (aiTerminalKind) {
          const nextLastSent: VscodeAiLastSentTerminal = {
            kind: aiTerminalKind,
            snapshot: getAiTerminalSnapshot(aiTerminalKind, sessionId),
          }
          lastSentTerminalRef.current = nextLastSent
          onLastSentTerminalChange?.(nextLastSent)
        }

        if (controller.signal.aborted) {
          const snapshotTimeline = liveTimelineRef.current
          const investigation =
            snapshotTimeline.length > 0
              ? buildVscodeAiInvestigationFromTimeline(snapshotTimeline, {
                  toolCallCount: liveToolCallCountRef.current,
                  startedAt: liveStartedAtRef.current,
                })
              : undefined
          const changeExtras = turnChangeExtras()
          const assistantMessage = createVscodeAiChatMessage(
            'assistant',
            liveAnswerRef.current.trim() || '已停止生成',
            {
              investigation,
              ...changeExtras,
            },
          )
          onMessagesChange([...withUser, assistantMessage])
        } else {
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

          const changeExtras = turnChangeExtras()
          const assistantMessage = createVscodeAiChatMessage(
            'assistant',
            result.text || liveAnswerRef.current,
            {
              pendingEdits: result.pendingEdits.length > 0 ? result.pendingEdits : undefined,
              incomplete: result.incomplete,
              investigation,
              ...changeExtras,
            },
          )
          onMessagesChange([...withUser, assistantMessage])
        }
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
        const changeExtras = turnChangeExtras()
        const assistantMessage = createVscodeAiChatMessage('assistant', content, {
          isError: !aborted,
          investigation,
          ...changeExtras,
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
      aiTerminalKind,
      busy,
      collectSessionIdsAfter,
      contextWithTerminal,
      draft,
      getAiTerminalSnapshot,
      messages,
      mode,
      onLastSentTerminalChange,
      onMessagesChange,
      rebuildHistoryFromMessages,
      runCommandHost,
      sessionId,
      toolsHost,
      turnChangeExtras,
    ],
  )

  const keepAllPendingChanges = useCallback(() => {
    onMessagesChange(
      messages.map((message) => {
        if (message.role !== 'assistant') return message
        const status =
          message.reviewStatus ??
          (message.changeSessionIds?.length || message.terminalChangeReview?.status === 'pending'
            ? message.terminalChangeReview?.status ?? 'pending'
            : undefined)
        if (status !== 'pending') return message
        return {
          ...message,
          reviewStatus: 'kept' as const,
          terminalChangeReview: message.terminalChangeReview
            ? { ...message.terminalChangeReview, status: 'kept' as const }
            : message.terminalChangeReview,
        }
      }),
    )
  }, [messages, onMessagesChange])

  const undoAllPendingChanges = useCallback(async () => {
    if (reviewBusy || pendingReview.sessionIds.length === 0) return
    setReviewBusy(true)
    try {
      await revertVscodeAiChangeSessions(runCommandHost, pendingReview.sessionIds)
      onMessagesChange(
        messages.map((message) => {
          if (message.role !== 'assistant') return message
          const status =
            message.reviewStatus ??
            (message.changeSessionIds?.length || message.terminalChangeReview?.status === 'pending'
              ? message.terminalChangeReview?.status ?? 'pending'
              : undefined)
          if (status !== 'pending') return message
          return {
            ...message,
            reviewStatus: 'reverted' as const,
            terminalChangeReview: message.terminalChangeReview
              ? { ...message.terminalChangeReview, status: 'reverted' as const }
              : message.terminalChangeReview,
          }
        }),
      )
    } finally {
      setReviewBusy(false)
    }
  }, [messages, onMessagesChange, pendingReview.sessionIds, reviewBusy, runCommandHost])

  const beginEditUserMessage = useCallback((message: VscodeAiChatMessage) => {
    if (message.role !== 'user') return
    setEditingUserId(message.id)
    setEditingDraft(message.content)
  }, [])

  const cancelEditUserMessage = useCallback(() => {
    setEditingUserId(undefined)
    setEditingDraft('')
  }, [])

  const resubmitEditedUserMessage = useCallback(
    async (messageId: string) => {
      const text = editingDraft.trim()
      if (!text || busy || reviewBusy) return
      const index = messages.findIndex((message) => message.id === messageId)
      if (index < 0) return
      const hasLater = index < messages.length - 1
      const hasLaterChanges = collectSessionIdsAfter(messages, index + 1).length > 0
      if (hasLater || hasLaterChanges) {
        const ok = await modal.confirm({
          title: '从此消息重新发送？',
          message:
            '将丢弃此消息之后的对话，并回滚之后 Agent 产生的文件改动，然后按新文案重新发送。',
          confirmLabel: '重新发送',
          cancelLabel: '取消',
          themeColor: VSCODE_AI_MODAL_THEME,
        })
        if (!ok) return
      }
      await send(text, { replaceFromUserId: messageId })
    },
    [busy, collectSessionIdsAfter, editingDraft, messages, modal, reviewBusy, send],
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

  const rejectEdit = useCallback(
    (editId: string) => {
      onRejectEdit(editId)
      onMessagesChange(
        messages.map((message) => {
          if (!message.pendingEdits) return message
          return {
            ...message,
            pendingEdits: message.pendingEdits.map((item) =>
              item.id === editId ? { ...item, status: 'rejected' as const } : item,
            ),
          }
        }),
      )
    },
    [messages, onMessagesChange, onRejectEdit],
  )

  const showWelcome = messages.length === 0 && !busy
  const showLive = busy

  return (
    <div
      class="help-app vscode-ai help-app--width-full"
      style={{ '--vscode-ai-composer-inset': `${composerInset}px` }}
    >
      <div class="help-app__chat vscode-ai__chat" ref={scrollRef}>
        {showWelcome ? (
          <div class="help-app__welcome vscode-ai__welcome">
            <div class="help-app__welcome-icon" aria-hidden="true">
              <HelpIcon size={56} />
            </div>
            <h2 class="help-app__welcome-title">代码助手</h2>
            <p class="help-app__welcome-sub">
              可阅读工作区、写计划、改文件或运行命令。切换 Ask / Plan / Edit / Agent 控制权限。
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
                  class={`help-app__bubble${message.isError ? ' help-app__bubble--error' : ''}${message.investigation ? ' help-app__bubble--with-investigation' : ''}${message.role === 'user' ? ' vscode-ai__bubble--user' : ''}`}
                >
                  {message.investigation ? (
                    <InvestigationPanel investigation={message.investigation} />
                  ) : undefined}
                  {message.role === 'user' &&
                  aiDebugSystemReminder &&
                  message.systemReminder?.trim() ? (
                    <details class="vscode-ai__system-reminder" open>
                      <summary>System Reminder（debug）</summary>
                      <pre class="vscode-ai__system-reminder-body">{message.systemReminder}</pre>
                    </details>
                  ) : undefined}
                  {message.role === 'user' && editingUserId === message.id ? (
                    <div class="vscode-ai__user-edit">
                      <textarea
                        class="help-app__input vscode-ai__user-edit-input"
                        rows={3}
                        value={editingDraft}
                        disabled={busy || reviewBusy}
                        onInput={(event) =>
                          setEditingDraft((event.target as HTMLTextAreaElement).value)
                        }
                      />
                      <div class="vscode-ai__user-edit-actions">
                        <button
                          type="button"
                          class="help-app__sample"
                          disabled={busy || reviewBusy || !editingDraft.trim()}
                          onClick={() => void resubmitEditedUserMessage(message.id)}
                        >
                          发送
                        </button>
                        <button
                          type="button"
                          class="help-app__sample"
                          disabled={busy || reviewBusy}
                          onClick={cancelEditUserMessage}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : message.role === 'assistant' && !message.isError ? (
                    <div class="help-app__answer">
                      <HelpMarkdown text={message.content} />
                    </div>
                  ) : (
                    <div class="help-app__answer help-app__answer--plain">{message.content}</div>
                  )}
                  {message.role === 'user' && editingUserId !== message.id ? (
                    <button
                      type="button"
                      class="vscode-ai__edit-msg"
                      disabled={busy || reviewBusy}
                      title="编辑并从此处分叉重发"
                      onClick={() => beginEditUserMessage(message)}
                    >
                      编辑
                    </button>
                  ) : undefined}
                  {message.pendingEdits?.map((edit) => (
                    <PendingEditCard
                      key={edit.id}
                      edit={edit}
                      onApply={() => void applyEdit(edit)}
                      onReject={() => rejectEdit(edit.id)}
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
                    <div
                      class={buildLiveAnswerClassName({
                        streaming: true,
                        separated: liveTimeline.length > 0,
                      })}
                    >
                      <HelpMarkdown text={liveAnswer} streaming />
                    </div>
                  ) : undefined}
                </div>
              </div>
            ) : undefined}
          </div>
        )}
      </div>

      <div class="help-app__composer-wrap vscode-ai__composer-wrap" ref={composerWrapRef}>
        {pendingReview.fileCount > 0 ? (
          <div class="vscode-ai__review-bar" role="status">
            <span class="vscode-ai__review-bar-label">
              已修改 {pendingReview.fileCount} 个文件
            </span>
            <div class="vscode-ai__review-bar-actions">
              <button
                type="button"
                class="help-app__sample"
                disabled={busy || reviewBusy}
                onClick={keepAllPendingChanges}
              >
                Keep All
              </button>
              <button
                type="button"
                class="help-app__sample"
                disabled={busy || reviewBusy}
                onClick={() => void undoAllPendingChanges()}
              >
                Undo All
              </button>
            </div>
          </div>
        ) : undefined}
        <div class="help-app__composer vscode-ai__composer">
          <textarea
            ref={composerInputRef}
            class="help-app__input"
            rows={1}
            placeholder={
              mode === 'ask'
                ? '只读问答…'
                : mode === 'plan'
                  ? '调研并写计划…'
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
              <VscodeAiModelPicker
                label="模型"
                value={resolvedModelKey ?? ''}
                models={textModels}
                onChange={onAiModelKeyChange}
                aiModelOptions={aiModelOptions}
                onAiModelOptionsChange={onAiModelOptionsChange}
                disabled={busy || textModels.length === 0}
                dark={dark}
                ariaLabel="模型"
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
              </VscodeAiModelPicker>
            </label>
            <div class="vscode-ai__composer-footer-trailing">
              <VscodeAiContextUsageView usage={contextUsage} />
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
    </div>
  )
}

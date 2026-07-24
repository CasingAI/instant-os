import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type OpenAI from 'openai'
import { isStreamAbortError } from '../../ai/stream-abort.ts'
import { HelpMarkdown } from '../help/help-markdown.tsx'
import { HelpIcon } from '../../icons/app-icons.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import type { TerminalReplHandle } from '../terminal/terminal-repl-panel.tsx'
import type { MonacoProblem } from '../../monaco/monaco-markers.ts'
import {
  isVscodeAiMode,
  VSCODE_AI_MODE_LABELS,
  type VscodeAiMode,
} from './vscode-ai-mode.ts'
import type { VscodeAiContextInput } from './vscode-ai-context.ts'
import {
  askVscodeAiAgent,
  type VscodeAiActivity,
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
import '../help/help.css'
import './vscode-ai.css'

const SAMPLE_PROMPTS = [
  '这个项目结构是怎样的？',
  '解释当前打开的文件',
  '帮我修一下 Problems 里的错误',
  '在工作区里搜索某个符号',
] as const

export type VscodeAiPanelProps = {
  sessionId: string
  messages: VscodeAiChatMessage[]
  onMessagesChange: (messages: VscodeAiChatMessage[]) => void
  mode: VscodeAiMode
  onModeChange: (mode: VscodeAiMode) => void
  aiModelKey: string | undefined
  onAiModelKeyChange: (key: string) => void
  workspaceFolder: string | undefined
  getContext: () => VscodeAiContextInput
  getOpenFilesForSearch: () => VscodeWorkspaceSearchOpenFile[]
  problems: readonly MonacoProblem[]
  terminalRepl: TerminalReplHandle
  onApplyEdit: (edit: VscodeAiPendingEdit) => Promise<void>
  onRejectEdit: (editId: string) => void
}

function formatError(err: unknown): string {
  if (isStreamAbortError(err)) return '已停止生成'
  if (err instanceof Error) return err.message
  return String(err)
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
            <div key={item.id} class="help-app__reasoning-status help-app__reasoning-status--live">
              <span class="help-app__reasoning-status-label">模型正在思考</span>
            </div>
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
  workspaceFolder,
  getContext,
  getOpenFilesForSearch,
  problems,
  terminalRepl,
  onApplyEdit,
  onRejectEdit,
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
  const abortRef = useRef<AbortController | undefined>(undefined)
  const historyRef = useRef<OpenAI.Chat.ChatCompletionMessageParam[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingEditsRef = useRef<VscodeAiPendingEdit[]>([])
  const sessionIdRef = useRef(sessionId)

  useEffect(() => {
    if (sessionIdRef.current === sessionId) return
    sessionIdRef.current = sessionId
    setDraft('')
    setBusy(false)
    setLiveTimeline([])
    setLiveAnswer('')
    abortRef.current?.abort()
    abortRef.current = undefined
    historyRef.current = []
    pendingEditsRef.current = []
  }, [sessionId])

  const runCommandHost = useMemo<VscodeAiRunCommandHost>(
    () => ({
      terminalRepl,
      workspaceFolder,
      confirm: (request) =>
        modal.confirm({
          title: request.title,
          message: request.message,
          confirmLabel: '运行',
          cancelLabel: '取消',
        }),
    }),
    [modal, terminalRepl, workspaceFolder],
  )

  const toolsHost = useMemo<VscodeAiToolsHost>(
    () => ({
      getContext,
      getProblems: () => problems,
      getOpenFilesForSearch,
      onProposeEdit: (edit) => {
        pendingEditsRef.current = [...pendingEditsRef.current, edit]
      },
      runCommandHost,
      privilegeSource: 'user',
      privilegeActorLabel: 'VS Code AI',
    }),
    [getContext, getOpenFilesForSearch, problems, runCommandHost],
  )

  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, liveTimeline, liveAnswer, scrollToBottom])

  const handleClear = useCallback(() => {
    if (busy) return
    onMessagesChange([])
    historyRef.current = []
  }, [busy, onMessagesChange])

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
          context: getContext(),
          toolsHost,
          history: historyRef.current.length > 0 ? historyRef.current : undefined,
          signal: controller.signal,
          modelKey: aiModelKey,
          onProgress: (progress) => {
            setLiveTimeline(progress.timeline)
            setLiveAnswer(progress.answerText)
            pendingEditsRef.current = progress.pendingEdits
          },
        })

        if (result.messages) {
          historyRef.current = result.messages
        }

        const assistantMessage = createVscodeAiChatMessage('assistant', result.text || liveAnswer, {
          pendingEdits: result.pendingEdits.length > 0 ? result.pendingEdits : undefined,
          incomplete: result.incomplete,
        })
        onMessagesChange([...withUser, assistantMessage])
      } catch (error) {
        const assistantMessage = createVscodeAiChatMessage('assistant', formatError(error), {
          isError: true,
        })
        onMessagesChange([...withUser, assistantMessage])
      } finally {
        setBusy(false)
        setLiveTimeline([])
        setLiveAnswer('')
        abortRef.current = undefined
      }
    },
    [aiModelKey, busy, draft, getContext, liveAnswer, messages, mode, onMessagesChange, toolsHost],
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
      <header class="help-app__toolbar vscode-ai__toolbar">
        <span class="help-app__toolbar-title">AI</span>
        <button
          type="button"
          class="help-app__clear"
          onClick={handleClear}
          disabled={busy || messages.length === 0}
        >
          清空
        </button>
      </header>

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
                  class={`help-app__bubble${message.isError ? ' help-app__bubble--error' : ''}`}
                >
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
              <select
                class="vscode-ai__footer-select"
                value={mode}
                disabled={busy}
                aria-label="AI 模式"
                onChange={(event) => {
                  const value = (event.target as HTMLSelectElement).value
                  if (isVscodeAiMode(value)) onModeChange(value)
                }}
              >
                {(['ask', 'edit', 'agent'] as const).map((item) => (
                  <option key={item} value={item}>
                    {VSCODE_AI_MODE_LABELS[item]}
                  </option>
                ))}
              </select>
            </label>
            <label class="vscode-ai__footer-field vscode-ai__footer-field--model">
              <span class="vscode-ai__footer-label">模型</span>
              <select
                class="vscode-ai__footer-select"
                value={resolvedModelKey ?? ''}
                disabled={busy || textModels.length === 0}
                onChange={(event) =>
                  onAiModelKeyChange((event.target as HTMLSelectElement).value)
                }
              >
                {textModels.length === 0 ? (
                  <option value="">未配置文本模型</option>
                ) : (
                  textModels.map((model) => {
                    const key = formatVscodeAiModelRefKey({
                      providerEntryId: model.providerEntryId,
                      modelId: model.modelId,
                    })
                    return (
                      <option key={key} value={key}>
                        {labelForVscodeAiModel(model)}
                      </option>
                    )
                  })
                )}
              </select>
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

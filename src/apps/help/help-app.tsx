import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { isStreamAbortError } from '../../ai/stream-abort.ts'
import { HelpIcon } from '../../icons/app-icons.tsx'
import { osNowMs } from '../../os/os-clock.ts'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import {
  CHAT_CONTENT_WIDTH_OPTIONS,
  type ChatContentWidth,
} from '../chat-content-width.ts'
import {
  askHelpAgent,
  type HelpAgentActivity,
  type HelpAgentContinuation,
  type HelpInvestigation,
  type HelpInvestigationStep,
  type HelpTimelineItem,
} from './help-agent.ts'
import { createHelpActivityRevealController } from './help-activity-reveal.ts'
import { HelpMarkdown } from './help-markdown.tsx'
import './help.css'

const APP_ID = 'help' as const

const INVESTIGATION_STEP_STAGGER_MS = 55
const INVESTIGATION_STEP_ANIM_MS = 320
/** 收起时整块高度与条目淡出共用同一时长，避免错开看起来忽快忽慢 */
const INVESTIGATION_COLLAPSE_MS = 280

function menuCheckPrefix(active: boolean): string {
  return active ? '✓ ' : ''
}

const SAMPLE_PROMPT_POOL = [
  '怎么改系统时间？',
  '新闻怎么用？',
  '邮件怎么收发？',
  '书架里的小说怎么读？',
  '这个系统大概是怎么运作的？',
  '应用商店和 iCode 有什么区别？',
  '应用商店的评论区怎么用？',
  '应用商店里怎么安装应用？',
  '天气怎么看？',
  '翻译怎么用？',
  '月历怎么用？',
  'CatGPT 能做什么？',
  '系统设置在哪里打开？',
  '程序坞里的图标怎么用？',
  '股票应用怎么看行情？',
  '存储空间够不够用？',
  '哪些东西占了本地空间？',
] as const

const SAMPLE_PROMPT_COUNT = 4

function pickSamplePrompts(count = SAMPLE_PROMPT_COUNT): string[] {
  const pool = [...SAMPLE_PROMPT_POOL]
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = pool[index]
    const swapped = pool[swapIndex]
    if (current === undefined || swapped === undefined) {
      continue
    }
    pool[index] = swapped
    pool[swapIndex] = current
  }
  return pool.slice(0, Math.min(count, pool.length))
}

type HelpMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  isError?: boolean
  createdAt: number
  investigation?: HelpInvestigation
  incomplete?: boolean
  continuation?: HelpAgentContinuation
}

function createMessage(
  role: HelpMessage['role'],
  content: string,
  extras?: {
    isError?: boolean
    investigation?: HelpInvestigation
    incomplete?: boolean
    continuation?: HelpAgentContinuation
  },
): HelpMessage {
  return {
    id: `help-${osNowMs()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    isError: extras?.isError,
    createdAt: osNowMs(),
    investigation: extras?.investigation,
    incomplete: extras?.incomplete,
    continuation: extras?.continuation,
  }
}

function formatHelpError(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
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

function formatInvestigationSummary(investigation: HelpInvestigation): string {
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

function HelpActivityRow({
  activity,
  live,
  isCurrent,
}: {
  activity: HelpAgentActivity
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

function HelpReasoningStatus({
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
    const snippet = latestReasoningSnippet(text)
    return (
      <div class="help-app__reasoning-status help-app__reasoning-status--live" aria-live="polite">
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

function HelpInvestigationPanel({
  investigation,
}: {
  investigation: HelpInvestigation
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
              <HelpInvestigationSteps
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

function HelpInvestigationSteps({
  timeline,
  exiting = false,
}: {
  timeline: HelpInvestigationStep[]
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
                <HelpActivityRow activity={item} />
              </ol>
            ) : (
              <HelpReasoningStatus text={item.content} durationMs={item.durationMs} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function visibleLiveTimeline(
  timeline: HelpTimelineItem[],
  revealedActivities: HelpAgentActivity[],
): HelpTimelineItem[] {
  const revealedById = new Map(revealedActivities.map((item) => [item.id, item]))
  const items: HelpTimelineItem[] = []

  for (const item of timeline) {
    if (item.kind === 'text' || item.kind === 'reasoning') {
      items.push(item)
      continue
    }
    const revealed = revealedById.get(item.id)
    if (!revealed) {
      continue
    }
    items.push({
      kind: 'activity',
      id: revealed.id,
      label: revealed.label,
      detail: revealed.detail,
      done: Boolean(revealed.done),
    })
  }

  return items
}

function HelpLiveTimeline({
  timeline,
}: {
  timeline: HelpTimelineItem[]
}) {
  if (timeline.length === 0) {
    return (
      <div class="help-app__investigation help-app__investigation--live">
        <p class="help-app__investigation-live-title">正在为你查找答案</p>
      </div>
    )
  }

  const lastIndex = timeline.length - 1

  return (
    <div class="help-app__live-timeline">
      {timeline.map((item, index) => {
        if (item.kind === 'activity') {
          const isCurrent = index === lastIndex && !item.done
          return (
            <ol key={item.id} class="help-app__activity-list help-app__activity-list--inline">
              <HelpActivityRow activity={item} live isCurrent={isCurrent} />
            </ol>
          )
        }

        if (item.kind === 'reasoning') {
          return (
            <HelpReasoningStatus
              key={item.id}
              text={item.content}
              streaming={!item.done}
              durationMs={item.durationMs}
            />
          )
        }

        return (
          <div
            key={item.id}
            class={`help-app__live-answer${item.done ? '' : ' help-app__live-answer--streaming'}`}
          >
            <HelpMarkdown text={item.content} streaming={!item.done} />
          </div>
        )
      })}
    </div>
  )
}

export function HelpApp() {
  const { closeWindowsForApp, minimizeWindow, setAppWindowTitle, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const [messages, setMessages] = useState<HelpMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [thinkingEnabled, setThinkingEnabled] = useState(true)
  const [contentWidth, setContentWidth] = useState<ChatContentWidth>('standard')
  const [samplePrompts, setSamplePrompts] = useState(() => pickSamplePrompts())
  const [liveTimeline, setLiveTimeline] = useState<HelpTimelineItem[]>([])
  const [liveDisplayActivities, setLiveDisplayActivities] = useState<HelpAgentActivity[]>([])
  const [liveAnswerLength, setLiveAnswerLength] = useState(0)
  const liveStartedAtRef = useRef(0)
  const liveInvestigationRef = useRef<HelpInvestigation | undefined>()
  const liveAnswerTextRef = useRef('')
  const abortControllerRef = useRef<AbortController | undefined>()
  const thinkingEnabledRef = useRef(thinkingEnabled)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const activityRevealRef = useRef(
    createHelpActivityRevealController({
      onChange: (activities) => {
        setLiveDisplayActivities(activities)
      },
    }),
  )

  useEffect(() => {
    thinkingEnabledRef.current = thinkingEnabled
  }, [thinkingEnabled])

  useEffect(() => {
    const controller = activityRevealRef.current
    return () => {
      abortControllerRef.current?.abort()
      controller.dispose()
    }
  }, [])

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [])

  const resetLiveState = useCallback(() => {
    setLiveTimeline([])
    setLiveAnswerLength(0)
    liveInvestigationRef.current = undefined
    liveAnswerTextRef.current = ''
    activityRevealRef.current.reset()
  }, [])

  const handleClear = useCallback(() => {
    if (busy) {
      return
    }
    setMessages([])
    setSamplePrompts(pickSamplePrompts())
    resetLiveState()
  }, [busy, resetLiveState])

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort()
  }, [])

  const runHelpAgent = useCallback(
    async (options: {
      question?: string
      resumeMessages?: HelpAgentContinuation['messages']
      replaceMessageId?: string
    }) => {
      if (busy) {
        return
      }

      setBusy(true)
      liveStartedAtRef.current = Date.now()
      resetLiveState()

      const abortController = new AbortController()
      abortControllerRef.current = abortController

      const applyAssistantResult = (
        text: string,
        extras: {
          isError?: boolean
          investigation?: HelpInvestigation
          incomplete?: boolean
          continuation?: HelpAgentContinuation
        },
      ) => {
        const nextMessage = createMessage('assistant', text, extras)
        setMessages((prev) => {
          if (!options.replaceMessageId) {
            return [...prev, nextMessage]
          }
          let replaced = false
          const mapped = prev.map((message) => {
            if (message.id !== options.replaceMessageId) {
              return message
            }
            replaced = true
            const mergedInvestigation =
              message.investigation && extras.investigation
                ? {
                    activities: [
                      ...message.investigation.activities,
                      ...extras.investigation.activities,
                    ],
                    timeline: [
                      ...message.investigation.timeline,
                      ...extras.investigation.timeline,
                    ],
                    reasoningText: [
                      message.investigation.reasoningText,
                      extras.investigation.reasoningText,
                    ]
                      .filter(Boolean)
                      .join('\n\n') || undefined,
                    reasoningDurationMs: (() => {
                      const durations = [
                        message.investigation.reasoningDurationMs,
                        extras.investigation.reasoningDurationMs,
                      ].filter((value): value is number => value !== undefined)
                      return durations.length > 0
                        ? durations.reduce((sum, value) => sum + value, 0)
                        : undefined
                    })(),
                    toolCallCount:
                      message.investigation.toolCallCount +
                      extras.investigation.toolCallCount,
                    durationMs:
                      message.investigation.durationMs +
                      extras.investigation.durationMs,
                  }
                : extras.investigation ?? message.investigation
            return {
              ...nextMessage,
              id: message.id,
              investigation: mergedInvestigation,
            }
          })
          return replaced ? mapped : [...prev, nextMessage]
        })
      }

      try {
        const result = await askHelpAgent(options.question, {
          thinkingEnabled: thinkingEnabledRef.current,
          signal: abortController.signal,
          resumeMessages: options.resumeMessages,
          onProgress: (progress) => {
            const next: HelpInvestigation = {
              activities: progress.activities,
              timeline: progress.timeline.filter(
                (item): item is HelpInvestigationStep =>
                  item.kind === 'activity' || item.kind === 'reasoning',
              ),
              reasoningText: progress.reasoningText || undefined,
              reasoningDurationMs: progress.reasoningDurationMs,
              toolCallCount: progress.toolCallCount,
              durationMs: Math.max(0, Date.now() - liveStartedAtRef.current),
            }
            liveInvestigationRef.current = next
            liveAnswerTextRef.current = progress.answerText
            setLiveTimeline(progress.timeline)
            setLiveAnswerLength(
              progress.answerText.length + progress.reasoningText.length,
            )
            activityRevealRef.current.setSource(progress.activities)
            // 工具连发时节流；一旦进入思考/正文，立刻追上，别还在蹦过期步骤
            const latest = progress.timeline[progress.timeline.length - 1]
            if (latest?.kind === 'reasoning' || latest?.kind === 'text') {
              activityRevealRef.current.revealAll()
            }
            scrollToBottom()
          },
        })

        const liveSnapshot = liveInvestigationRef.current
        liveInvestigationRef.current = result.investigation
        activityRevealRef.current.setSource(result.investigation.activities)
        activityRevealRef.current.revealAll()

        applyAssistantResult(result.text, {
          investigation: {
            ...result.investigation,
            timeline:
              result.investigation.timeline.length > 0
                ? result.investigation.timeline
                : liveSnapshot?.timeline ?? [],
            reasoningText:
              result.investigation.reasoningText || liveSnapshot?.reasoningText,
            reasoningDurationMs:
              result.investigation.reasoningDurationMs ??
              liveSnapshot?.reasoningDurationMs,
          },
          incomplete: result.incomplete,
          continuation: result.continuation,
        })
      } catch (err) {
        const snapshot = liveInvestigationRef.current
        const durationMs = Math.max(0, Date.now() - liveStartedAtRef.current)
        const investigation = snapshot
          ? {
              ...snapshot,
              activities: snapshot.activities.map((item) => ({
                ...item,
                done: true,
              })),
              timeline: snapshot.timeline.map((item) =>
                item.kind === 'reasoning'
                  ? {
                      ...item,
                      done: true,
                      durationMs:
                        item.durationMs ??
                        Math.max(0, Date.now() - item.startedAt),
                    }
                  : { ...item, done: true },
              ),
              durationMs,
            }
          : undefined

        if (isStreamAbortError(err, abortController.signal)) {
          const partial = liveAnswerTextRef.current.trim()
          applyAssistantResult(partial || '已停止生成。', { investigation })
        } else {
          applyAssistantResult(formatHelpError(err), {
            isError: true,
            investigation,
          })
        }
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = undefined
        }
        setBusy(false)
        resetLiveState()
        scrollToBottom()
      }
    },
    [busy, resetLiveState, scrollToBottom],
  )

  const sendMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim()
      if (!text || busy) {
        return
      }

      setDraft('')
      setMessages((prev) => [...prev, createMessage('user', text)])
      await runHelpAgent({ question: text })
    },
    [busy, runHelpAgent],
  )

  const handleContinue = useCallback(
    (message: HelpMessage) => {
      if (busy || !message.continuation?.messages.length) {
        return
      }
      void runHelpAgent({
        resumeMessages: message.continuation.messages,
        replaceMessageId: message.id,
      })
    },
    [busy, runHelpAgent],
  )

  const handleSubmit = useCallback(() => {
    void sendMessage(draft)
  }, [draft, sendMessage])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        void sendMessage(draft)
      }
    },
    [draft, sendMessage],
  )

  useEffect(() => {
    setAppWindowTitle(APP_ID, '帮助')
  }, [setAppWindowTitle])

  const displayedLiveTimeline = useMemo(
    () => visibleLiveTimeline(liveTimeline, liveDisplayActivities),
    [liveTimeline, liveDisplayActivities],
  )

  useEffect(() => {
    scrollToBottom()
  }, [messages.length, displayedLiveTimeline.length, liveAnswerLength, scrollToBottom])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === APP_ID && !window.minimized)

    return [
      {
        label: '帮助',
        items: [
          ...aboutAppMenuPrefix('关于 帮助', () => showBuiltinAbout(APP_ID)),
          {
            type: 'action',
            label: '隐藏帮助',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出帮助',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
      {
        label: '编辑',
        items: [
          {
            type: 'action',
            label: '清空对话',
            onClick: handleClear,
            disabled: busy || messages.length === 0,
          },
        ],
      },
      {
        label: '内容',
        items: [
          {
            type: 'action',
            label: `${menuCheckPrefix(thinkingEnabled)}深度思考`,
            onClick: () => setThinkingEnabled((current) => !current),
          },
        ],
      },
      {
        label: '视图',
        items: CHAT_CONTENT_WIDTH_OPTIONS.map((option) => ({
          type: 'action' as const,
          label: `${menuCheckPrefix(contentWidth === option.id)}${option.label}`,
          onClick: () => setContentWidth(option.id),
        })),
      },
    ]
  }, [
    busy,
    closeWindowsForApp,
    contentWidth,
    handleClear,
    messages.length,
    minimizeWindow,
    showBuiltinAbout,
    thinkingEnabled,
    windows,
  ])

  useAppMenuBar(APP_ID, menuBar)

  const showWelcome = messages.length === 0 && !busy
  const showLive = busy && displayedLiveTimeline.length > 0

  return (
    <div class={`help-app help-app--width-${contentWidth}`}>
      <header class="help-app__toolbar">
        <span class="help-app__toolbar-title">帮助</span>
        <span class="help-app__toolbar-hint">问怎么用 Instant OS</span>
        {thinkingEnabled ? (
          <span class="help-app__thinking-status" aria-live="polite">
            深度思考
          </span>
        ) : undefined}
        <button
          type="button"
          class="help-app__clear"
          onClick={handleClear}
          disabled={busy || messages.length === 0}
        >
          清空
        </button>
      </header>

      <div class="help-app__chat">
        {showWelcome ? (
          <div class="help-app__welcome">
            <div class="help-app__welcome-icon" aria-hidden="true">
              <HelpIcon size={72} />
            </div>
            <h2 class="help-app__welcome-title">需要帮忙吗？</h2>
            <p class="help-app__welcome-sub">
              告诉我你想做什么。我会告诉你该打开哪里、点哪个按钮，一步一步带你完成。
            </p>
            <div class="help-app__samples" aria-label="示例提问">
              {samplePrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  class="help-app__sample"
                  onClick={() => void sendMessage(prompt)}
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
                    <HelpInvestigationPanel investigation={message.investigation} />
                  ) : undefined}
                  {message.role === 'assistant' && !message.isError ? (
                    <div class="help-app__answer">
                      <HelpMarkdown text={message.content} />
                    </div>
                  ) : (
                    <div class="help-app__answer help-app__answer--plain">{message.content}</div>
                  )}
                  {message.incomplete && message.continuation && !busy ? (
                    <div class="help-app__continue-row">
                      <button
                        type="button"
                        class="help-app__continue"
                        onClick={() => handleContinue(message)}
                      >
                        继续
                      </button>
                    </div>
                  ) : undefined}
                </div>
              </div>
            ))}

            {showLive ? (
              <div class="help-app__message help-app__message--assistant">
                <span class="help-app__avatar" aria-hidden="true">
                  <HelpIcon size={30} />
                </span>
                <div class="help-app__bubble help-app__bubble--with-investigation help-app__bubble--live">
                  <HelpLiveTimeline timeline={displayedLiveTimeline} />
                </div>
              </div>
            ) : undefined}

            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      <div class="help-app__composer-wrap">
        <div class="help-app__composer">
          <textarea
            class="help-app__input"
            rows={1}
            value={draft}
            placeholder="例如：书架里的小说怎么读？"
            disabled={busy}
            onInput={(event) => setDraft((event.target as HTMLTextAreaElement).value)}
            onKeyDown={handleKeyDown}
          />
          {busy ? (
            <button
              type="button"
              class="help-app__stop"
              aria-label="停止"
              title="停止"
              onClick={handleStop}
            >
              ■
            </button>
          ) : (
            <button
              type="button"
              class="help-app__send"
              aria-label="发送"
              onClick={handleSubmit}
              disabled={!draft.trim()}
            >
              ↑
            </button>
          )}
        </div>
        {!showWelcome ? (
          <p class="help-app__disclaimer">AI 生成的内容可能有误</p>
        ) : undefined}
      </div>
    </div>
  )
}

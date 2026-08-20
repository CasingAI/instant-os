import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import {
  formatHumanDurationMs,
  formatThinkingDurationMs,
} from '../../ai/format-human-duration.ts'
import { ForwardIcon } from '../../icons/app-icons.tsx'
import { buildLiveAnswerClassName, HelpMarkdown } from '../help/help-markdown.tsx'
import {
  formatVscodeAiWriteCardHeading,
  type VscodeAiActivity,
  type VscodeAiInvestigation,
  type VscodeAiInvestigationStep,
  type VscodeAiTimelineItem,
  type VscodeAiWriteItem,
} from './vscode-ai-agent.ts'
import { rememberLiveCompressionDetail } from './vscode-compression-lookup.ts'
import { VscodeMarkdownPreview } from './vscode-markdown-preview.tsx'
import {
  getRun,
  subscribe,
  type SubagentRunState,
} from './vscode-subagent-store.ts'

const INVESTIGATION_STEP_STAGGER_MS = 55
const INVESTIGATION_STEP_ANIM_MS = 320
const INVESTIGATION_COLLAPSE_MS = 280
/** 模型输入（工具参数）在显示层的本地预览上限；超出时提供「查看完整输入」就地展开 */
const ACTIVITY_CONTENT_PREVIEW_LIMIT = 4_000

export function formatInvestigationSummary(investigation: VscodeAiInvestigation): string {
  const parts = ['已完成调查']
  if (
    investigation.reasoningDurationMs !== undefined &&
    investigation.reasoningDurationMs >= 5000
  ) {
    parts.push(formatThinkingDurationMs(investigation.reasoningDurationMs))
  }
  parts.push(
    investigation.toolCallCount > 0
      ? `调用 ${investigation.toolCallCount} 个工具`
      : '未调用工具',
  )
  parts.push(`用时 ${formatHumanDurationMs(investigation.durationMs)}`)
  return parts.join(' · ')
}

export function WaitingDots() {
  return (
    <span class="help-app__waiting-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  )
}

export function latestReasoningSnippet(text: string, maxLen = 56): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) {
    return ''
  }
  if (cleaned.length <= maxLen) {
    return cleaned
  }
  return `…${cleaned.slice(-maxLen)}`
}

export function WaitingStatus({ label = '等待响应' }: { label?: string }) {
  return (
    <div class="help-app__reasoning-status help-app__reasoning-status--waiting" aria-live="polite">
      <span class="help-app__reasoning-status-label">{label}</span>
    </div>
  )
}

export function CompressionStatus({
  item,
  sessionId,
  onOpenCompressionDetail,
}: {
  item: Extract<VscodeAiTimelineItem, { kind: 'compression' }>
  sessionId?: string
  onOpenCompressionDetail?: (sessionId: string, compressionId: string) => void
}) {
  const canOpen = Boolean(sessionId && onOpenCompressionDetail)
  return (
    <button
      type="button"
      class={`help-app__reasoning-status help-app__reasoning-status--done vscode-ai__compression-row${canOpen ? '' : ' vscode-ai__compression-row--disabled'}`}
      aria-label={canOpen ? `查看压缩详情：${item.label}` : item.label}
      disabled={!canOpen}
      onClick={() => {
        if (!canOpen || !sessionId || !onOpenCompressionDetail) return
        rememberLiveCompressionDetail(sessionId, item)
        onOpenCompressionDetail(sessionId, item.id)
      }}
    >
      <span class="help-app__reasoning-summary">{item.label}</span>
      {canOpen ? (
        <span class="vscode-ai__compression-row-arrow" aria-hidden="true">
          →
        </span>
      ) : undefined}
    </button>
  )
}

export function WriteFileCard({
  item,
  live,
}: {
  item: VscodeAiWriteItem
  live?: boolean
}) {
  const [expanded, setExpanded] = useState(!item.done)
  const previewScrollRef = useRef<HTMLElement | null>(null)
  const streaming = Boolean(live) && !item.done
  const preview = item.preview.trim()
  const heading = formatVscodeAiWriteCardHeading(item.toolName, item.phase)
  const markdownPreview =
    item.toolName === 'write_plan' || item.toolName === 'update_plan'

  useLayoutEffect(() => {
    if (!streaming || !expanded) return
    const el = previewScrollRef.current
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
        markdownPreview ? (
          <div
            ref={(node) => {
              previewScrollRef.current = node
            }}
            class="vscode-ai__write-card-preview vscode-ai__write-card-preview--md"
          >
            {preview ? (
              <VscodeMarkdownPreview text={preview} />
            ) : (
              <span class="vscode-ai__write-card-preview-empty">
                {streaming ? '…' : '（无预览）'}
              </span>
            )}
          </div>
        ) : (
          <pre
            ref={(node) => {
              previewScrollRef.current = node
            }}
            class="vscode-ai__write-card-preview"
          >
            {preview || (streaming ? '…' : '（无预览）')}
          </pre>
        )
      ) : undefined}
    </div>
  )
}

/** 订阅 Sub Agent store，实时拿到该 run 的最新状态（运行中/结束时间） */
function useSubagentRun(runId: string | undefined): SubagentRunState | undefined {
  const [, setVersion] = useState(0)
  useEffect(() => {
    if (!runId) return
    return subscribe(() => setVersion((v) => v + 1))
  }, [runId])
  return runId ? getRun(runId) : undefined
}

/**
 * 返回 Sub Agent 的耗时（毫秒）：
 * 运行中 → 每秒刷新的已运行时长；结束 → 结束时刻减开始时刻的总耗时。
 */
function useSubagentElapsedMs(run: SubagentRunState | undefined): number | undefined {
  const [, setTick] = useState(0)
  const running = Boolean(run && run.status === 'running' && run.startedAt > 0)
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [running])
  if (!run) return undefined
  if (run.status === 'running') {
    return Math.max(0, Date.now() - run.startedAt)
  }
  return run.endedAt !== undefined ? Math.max(0, run.endedAt - run.startedAt) : undefined
}

export function SubagentDuration({ run }: { run: SubagentRunState | undefined }) {
  const elapsed = useSubagentElapsedMs(run)
  if (!run || elapsed === undefined) return undefined
  return (
    <span class="vscode-ai__subagent-duration">
      {run.status === 'running'
        ? `运行中 · ${formatHumanDurationMs(elapsed)}`
        : `用时 ${formatHumanDurationMs(elapsed)}`}
    </span>
  )
}

export function ActivityStatus({
  activity,
  live,
  isCurrent,
  onOpenSubagentDetail,
}: {
  activity: VscodeAiActivity
  live?: boolean
  isCurrent?: boolean
  onOpenSubagentDetail?: (runId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [showFullInput, setShowFullInput] = useState(false)
  const current = Boolean(live) && Boolean(isCurrent) && !activity.done
  const content = activity.content?.trim() ?? ''
  const result = activity.result?.trim() ?? ''
  const inputTruncated = content.length > ACTIVITY_CONTENT_PREVIEW_LIMIT
  const shownInput = showFullInput || !inputTruncated
    ? content
    : content.slice(0, ACTIVITY_CONTENT_PREVIEW_LIMIT)
  const expandable = Boolean(content || result)
  const canOpenDetail = Boolean(activity.subagentRunId && onOpenSubagentDetail)
  const subagentRun = useSubagentRun(activity.subagentRunId)
  const openDetail = () => {
    if (activity.subagentRunId && onOpenSubagentDetail) {
      onOpenSubagentDetail(activity.subagentRunId)
    }
  }
  const summary = (
    <>
      {activity.label}
      {activity.detail ? (
        <span class="help-app__reasoning-summary-detail"> · {activity.detail}</span>
      ) : undefined}
      {subagentRun ? <SubagentDuration run={subagentRun} /> : undefined}
    </>
  )

  if (current) {
    if (canOpenDetail) {
      return (
        <button
          type="button"
          class="help-app__reasoning-status help-app__reasoning-status--waiting vscode-ai__subagent-row"
          aria-live="polite"
          aria-label={`查看 Sub Agent 详情：${activity.detail || activity.label}`}
          onClick={openDetail}
        >
          <WaitingDots />
          <span class="help-app__reasoning-status-label">{summary}</span>
          <span class="vscode-ai__subagent-row-arrow" aria-hidden="true">
            <ForwardIcon size={12} />
          </span>
        </button>
      )
    }
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

  if (canOpenDetail) {
    return (
      <button
        type="button"
        class="help-app__reasoning-status vscode-ai__subagent-row"
        aria-label={`查看 Sub Agent 详情：${activity.detail || activity.label}`}
        onClick={openDetail}
      >
        <span class="help-app__reasoning-status-label">{summary}</span>
        <span class="vscode-ai__subagent-row-arrow" aria-hidden="true">
          <ForwardIcon size={12} />
        </span>
      </button>
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
            <>
              <pre
                class={`help-app__reasoning-body help-app__reasoning-body--code${showFullInput ? ' help-app__reasoning-body--full' : ''}`}
              >
                {shownInput}
                {inputTruncated && !showFullInput ? '\n…（已截断）' : ''}
              </pre>
              {inputTruncated ? (
                <button
                  type="button"
                  class="help-app__reasoning-content-toggle"
                  aria-expanded={showFullInput}
                  onClick={() => setShowFullInput((value) => !value)}
                >
                  <span
                    class={`help-app__investigation-chevron${showFullInput ? ' help-app__investigation-chevron--expanded' : ''}`}
                    aria-hidden="true"
                  />
                  <span>{showFullInput ? '收起' : '查看完整输入'}</span>
                </button>
              ) : undefined}
            </>
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

export function ReasoningStatus({
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
          {formatThinkingDurationMs(durationMs)}
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

export function InvestigationSteps({
  timeline,
  exiting = false,
  sessionId,
  onOpenSubagentDetail,
  onOpenCompressionDetail,
}: {
  timeline: VscodeAiInvestigationStep[]
  exiting?: boolean
  sessionId?: string
  onOpenSubagentDetail?: (runId: string) => void
  onOpenCompressionDetail?: (sessionId: string, compressionId: string) => void
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
              <ActivityStatus activity={item} onOpenSubagentDetail={onOpenSubagentDetail} />
            ) : item.kind === 'write' ? (
              <WriteFileCard item={item} />
            ) : item.kind === 'compression' ? (
              <CompressionStatus
                item={item}
                sessionId={sessionId}
                onOpenCompressionDetail={onOpenCompressionDetail}
              />
            ) : (
              <ReasoningStatus text={item.content} durationMs={item.durationMs} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function InvestigationPanel({
  investigation,
  sessionId,
  onOpenSubagentDetail,
  onOpenCompressionDetail,
}: {
  investigation: VscodeAiInvestigation
  sessionId?: string
  onOpenSubagentDetail?: (runId: string) => void
  onOpenCompressionDetail?: (sessionId: string, compressionId: string) => void
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
                sessionId={sessionId}
                onOpenSubagentDetail={onOpenSubagentDetail}
                onOpenCompressionDetail={onOpenCompressionDetail}
              />
            </div>
          </div>
        </div>
      ) : undefined}
    </div>
  )
}

export function LiveTimeline({
  items,
  sessionId,
  onOpenSubagentDetail,
  onOpenCompressionDetail,
}: {
  items: VscodeAiTimelineItem[]
  sessionId?: string
  onOpenSubagentDetail?: (runId: string) => void
  onOpenCompressionDetail?: (sessionId: string, compressionId: string) => void
}) {
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
                subagentRunId: item.subagentRunId,
              }}
              live
              isCurrent={isLast && !item.done}
              onOpenSubagentDetail={onOpenSubagentDetail}
            />
          )
        }
        if (item.kind === 'write') {
          return <WriteFileCard key={item.id} item={item} live />
        }
        if (item.kind === 'compression') {
          return (
            <CompressionStatus
              key={item.id}
              item={item}
              sessionId={sessionId}
              onOpenCompressionDetail={onOpenCompressionDetail}
            />
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
        if (item.kind !== 'text') {
          return undefined
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


import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { ForwardIcon } from '../../icons/app-icons.tsx'
import type { AppGenerationPhase } from '../appstore/generate-app-stream.ts'
import {
  countTextLines,
  extractFullHtmlDocumentFromContent,
  extractInProgressCodeOutput,
  extractInProgressFullHtmlOutput,
  extractNaturalLanguageReply,
  parseIcodeContentSegments,
  splitTextForDisplay,
  stripInProgressHtmlFromProse,
} from './icode-apply-edits.ts'
import { IcodeChatMarkdown } from './icode-chat-markdown.tsx'
import type { ICodeChatCapabilityRequestStatus, ICodeChatEditBlock, ICodeChatMessage } from './icode-types.ts'
import {
  formatGrantableCapabilityDescription,
  formatGrantableCapabilityLabel,
  type GrantableIcodeCapabilityTag,
} from './icode-capability-request.ts'
import type { AppCapabilityTag } from '../appstore/app-capability-tags.ts'
import { hasAppCapabilityTag } from '../appstore/app-capability-tags.ts'

function previewSnippet(text: string, maxLines = 5): string {
  const trimmed = text.trim()
  if (!trimmed) {
    return '（空）'
  }

  const lines = trimmed.split('\n')
  if (lines.length <= maxLines) {
    return trimmed
  }

  return `${lines.slice(0, maxLines).join('\n')}\n…（共 ${lines.length} 行）`
}

type IcodeChatFoldProps = {
  title: string
  expanded: boolean
  onToggle: () => void
  children: ComponentChildren
}

function IcodeChatFold({ title, expanded, onToggle, children }: IcodeChatFoldProps) {
  return (
    <div class={`icode__chat-fold${expanded ? ' icode__chat-fold--expanded' : ''}`}>
      <button type="button" class="icode__chat-fold-trigger" onClick={onToggle}>
        <span
          class={`icode__chat-fold-icon${expanded ? ' icode__chat-fold-icon--expanded' : ''}`}
          aria-hidden="true"
        >
          <ForwardIcon size={11} />
        </span>
        <span class="icode__chat-fold-title">{title}</span>
      </button>
      {expanded && <div class="icode__chat-fold-body">{children}</div>}
    </div>
  )
}

function IcodeChatStreamingCodePanel({ codeText, label }: { codeText: string; label: string }) {
  const codeRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const panel = codeRef.current
    if (!panel) {
      return
    }

    const scrollToBottom = () => {
      panel.scrollTop = panel.scrollHeight
    }

    scrollToBottom()
    const frame = window.requestAnimationFrame(scrollToBottom)
    const observer = new ResizeObserver(scrollToBottom)
    observer.observe(panel)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [codeText])

  return (
    <div class="icode__chat-code-stream">
      <p class="icode__chat-code-stream-label">
        <span class="icode__chat-code-stream-dot" aria-hidden="true" />
        {label}
      </p>
      <pre
        ref={codeRef}
        class="icode__chat-fold-text icode__chat-fold-text--output icode__chat-code-stream-text"
      >
        {codeText}
      </pre>
    </div>
  )
}

type IcodeChatCapabilityRequestCardProps = {
  tag: GrantableIcodeCapabilityTag
  reason: string
  status: ICodeChatCapabilityRequestStatus
  onGrant?: () => void
  onDismiss?: () => void
}

function IcodeChatCapabilityRequestCard({
  tag,
  reason,
  status,
  onGrant,
  onDismiss,
}: IcodeChatCapabilityRequestCardProps) {
  const pending = status === 'pending'

  return (
    <div
      class={`icode__chat-capability${pending ? ' icode__chat-capability--pending' : ''}${status === 'granted' ? ' icode__chat-capability--granted' : ''}${status === 'dismissed' ? ' icode__chat-capability--dismissed' : ''}`}
    >
      <div class="icode__chat-capability-well">
        <div class="icode__chat-capability-header">
          <span class="icode__chat-capability-badge">{formatGrantableCapabilityLabel(tag)}</span>
          {status === 'granted' && <span class="icode__chat-capability-status">已授予</span>}
          {status === 'dismissed' && <span class="icode__chat-capability-status">已忽略</span>}
        </div>
        <p class="icode__chat-capability-description">{formatGrantableCapabilityDescription(tag)}</p>
        {reason.trim() && <p class="icode__chat-capability-reason">{reason.trim()}</p>}
        {pending && (
          <div class="icode__chat-capability-actions">
            <button type="button" class="icode__button icode__button--primary icode__chat-capability-grant" onClick={onGrant}>
              授予能力
            </button>
            <button
              type="button"
              class="icode__button icode__button--secondary icode__chat-capability-dismiss"
              onClick={onDismiss}
            >
              暂不授予
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

type IcodeChatAssistantMessageProps = {
  summary: string
  reasoningText?: string
  outputText?: string
  edits?: ICodeChatEditBlock[]
  appliedEdits?: number
  editStreaming?: boolean
  streaming?: boolean
  phase?: AppGenerationPhase
  visibleReply?: string
  grantedTags?: readonly AppCapabilityTag[]
  capabilityRequests?: ICodeChatMessage['capabilityRequests']
  onGrantCapabilityRequest?: (index: number, tag: GrantableIcodeCapabilityTag) => void
  onDismissCapabilityRequest?: (index: number) => void
}

export function IcodeChatAssistantMessage({
  summary,
  reasoningText,
  outputText,
  edits,
  appliedEdits,
  editStreaming = false,
  streaming = false,
  phase,
  visibleReply,
  grantedTags = [],
  capabilityRequests,
  onGrantCapabilityRequest,
  onDismissCapabilityRequest,
}: IcodeChatAssistantMessageProps) {
  const reasoningRef = useRef<HTMLPreElement>(null)
  const hasReasoning = Boolean(reasoningText?.trim())
  const sourceText = outputText ?? ''
  const segments = useMemo(() => parseIcodeContentSegments(sourceText), [sourceText])
  const hasStructuredOutput = segments.some((segment) => segment.type === 'edit')
  const hasProseSegments = useMemo(
    () =>
      segments.some(
        (segment) =>
          segment.type === 'text' &&
          splitTextForDisplay(segment.text).some((part) => part.type === 'prose'),
      ),
    [segments],
  )
  const naturalReply = useMemo(() => extractNaturalLanguageReply(sourceText), [sourceText])
  const legacySummary = !sourceText.trim() ? summary.trim() : ''
  const streamingFallback =
    streaming && !hasProseSegments
      ? visibleReply?.trim() || naturalReply
      : ''
  const liveCodeText = useMemo(
    () => (streaming && editStreaming ? extractInProgressCodeOutput(sourceText) : ''),
    [editStreaming, sourceText, streaming],
  )
  const inProgressHtml = useMemo(
    () => (streaming ? extractInProgressFullHtmlOutput(sourceText) : ''),
    [sourceText, streaming],
  )
  const liveOutputText = liveCodeText || inProgressHtml
  const liveOutputLabel = liveCodeText
    ? '正在编写代码'
    : inProgressHtml
      ? '正在编写完整源码'
      : '正在编写代码'
  const showLiveCodePanel =
    streaming &&
    (editStreaming || Boolean(inProgressHtml)) &&
    phase === 'generating' &&
    Boolean(liveOutputText)
  const completedFullHtml = useMemo(
    () => (!streaming ? extractFullHtmlDocumentFromContent(sourceText) : undefined),
    [sourceText, streaming],
  )

  const [reasoningOpen, setReasoningOpen] = useState(streaming && phase === 'thinking')
  const [openEdits, setOpenEdits] = useState<Record<number, boolean>>({})
  const [htmlFoldOpen, setHtmlFoldOpen] = useState(false)

  const completedHtmlFolds = useMemo(() => {
    if (streaming) {
      return [] as Array<{ key: string; html: string }>
    }

    const seen = new Set<string>()
    const folds: Array<{ key: string; html: string }> = []

    for (const segment of segments) {
      if (segment.type !== 'text') {
        continue
      }

      for (const part of splitTextForDisplay(segment.text)) {
        if (part.type === 'full_html' && part.complete && !seen.has(part.html)) {
          seen.add(part.html)
          folds.push({ key: `html-${folds.length}`, html: part.html })
        }
      }
    }

    if (completedFullHtml && !seen.has(completedFullHtml)) {
      folds.push({ key: 'html-orphan', html: completedFullHtml })
    }

    return folds
  }, [completedFullHtml, segments, streaming])

  useEffect(() => {
    if (!streaming) {
      setHtmlFoldOpen(false)
      return
    }

    if (inProgressHtml) {
      setHtmlFoldOpen(true)
    }
  }, [inProgressHtml, streaming])

  useEffect(() => {
    if (!streaming) {
      return
    }

    if (phase === 'thinking') {
      setReasoningOpen(true)
      return
    }

    if (phase === 'generating' || phase === 'waiting') {
      setReasoningOpen(false)
    }
  }, [phase, streaming])

  useEffect(() => {
    if (!streaming || !reasoningOpen || !reasoningText?.trim()) {
      return
    }

    const reasoningPanel = reasoningRef.current
    if (!reasoningPanel) {
      return
    }

    const scrollReasoningToBottom = () => {
      reasoningPanel.scrollTop = reasoningPanel.scrollHeight
    }

    scrollReasoningToBottom()
    const frame = window.requestAnimationFrame(scrollReasoningToBottom)
    const observer = new ResizeObserver(scrollReasoningToBottom)
    observer.observe(reasoningPanel)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [reasoningOpen, reasoningText, streaming])

  useEffect(() => {
    if (!streaming) {
      return
    }

    const editIndexes = [
      ...segments
        .filter((segment): segment is Extract<typeof segment, { type: 'edit' }> => segment.type === 'edit')
        .map((segment) => segment.index),
      ...(edits?.map((_, index) => index) ?? []),
    ]
    const latestEditIndex = editIndexes.length > 0 ? Math.max(...editIndexes) : -1
    if (latestEditIndex >= 0) {
      setOpenEdits((current) => ({ ...current, [latestEditIndex]: true }))
    }
  }, [edits, segments, streaming])

  const toggleEdit = (index: number) => {
    setOpenEdits((current) => ({ ...current, [index]: !current[index] }))
  }

  const resolveCapabilityRequestStatus = (
    index: number,
    tag: GrantableIcodeCapabilityTag,
  ): ICodeChatCapabilityRequestStatus => {
    const stored = capabilityRequests?.[index]
    if (stored) {
      return stored.status
    }

    if (hasAppCapabilityTag(grantedTags, tag)) {
      return 'granted'
    }

    return 'pending'
  }

  const resolveCapabilityRequestReason = (
    index: number,
    fallbackReason: string,
  ): string => capabilityRequests?.[index]?.reason ?? fallbackReason

  return (
    <div
      class={`icode__chat-bubble icode__chat-bubble--assistant${streaming ? ' icode__chat-bubble--streaming-assistant' : ''}`}
    >
      <div class="icode__chat-assistant-flow">
        {hasReasoning && (
          <IcodeChatFold
            title="思考过程"
            expanded={reasoningOpen}
            onToggle={() => setReasoningOpen((open) => !open)}
          >
            <pre
              ref={reasoningRef}
              class="icode__chat-fold-text icode__chat-fold-text--reasoning"
            >
              {reasoningText}
            </pre>
          </IcodeChatFold>
        )}

        {segments.map((segment, index) => {
          if (segment.type === 'capability_request') {
            const status = resolveCapabilityRequestStatus(segment.index, segment.request.tag)
            const reason = resolveCapabilityRequestReason(segment.index, segment.request.reason)
            return (
              <IcodeChatCapabilityRequestCard
                key={`capability-${segment.index}`}
                tag={segment.request.tag}
                reason={reason}
                status={status}
                onGrant={
                  status === 'pending' && onGrantCapabilityRequest
                    ? () => onGrantCapabilityRequest(segment.index, segment.request.tag)
                    : undefined
                }
                onDismiss={
                  status === 'pending' && onDismissCapabilityRequest
                    ? () => onDismissCapabilityRequest(segment.index)
                    : undefined
                }
              />
            )
          }

          if (segment.type === 'edit') {
            const expanded = Boolean(openEdits[segment.index])
            return (
              <IcodeChatFold
                key={`edit-${segment.index}`}
                title={`代码修改 ${segment.index + 1}${appliedEdits !== undefined && segment.index < appliedEdits ? ' · 已应用' : ''}`}
                expanded={expanded}
                onToggle={() => toggleEdit(segment.index)}
              >
                <div class="icode__chat-edit">
                  <div class="icode__chat-edit-block">
                    <span class="icode__chat-edit-tag">旧代码(SEARCH)</span>
                    <pre class="icode__chat-fold-text">{previewSnippet(segment.edit.search)}</pre>
                  </div>
                  <div class="icode__chat-edit-block">
                    <span class="icode__chat-edit-tag icode__chat-edit-tag--replace">新代码(REPLACE)</span>
                    <pre class="icode__chat-fold-text">{previewSnippet(segment.edit.replace)}</pre>
                  </div>
                </div>
              </IcodeChatFold>
            )
          }

          const proseText =
            streaming && (inProgressHtml || liveCodeText)
              ? stripInProgressHtmlFromProse(segment.text)
              : splitTextForDisplay(segment.text)
                  .filter((part): part is Extract<typeof part, { type: 'prose' }> => part.type === 'prose')
                  .map((part) => part.text)
                  .join('\n\n')

          if (!proseText.trim()) {
            return undefined
          }

          return (
            <div key={`text-${index}`} class="icode__chat-text-flow">
              <IcodeChatMarkdown
                text={proseText}
                class="icode__chat-markdown icode__chat-reply-text"
              />
            </div>
          )
        })}

        {completedHtmlFolds.map(({ key, html }) => {
          const lineCount = countTextLines(html)
          const title = `重写的文件 · ${lineCount} 行${appliedEdits !== undefined && appliedEdits > 0 ? ' · 已应用' : ''}`

          return (
            <IcodeChatFold
              key={key}
              title={title}
              expanded={htmlFoldOpen}
              onToggle={() => setHtmlFoldOpen((open) => !open)}
            >
              <pre class="icode__chat-fold-text icode__chat-fold-text--output icode__chat-html-output">
                {html}
              </pre>
            </IcodeChatFold>
          )
        })}

        {!hasStructuredOutput && edits?.map((edit, index) => (
          <IcodeChatFold
            key={`legacy-edit-${index}`}
            title={`代码修改 ${index + 1}${appliedEdits !== undefined && index < appliedEdits ? ' · 已应用' : ''}`}
            expanded={Boolean(openEdits[index])}
            onToggle={() => toggleEdit(index)}
          >
            <div class="icode__chat-edit">
              <div class="icode__chat-edit-block">
                <span class="icode__chat-edit-tag">旧代码(SEARCH)</span>
                <pre class="icode__chat-fold-text">{previewSnippet(edit.search)}</pre>
              </div>
              <div class="icode__chat-edit-block">
                <span class="icode__chat-edit-tag icode__chat-edit-tag--replace">新代码(REPLACE)</span>
                <pre class="icode__chat-fold-text">{previewSnippet(edit.replace)}</pre>
              </div>
            </div>
          </IcodeChatFold>
        ))}

        {legacySummary && !hasProseSegments && (
          <IcodeChatMarkdown text={legacySummary} class="icode__chat-markdown icode__chat-reply-text" />
        )}

        {streamingFallback && (
          <IcodeChatMarkdown text={streamingFallback} class="icode__chat-markdown icode__chat-reply-text" />
        )}

        {showLiveCodePanel && (
          <IcodeChatStreamingCodePanel codeText={liveOutputText} label={liveOutputLabel} />
        )}
      </div>
    </div>
  )
}

export function IcodeChatMessageView({
  message,
  grantedTags = [],
  onGrantCapabilityRequest,
  onDismissCapabilityRequest,
}: {
  message: ICodeChatMessage
  grantedTags?: readonly AppCapabilityTag[]
  onGrantCapabilityRequest?: (messageId: string, index: number, tag: GrantableIcodeCapabilityTag) => void
  onDismissCapabilityRequest?: (messageId: string, index: number) => void
}) {
  if (message.role === 'user') {
    return <div class="icode__chat-bubble icode__chat-bubble--user">{message.content}</div>
  }

  return (
    <IcodeChatAssistantMessage
      summary={message.content}
      reasoningText={message.reasoningText}
      outputText={message.outputText}
      edits={message.edits}
      appliedEdits={message.appliedEdits}
      grantedTags={grantedTags}
      capabilityRequests={message.capabilityRequests}
      onGrantCapabilityRequest={
        onGrantCapabilityRequest
          ? (index, tag) => onGrantCapabilityRequest(message.id, index, tag)
          : undefined
      }
      onDismissCapabilityRequest={
        onDismissCapabilityRequest
          ? (index) => onDismissCapabilityRequest(message.id, index)
          : undefined
      }
    />
  )
}

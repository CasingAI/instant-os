import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { ForwardIcon } from '../../icons/app-icons.tsx'
import type { AppGenerationPhase } from '../appstore/generate-app-stream.ts'
import {
  extractInProgressCodeOutput,
  extractNaturalLanguageReply,
  parseIcodeContentSegments,
} from './icode-apply-edits.ts'
import { IcodeChatMarkdown } from './icode-chat-markdown.tsx'
import type { ICodeChatEditBlock, ICodeChatMessage } from './icode-types.ts'

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

function IcodeChatLiveCodePanel({ codeText }: { codeText: string }) {
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
        正在编写代码
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
}: IcodeChatAssistantMessageProps) {
  const reasoningRef = useRef<HTMLPreElement>(null)
  const hasReasoning = Boolean(reasoningText?.trim())
  const sourceText = outputText ?? ''
  const segments = useMemo(() => parseIcodeContentSegments(sourceText), [sourceText])
  const hasStructuredOutput = segments.some((segment) => segment.type === 'edit')
  const hasTextSegments = segments.some((segment) => segment.type === 'text')
  const naturalReply = useMemo(() => extractNaturalLanguageReply(sourceText), [sourceText])
  const legacySummary = !sourceText.trim() ? summary.trim() : ''
  const streamingFallback =
    streaming && !hasTextSegments
      ? visibleReply?.trim() || naturalReply
      : ''
  const liveCodeText = useMemo(
    () => (streaming && editStreaming ? extractInProgressCodeOutput(sourceText) : ''),
    [editStreaming, sourceText, streaming],
  )
  const showLiveCodePanel =
    streaming && editStreaming && phase === 'generating' && Boolean(liveCodeText)

  const [reasoningOpen, setReasoningOpen] = useState(streaming && phase === 'thinking')
  const [openEdits, setOpenEdits] = useState<Record<number, boolean>>({})

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

          return (
            <IcodeChatMarkdown
              key={`text-${index}`}
              text={segment.text}
              class="icode__chat-markdown icode__chat-reply-text"
            />
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

        {legacySummary && !hasTextSegments && (
          <IcodeChatMarkdown text={legacySummary} class="icode__chat-markdown icode__chat-reply-text" />
        )}

        {streamingFallback && (
          <IcodeChatMarkdown text={streamingFallback} class="icode__chat-markdown icode__chat-reply-text" />
        )}

        {showLiveCodePanel && <IcodeChatLiveCodePanel codeText={liveCodeText} />}
      </div>
    </div>
  )
}

export function IcodeChatMessageView({ message }: { message: ICodeChatMessage }) {
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
    />
  )
}

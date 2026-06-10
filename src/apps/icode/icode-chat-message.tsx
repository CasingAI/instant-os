import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { ForwardIcon } from '../../icons/app-icons.tsx'
import type { AppGenerationPhase } from '../appstore/generate-app-stream.ts'
import {
  extractFinalReplyAfterEdits,
  parseIcodeContentSegments,
  type ICodeContentSegment,
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

function lastEditIndexInSegments(segments: ICodeContentSegment[]): number {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index]?.type === 'edit') {
      return index
    }
  }
  return -1
}

function isFinalTextSegment(segments: ICodeContentSegment[], index: number): boolean {
  const segment = segments[index]
  if (segment?.type !== 'text') {
    return false
  }

  const lastEditIndex = lastEditIndexInSegments(segments)
  if (lastEditIndex === -1) {
    return index === segments.length - 1
  }

  return index > lastEditIndex
}

type IcodeChatAssistantMessageProps = {
  summary: string
  reasoningText?: string
  outputText?: string
  edits?: ICodeChatEditBlock[]
  appliedEdits?: number
  streaming?: boolean
  phase?: AppGenerationPhase
  statusLabel?: string
  visibleReply?: string
}

export function IcodeChatAssistantMessage({
  summary,
  reasoningText,
  outputText,
  edits,
  appliedEdits,
  streaming = false,
  phase,
  statusLabel,
  visibleReply,
}: IcodeChatAssistantMessageProps) {
  const reasoningRef = useRef<HTMLPreElement>(null)
  const hasReasoning = Boolean(reasoningText?.trim())
  const sourceText = outputText ?? ''
  const segments = useMemo(() => parseIcodeContentSegments(sourceText), [sourceText])
  const lastEditIndex = lastEditIndexInSegments(segments)
  const hasEditSegments = lastEditIndex >= 0

  const finalReply = streaming
    ? visibleReply?.trim() || extractFinalReplyAfterEdits(sourceText)
    : summary.trim() || extractFinalReplyAfterEdits(sourceText)

  const [reasoningOpen, setReasoningOpen] = useState(streaming && phase === 'thinking')
  const [openPreamble, setOpenPreamble] = useState(false)
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

  const showStatusOnly =
    streaming && !finalReply && !hasReasoning && segments.length === 0 && (phase === 'waiting' || phase === 'thinking')

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
                    <span class="icode__chat-edit-tag">SEARCH</span>
                    <pre class="icode__chat-fold-text">{previewSnippet(segment.edit.search)}</pre>
                  </div>
                  <div class="icode__chat-edit-block">
                    <span class="icode__chat-edit-tag icode__chat-edit-tag--replace">REPLACE</span>
                    <pre class="icode__chat-fold-text">{previewSnippet(segment.edit.replace)}</pre>
                  </div>
                </div>
              </IcodeChatFold>
            )
          }

          if (isFinalTextSegment(segments, index)) {
            return undefined
          }

          const expanded = openPreamble || (streaming && !hasEditSegments)
          return (
            <IcodeChatFold
              key={`text-${index}`}
              title={hasEditSegments ? '前置说明' : '回复'}
              expanded={expanded}
              onToggle={() => setOpenPreamble((open) => !open)}
            >
              <IcodeChatMarkdown text={segment.text} class="icode__chat-fold-markdown" />
            </IcodeChatFold>
          )
        })}

        {!hasEditSegments && edits?.map((edit, index) => (
          <IcodeChatFold
            key={`legacy-edit-${index}`}
            title={`代码修改 ${index + 1}`}
            expanded={Boolean(openEdits[index])}
            onToggle={() => toggleEdit(index)}
          >
            <div class="icode__chat-edit">
              <div class="icode__chat-edit-block">
                <span class="icode__chat-edit-tag">SEARCH</span>
                <pre class="icode__chat-fold-text">{previewSnippet(edit.search)}</pre>
              </div>
              <div class="icode__chat-edit-block">
                <span class="icode__chat-edit-tag icode__chat-edit-tag--replace">REPLACE</span>
                <pre class="icode__chat-fold-text">{previewSnippet(edit.replace)}</pre>
              </div>
            </div>
          </IcodeChatFold>
        ))}

        {showStatusOnly && (
          <p class="icode__chat-stream-placeholder">{statusLabel || '连接 AI…'}</p>
        )}

        {finalReply && (
          <IcodeChatMarkdown text={finalReply} class="icode__chat-summary icode__chat-summary--final" />
        )}
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

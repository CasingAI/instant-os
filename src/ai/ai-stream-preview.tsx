import { useEffect, useRef } from 'preact/hooks'
import './ai-stream-preview.css'

export type AiStreamPreviewProps = {
  reasoningText?: string
  contentText?: string
  variant?: 'notification' | 'safari' | 'scene3d-lab'
  emptyLabel?: string
  className?: string
}

export function AiStreamPreview({
  reasoningText = '',
  contentText = '',
  variant = 'notification',
  emptyLabel = '等待 AI 开始输出…',
  className = '',
}: AiStreamPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const previewText = `${reasoningText}\n${contentText}`

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight
    })

    return () => window.cancelAnimationFrame(frame)
  }, [previewText])

  const hasReasoning = reasoningText.length > 0
  const hasContent = contentText.length > 0
  const hasOutput = hasReasoning || hasContent

  return (
    <div
      ref={containerRef}
      class={`ai-stream-preview ai-stream-preview--${variant}${className ? ` ${className}` : ''}`}
    >
      {!hasOutput ? (
        <p class="ai-stream-preview__empty">{emptyLabel}</p>
      ) : (
        <>
          {hasReasoning && (
            <section class="ai-stream-preview__section">
              <p class="ai-stream-preview__label">思考</p>
              <pre class="ai-stream-preview__text ai-stream-preview__text--reasoning">{reasoningText}</pre>
            </section>
          )}
          {hasContent && (
            <section class="ai-stream-preview__section">
              {hasReasoning && <p class="ai-stream-preview__label">输出</p>}
              <pre class="ai-stream-preview__text ai-stream-preview__text--content">{contentText}</pre>
            </section>
          )}
        </>
      )}
    </div>
  )
}

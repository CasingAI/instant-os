import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { MarkdownHtmlView } from '../../markdown/markdown-html-view.tsx'
import { renderMarkdownHtml } from '../../markdown/render-markdown-html.ts'

/** 流式阶段降低 Markdown 全量重解析频率，减轻分配与主线程压力 */
const STREAMING_MARKDOWN_MIN_INTERVAL_MS = 120

/** 把模型常写出的「假换行」收成真正换行，并给挤成一团的中文步骤补断行 */
function normalizeHelpMarkdownSource(text: string): string {
  let next = text
    .replace(/\r\n?/g, '\n')
    .replace(/\u2028|\u2029/g, '\n')
    // 字面量 \n / \n\n（常见于把 JSON/转义习惯带进正文）
    .replace(/\\n/g, '\n')

  // 「……。1. 下一步」或「…… 2. 下一步」挤在同一行时，在序号前断开
  next = next.replace(/([^\n])(?=\d{1,2}\.\s+\S)/g, '$1\n')

  const newlineCount = (next.match(/\n/g) ?? []).length
  const sentenceEnds = (next.match(/[。！？；]/g) ?? []).length
  if (sentenceEnds >= 2 && newlineCount < sentenceEnds) {
    // 多句却几乎不换行：句读后分段，避免一整墙字
    next = next.replace(/([。！？；])(?=[^\s”」』"'\n])/g, '$1\n\n')
  }

  return next
}

function renderHelpMarkdown(text: string): string {
  return renderMarkdownHtml(text, {
    normalize: normalizeHelpMarkdownSource,
    tableWrapClass: 'help-app__markdown-table-wrap',
  })
}

const STREAM_CARET =
  '<span class="help-app__stream-caret" aria-hidden="true"></span>'

/** 插进最后一个块级叶子节点末尾，让光标跟在文字后面而不是另起一行 */
function appendStreamCaret(html: string): string {
  if (!html) {
    return STREAM_CARET
  }

  const leafClose =
    /<\/(li|p|h[1-6]|td|th|pre|blockquote)>(?:\s*<\/[a-z0-9-]+>)*\s*$/i
  const match = html.match(leafClose)
  if (match?.index !== undefined) {
    return `${html.slice(0, match.index)}${STREAM_CARET}${html.slice(match.index)}`
  }

  return `${html}${STREAM_CARET}`
}

type HelpMarkdownProps = {
  text: string
  class?: string
  streaming?: boolean
}

export function buildLiveAnswerClassName(options: {
  streaming?: boolean
  separated?: boolean
}): string {
  const parts = ['help-app__live-answer']
  if (options.separated) {
    parts.push('help-app__live-answer--separated')
  }
  if (options.streaming) {
    parts.push('help-app__live-answer--streaming')
  }
  return parts.join(' ')
}

export function HelpMarkdown({ text, class: className, streaming }: HelpMarkdownProps) {
  const [renderText, setRenderText] = useState(text)
  const lastFlushAtRef = useRef(0)
  const pendingTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!streaming) {
      if (pendingTimerRef.current !== undefined) {
        window.clearTimeout(pendingTimerRef.current)
        pendingTimerRef.current = undefined
      }
      setRenderText(text)
      lastFlushAtRef.current = Date.now()
      return
    }

    const now = Date.now()
    const elapsed = now - lastFlushAtRef.current
    if (elapsed >= STREAMING_MARKDOWN_MIN_INTERVAL_MS) {
      if (pendingTimerRef.current !== undefined) {
        window.clearTimeout(pendingTimerRef.current)
        pendingTimerRef.current = undefined
      }
      lastFlushAtRef.current = now
      setRenderText(text)
      return
    }

    if (pendingTimerRef.current !== undefined) {
      window.clearTimeout(pendingTimerRef.current)
    }
    pendingTimerRef.current = window.setTimeout(() => {
      pendingTimerRef.current = undefined
      lastFlushAtRef.current = Date.now()
      setRenderText(text)
    }, STREAMING_MARKDOWN_MIN_INTERVAL_MS - elapsed)

    return () => {
      if (pendingTimerRef.current !== undefined) {
        window.clearTimeout(pendingTimerRef.current)
        pendingTimerRef.current = undefined
      }
    }
  }, [text, streaming])

  // 流式结束时用最终 text，避免末尾节流残留旧稿
  const source = streaming ? renderText : text

  const html = useMemo(() => {
    const rendered = renderHelpMarkdown(source)
    return streaming ? appendStreamCaret(rendered) : rendered
  }, [source, streaming])
  if (!html) {
    return undefined
  }

  return (
    <MarkdownHtmlView
      class={`help-app__markdown${className ? ` ${className}` : ''}`}
      html={html}
    />
  )
}

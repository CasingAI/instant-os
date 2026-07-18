import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useMemo } from 'preact/hooks'

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'hr',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
] as const

const ALLOWED_ATTR = ['href', 'title', 'align'] as const

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

function wrapMarkdownTables(html: string): string {
  return html.replace(/<table\b[\s\S]*?<\/table>/gi, (tableHtml) => {
    return `<div class="help-app__markdown-table-wrap">${tableHtml}</div>`
  })
}

function renderHelpMarkdown(text: string): string {
  if (!text.trim()) {
    return ''
  }

  const source = normalizeHelpMarkdownSource(text)
  const raw = marked.parse(source, {
    async: false,
    gfm: true,
    breaks: true,
  })
  const sanitized = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTR],
  })
  return wrapMarkdownTables(sanitized)
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

export function HelpMarkdown({ text, class: className, streaming }: HelpMarkdownProps) {
  const html = useMemo(() => {
    const rendered = renderHelpMarkdown(text)
    return streaming ? appendStreamCaret(rendered) : rendered
  }, [text, streaming])
  if (!html) {
    return undefined
  }

  return (
    <div
      class={`help-app__markdown${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

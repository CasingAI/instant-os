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

type HelpMarkdownProps = {
  text: string
  class?: string
}

export function HelpMarkdown({ text, class: className }: HelpMarkdownProps) {
  const html = useMemo(() => renderHelpMarkdown(text), [text])
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

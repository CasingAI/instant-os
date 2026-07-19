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

function normalizeTerminalMarkdownSource(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\u2028|\u2029/g, '\n').replace(/\\n/g, '\n')
}

function wrapMarkdownTables(html: string): string {
  return html.replace(/<table\b[\s\S]*?<\/table>/gi, (tableHtml) => {
    return `<div class="terminal-panel__markdown-table-wrap">${tableHtml}</div>`
  })
}

function renderTerminalMarkdown(text: string): string {
  if (!text.trim()) {
    return ''
  }

  const raw = marked.parse(normalizeTerminalMarkdownSource(text), {
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

type TerminalMarkdownProps = {
  text: string
  class?: string
}

export function TerminalMarkdown({ text, class: className }: TerminalMarkdownProps) {
  const html = useMemo(() => renderTerminalMarkdown(text), [text])
  if (!html) {
    return undefined
  }

  return (
    <div
      class={`terminal-panel__markdown${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

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

function wrapMarkdownTables(html: string): string {
  return html.replace(/<table\b[\s\S]*?<\/table>/gi, (tableHtml) => {
    return `<div class="vscode__markdown-table-wrap">${tableHtml}</div>`
  })
}

function renderVscodeMarkdown(text: string): string {
  if (!text.trim()) {
    return ''
  }

  const raw = marked.parse(text, {
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

type VscodeMarkdownPreviewProps = {
  text: string
}

export function VscodeMarkdownPreview({ text }: VscodeMarkdownPreviewProps) {
  const html = useMemo(() => renderVscodeMarkdown(text), [text])

  if (!html) {
    return <div class="vscode__markdown-preview vscode__markdown-preview--empty" />
  }

  return (
    <div
      class="vscode__markdown-preview"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useMemo } from 'preact/hooks'
import './markdown-document-preview.css'

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
    return `<div class="markdown-document-preview__table-wrap">${tableHtml}</div>`
  })
}

/** 将 Markdown 源解析为消毒后的文档 HTML（拟物纸面预览用） */
export function renderMarkdownDocumentHtml(text: string): string {
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

export type MarkdownDocumentPreviewProps = {
  text: string
  class?: string
}

export function MarkdownDocumentPreview({ text, class: className }: MarkdownDocumentPreviewProps) {
  const html = useMemo(() => renderMarkdownDocumentHtml(text), [text])
  const rootClass = [
    'markdown-document-preview',
    !html ? 'markdown-document-preview--empty' : undefined,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  if (!html) {
    return <div class={rootClass} />
  }

  return <div class={rootClass} dangerouslySetInnerHTML={{ __html: html }} />
}

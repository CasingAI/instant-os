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

marked.setOptions({
  gfm: true,
  breaks: true,
})

function renderIcodeChatMarkdown(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) {
    return ''
  }

  const raw = marked.parse(trimmed, { async: false })
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTR],
  })
}

type IcodeChatMarkdownProps = {
  text: string
  class?: string
}

export function IcodeChatMarkdown({ text, class: className }: IcodeChatMarkdownProps) {
  const html = useMemo(() => renderIcodeChatMarkdown(text), [text])
  if (!html) {
    return undefined
  }

  return (
    <div
      class={`icode__chat-markdown${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

import { useMemo } from 'preact/hooks'
import { renderMarkdownHtml } from '../../markdown/render-markdown-html.ts'

function renderIcodeChatMarkdown(text: string): string {
  return renderMarkdownHtml(text)
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

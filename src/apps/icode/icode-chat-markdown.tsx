import { useMemo } from 'preact/hooks'
import { MarkdownHtmlView } from '../../markdown/markdown-html-view.tsx'
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
    <MarkdownHtmlView
      class={`icode__chat-markdown${className ? ` ${className}` : ''}`}
      html={html}
    />
  )
}

import { useMemo } from 'preact/hooks'
import { renderMarkdownHtml } from '../markdown/render-markdown-html.ts'

function normalizeTerminalMarkdownSource(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\u2028|\u2029/g, '\n').replace(/\\n/g, '\n')
}

function renderTerminalMarkdown(text: string): string {
  return renderMarkdownHtml(text, {
    normalize: normalizeTerminalMarkdownSource,
    tableWrapClass: 'terminal-panel__markdown-table-wrap',
  })
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

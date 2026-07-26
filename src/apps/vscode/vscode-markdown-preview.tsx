import { useMemo } from 'preact/hooks'
import { renderMarkdownHtml } from '../../markdown/render-markdown-html.ts'

function renderVscodeMarkdown(text: string): string {
  return renderMarkdownHtml(text, {
    tableWrapClass: 'vscode__markdown-table-wrap',
  })
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

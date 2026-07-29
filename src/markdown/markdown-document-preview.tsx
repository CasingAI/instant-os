import { useMemo } from 'preact/hooks'
import { MarkdownHtmlView } from './markdown-html-view.tsx'
import { renderMarkdownHtml } from './render-markdown-html.ts'
import './markdown-document-preview.css'

/** 将 Markdown 源解析为消毒后的文档 HTML（拟物纸面预览用） */
export function renderMarkdownDocumentHtml(text: string): string {
  return renderMarkdownHtml(text, {
    tableWrapClass: 'markdown-document-preview__table-wrap',
  })
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

  return <MarkdownHtmlView class={rootClass} html={html} />
}

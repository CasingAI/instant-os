import { openSystemUrl } from '../os/open-system-url.ts'
import { handleMarkdownLinkClick } from './markdown-link.ts'

type MarkdownHtmlViewProps = {
  html: string
  class?: string
}

/** 渲染消毒后的 Markdown HTML，并通过系统统一入口在内部浏览器打开外链 */
export function MarkdownHtmlView({ html, class: className }: MarkdownHtmlViewProps) {
  const onClickCapture = (event: MouseEvent) => {
    handleMarkdownLinkClick(event, openSystemUrl)
  }

  return (
    <div
      class={className}
      dangerouslySetInnerHTML={{ __html: html }}
      onClickCapture={onClickCapture}
    />
  )
}

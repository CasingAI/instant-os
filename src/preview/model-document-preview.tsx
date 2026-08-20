import { useEffect, useRef } from 'preact/hooks'
import { buildScene3dModelUrlPreviewHtml } from '../assets/3d/build-scene3d-preview-html.ts'
import { injectScene3dBridge } from '../assets/3d/inject-scene3d-bridge.ts'
import {
  ensureIframeBlankDocument,
  writeHtmlToIframe,
} from '../assets/3d/write-html-to-iframe.ts'
import './model-document-preview.css'

export type ModelDocumentPreviewProps = {
  modelUrl: string
  title?: string
  class?: string
}

export function ModelDocumentPreview({
  modelUrl,
  title = '3D 模型预览',
  class: className,
}: ModelDocumentPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe || !modelUrl) return

    ensureIframeBlankDocument(iframe)
    const html = injectScene3dBridge(buildScene3dModelUrlPreviewHtml(modelUrl))
    writeHtmlToIframe(iframe, html)

    return () => {
      ensureIframeBlankDocument(iframe)
      writeHtmlToIframe(iframe, '<!DOCTYPE html><html><body></body></html>')
    }
  }, [modelUrl])

  const rootClass = ['model-document-preview', className].filter(Boolean).join(' ')

  if (!modelUrl) {
    return (
      <div class={`${rootClass} model-document-preview--error`}>
        <p class="model-document-preview__error-title">无法显示模型</p>
        <p class="model-document-preview__error-hint">缺少可加载的模型地址。</p>
      </div>
    )
  }

  return (
    <div class={rootClass}>
      <iframe
        ref={iframeRef}
        class="model-document-preview__frame"
        title={title}
        sandbox="allow-scripts allow-same-origin"
        src="about:blank"
      />
    </div>
  )
}

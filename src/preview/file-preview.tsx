import { MarkdownDocumentPreview } from '../markdown/markdown-public.ts'
import { DocxDocumentPreview, type DocxZoomMode } from './docx-document-preview.tsx'
import { ImageDocumentPreview } from './image-document-preview.tsx'
import { ModelDocumentPreview } from './model-document-preview.tsx'
import type { PreviewKind } from './preview-kind.ts'
import { TextDocumentPreview } from './text-document-preview.tsx'
import './file-preview.css'

export type MarkdownViewMode = 'render' | 'source'

export type FilePreviewProps = {
  kind: PreviewKind
  /** Markdown / 纯文本正文 */
  text?: string
  /** 图片 object URL / data URL */
  imageSrc?: string
  imageAlt?: string
  /** 3D 模型可加载 URL（catalog 或 blob:） */
  modelUrl?: string
  /** Word 文档二进制 */
  docxBlob?: Blob
  docxZoomMode?: DocxZoomMode
  docxManualScale?: number
  onDocxEffectiveScaleChange?: (scale: number) => void
  /** 文件名：Monaco 语言推断 */
  fileName?: string
  /** VFS 绝对路径：Monaco modelPath */
  filePath?: string
  /** 多标签场景下控制 Monaco active */
  active?: boolean
  /** Markdown：渲染 HTML 或 Monaco 源码；默认 render */
  markdownViewMode?: MarkdownViewMode
  class?: string
}

export function FilePreview({
  kind,
  text,
  imageSrc,
  imageAlt,
  modelUrl,
  docxBlob,
  docxZoomMode,
  docxManualScale,
  onDocxEffectiveScaleChange,
  fileName,
  filePath,
  active = true,
  markdownViewMode = 'render',
  class: className,
}: FilePreviewProps) {
  const rootClass = ['file-preview', className].filter(Boolean).join(' ')

  if (kind === 'markdown') {
    if (markdownViewMode === 'source') {
      return (
        <div class={`${rootClass} file-preview--text`}>
          <TextDocumentPreview
            text={text ?? ''}
            fileName={fileName}
            filePath={filePath}
            language="markdown"
            active={active}
          />
        </div>
      )
    }
    return (
      <div class={rootClass}>
        <MarkdownDocumentPreview text={text ?? ''} />
      </div>
    )
  }

  if (kind === 'text') {
    return (
      <div class={`${rootClass} file-preview--text`}>
        <TextDocumentPreview
          text={text ?? ''}
          fileName={fileName}
          filePath={filePath}
          active={active}
        />
      </div>
    )
  }

  if (kind === 'image') {
    return (
      <div class={`${rootClass} file-preview--image`}>
        <ImageDocumentPreview src={imageSrc ?? ''} alt={imageAlt} />
      </div>
    )
  }

  if (kind === 'model3d') {
    return (
      <div class={`${rootClass} file-preview--model3d`}>
        <ModelDocumentPreview modelUrl={modelUrl ?? ''} title={imageAlt ?? '3D 模型预览'} />
      </div>
    )
  }

  if (kind === 'docx') {
    return (
      <div class={`${rootClass} file-preview--docx`}>
        <DocxDocumentPreview
          blob={docxBlob}
          zoomMode={docxZoomMode}
          manualScale={docxManualScale}
          onEffectiveScaleChange={onDocxEffectiveScaleChange}
        />
      </div>
    )
  }

  return (
    <div class={`${rootClass} file-preview--unsupported`}>
      <p class="file-preview__unsupported-title">暂不支持此格式</p>
      <p class="file-preview__unsupported-hint">
        目前可预览 Markdown、JSON / HTML / 源码等文本、Word 文档（.docx）、常见图片，以及 glTF /
        GLB 三维模型。
      </p>
    </div>
  )
}

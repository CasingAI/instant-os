import { useEffect, useState } from 'preact/hooks'
import './image-document-preview.css'

export type ImageDocumentPreviewProps = {
  /** object URL 或 data URL */
  src: string
  alt?: string
  class?: string
}

export function ImageDocumentPreview({
  src,
  alt = '图片预览',
  class: className,
}: ImageDocumentPreviewProps) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  const rootClass = ['image-document-preview', className].filter(Boolean).join(' ')

  if (!src || failed) {
    return (
      <div class={`${rootClass} image-document-preview--error`}>
        <p class="image-document-preview__error-title">无法显示图片</p>
        <p class="image-document-preview__error-hint">文件可能已损坏，或格式不受支持。</p>
      </div>
    )
  }

  return (
    <div class={rootClass}>
      <img
        class="image-document-preview__img"
        src={src}
        alt={alt}
        draggable={false}
        onError={() => setFailed(true)}
      />
    </div>
  )
}

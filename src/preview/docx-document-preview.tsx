import { renderAsync } from 'docx-preview'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { paginateDocxSections } from './paginate-docx-sections.ts'
import './docx-document-preview.css'

export type DocxZoomMode = 'fit-width' | 'manual'

export const DOCX_ZOOM_MIN = 0.25
export const DOCX_ZOOM_MAX = 2
export const DOCX_ZOOM_STEP = 0.1

export type DocxDocumentPreviewProps = {
  blob?: Blob
  zoomMode?: DocxZoomMode
  manualScale?: number
  onEffectiveScaleChange?: (scale: number) => void
  class?: string
}

function clearContainer(container: HTMLElement | null): void {
  if (!container) return
  container.replaceChildren()
}

function clampDocxScale(scale: number): number {
  return Math.min(DOCX_ZOOM_MAX, Math.max(DOCX_ZOOM_MIN, scale))
}

export function DocxDocumentPreview({
  blob,
  zoomMode = 'fit-width',
  manualScale = 1,
  onEffectiveScaleChange,
  class: className,
}: DocxDocumentPreviewProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const layoutRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [renderEpoch, setRenderEpoch] = useState(0)

  const applyScale = useCallback(() => {
    const viewport = viewportRef.current
    const layoutEl = layoutRef.current
    const scaleEl = scaleRef.current
    const wrapper = bodyRef.current?.querySelector('.docx-wrapper') as HTMLElement | null
    if (!viewport || !layoutEl || !scaleEl || !wrapper) return

    const contentWidth = wrapper.offsetWidth
    const contentHeight = wrapper.offsetHeight
    if (contentWidth <= 0 || contentHeight <= 0) return

    const horizontalPadding = 32
    const availableWidth = Math.max(1, viewport.clientWidth - horizontalPadding)

    let scale: number
    if (zoomMode === 'fit-width') {
      scale = Math.min(1, availableWidth / contentWidth)
    } else {
      scale = clampDocxScale(manualScale)
    }

    scaleEl.style.width = `${contentWidth}px`
    scaleEl.style.height = `${contentHeight}px`
    scaleEl.style.transform = `scale(${scale})`
    layoutEl.style.width = `${contentWidth * scale}px`
    layoutEl.style.height = `${contentHeight * scale}px`
    onEffectiveScaleChange?.(scale)
  }, [manualScale, onEffectiveScaleChange, zoomMode])

  useEffect(() => {
    setFailed(false)
    clearContainer(styleRef.current)
    clearContainer(bodyRef.current)

    if (!blob) {
      setLoading(false)
      return
    }

    const styleContainer = styleRef.current
    const bodyContainer = bodyRef.current
    if (!styleContainer || !bodyContainer) return

    let cancelled = false
    setLoading(true)

    void blob
      .arrayBuffer()
      .then((buffer) => {
        if (cancelled) return
        return renderAsync(buffer, bodyContainer, styleContainer, {
          className: 'docx',
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          renderAltChunks: false,
        })
      })
      .then(() => {
        if (cancelled) return
        paginateDocxSections(bodyContainer)
        setLoading(false)
        setRenderEpoch((value) => value + 1)
      })
      .catch(() => {
        if (cancelled) return
        setLoading(false)
        setFailed(true)
        clearContainer(styleContainer)
        clearContainer(bodyContainer)
      })

    return () => {
      cancelled = true
      clearContainer(styleContainer)
      clearContainer(bodyContainer)
    }
  }, [blob])

  useEffect(() => {
    if (loading || failed) return

    applyScale()

    const viewport = viewportRef.current
    if (!viewport) return

    const observer = new ResizeObserver(() => {
      applyScale()
    })
    observer.observe(viewport)

    const wrapper = bodyRef.current?.querySelector('.docx-wrapper')
    if (wrapper) observer.observe(wrapper)

    return () => observer.disconnect()
  }, [applyScale, failed, loading, renderEpoch])

  const rootClass = ['docx-document-preview', className].filter(Boolean).join(' ')

  if (!blob || failed) {
    return (
      <div class={`${rootClass} docx-document-preview--error`}>
        <p class="docx-document-preview__error-title">无法显示 Word 文档</p>
        <p class="docx-document-preview__error-hint">文件可能已损坏，或格式不受支持。</p>
      </div>
    )
  }

  return (
    <div class={rootClass}>
      {loading ? <div class="docx-document-preview__loading">正在渲染…</div> : undefined}
      <div ref={viewportRef} class="docx-document-preview__viewport">
        <div ref={layoutRef} class="docx-document-preview__layout">
          <div ref={scaleRef} class="docx-document-preview__scale">
            <div ref={styleRef} class="docx-document-preview__styles" aria-hidden="true" />
            <div ref={bodyRef} class="docx-document-preview__body" />
          </div>
        </div>
      </div>
    </div>
  )
}

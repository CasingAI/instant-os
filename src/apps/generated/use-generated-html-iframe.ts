import { useCallback, useEffect, useRef } from 'preact/hooks'
import { ensureIframeBlankDocument, writeHtmlToIframe } from '../../assets/3d/write-html-to-iframe.ts'

const MIN_FRAME_SIZE_PX = 1

/** 与桌面已安装应用共用：about:blank + doc.write，等 iframe 有尺寸后再写入，避免 srcDoc 与 0×0 首帧。 */
export function useGeneratedHtmlIframe(
  iframeRef: { current: HTMLIFrameElement | null },
  preparedHtml: string | undefined,
  remountKey: string,
  onReady?: () => void,
) {
  const writtenHtmlRef = useRef<string | undefined>()
  const pendingWriteRef = useRef(false)

  const tryWrite = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe || !preparedHtml?.trim()) {
      return false
    }

    const { width, height } = iframe.getBoundingClientRect()
    if (width < MIN_FRAME_SIZE_PX || height < MIN_FRAME_SIZE_PX) {
      pendingWriteRef.current = true
      return false
    }

    if (writtenHtmlRef.current === preparedHtml) {
      return true
    }

    if (!writeHtmlToIframe(iframe, preparedHtml)) {
      pendingWriteRef.current = true
      return false
    }

    writtenHtmlRef.current = preparedHtml
    pendingWriteRef.current = false
    onReady?.()
    return true
  }, [iframeRef, onReady, preparedHtml])

  useEffect(() => {
    writtenHtmlRef.current = undefined
    pendingWriteRef.current = Boolean(preparedHtml?.trim())
    ensureIframeBlankDocument(iframeRef.current)
    tryWrite()
  }, [iframeRef, preparedHtml, remountKey, tryWrite])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) {
      return
    }

    const observer = new ResizeObserver(() => {
      if (pendingWriteRef.current || writtenHtmlRef.current !== preparedHtml) {
        tryWrite()
      }
    })
    observer.observe(iframe)

    return () => observer.disconnect()
  }, [iframeRef, preparedHtml, remountKey, tryWrite])

  const handleLoad = useCallback(() => {
    tryWrite()
  }, [tryWrite])

  return {
    iframeProps: {
      src: 'about:blank',
      sandbox: 'allow-scripts allow-same-origin',
      onLoad: handleLoad,
    } as const,
    tryWrite,
  }
}

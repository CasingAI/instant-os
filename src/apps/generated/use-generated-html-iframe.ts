import { useCallback, useEffect, useRef } from 'preact/hooks'
import { ensureIframeBlankDocument, writeHtmlToIframe } from '../../assets/3d/write-html-to-iframe.ts'

const MIN_FRAME_SIZE_PX = 1

export type UseGeneratedHtmlIframeOptions = {
  /**
   * 实验性进程隔离：sandbox 不含 allow-same-origin，经 Blob URL 导航加载 HTML。
   * Chromium 127+ 桌面端可将 iframe 拆至独立 Renderer 进程，减轻子应用主线程死循环拖死宿主。
   */
  processIsolated?: boolean
  onReady?: () => void
}

/** 与桌面已安装应用共用：默认 about:blank + doc.write；隔离模式用 Blob URL 导航。 */
export function useGeneratedHtmlIframe(
  iframeRef: { current: HTMLIFrameElement | null },
  preparedHtml: string | undefined,
  remountKey: string,
  options: UseGeneratedHtmlIframeOptions = {},
) {
  const { processIsolated = false, onReady } = options
  const writtenHtmlRef = useRef<string | undefined>()
  const pendingWriteRef = useRef(false)
  const blobUrlRef = useRef<string | undefined>()

  const revokeBlobUrl = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = undefined
    }
  }, [])

  const tryWriteSameOrigin = useCallback(() => {
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

  const tryLoadIsolated = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe || !preparedHtml?.trim()) {
      return false
    }

    const { width, height } = iframe.getBoundingClientRect()
    if (width < MIN_FRAME_SIZE_PX || height < MIN_FRAME_SIZE_PX) {
      pendingWriteRef.current = true
      return false
    }

    if (writtenHtmlRef.current === preparedHtml && blobUrlRef.current) {
      return true
    }

    revokeBlobUrl()
    const blobUrl = URL.createObjectURL(new Blob([preparedHtml], { type: 'text/html' }))
    blobUrlRef.current = blobUrl
    writtenHtmlRef.current = preparedHtml
    pendingWriteRef.current = false
    iframe.src = blobUrl
    return true
  }, [iframeRef, preparedHtml, revokeBlobUrl])

  const tryLoad = processIsolated ? tryLoadIsolated : tryWriteSameOrigin

  useEffect(() => {
    writtenHtmlRef.current = undefined
    pendingWriteRef.current = Boolean(preparedHtml?.trim())
    revokeBlobUrl()

    const iframe = iframeRef.current
    if (processIsolated) {
      if (iframe) {
        iframe.removeAttribute('src')
      }
    } else {
      ensureIframeBlankDocument(iframe)
    }

    tryLoad()
  }, [iframeRef, preparedHtml, processIsolated, remountKey, revokeBlobUrl, tryLoad])

  useEffect(() => {
    return () => {
      revokeBlobUrl()
    }
  }, [remountKey, revokeBlobUrl])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) {
      return
    }

    const observer = new ResizeObserver(() => {
      if (pendingWriteRef.current || writtenHtmlRef.current !== preparedHtml) {
        tryLoad()
      }
    })
    observer.observe(iframe)

    return () => observer.disconnect()
  }, [iframeRef, preparedHtml, remountKey, tryLoad])

  const handleLoadSameOrigin = useCallback(() => {
    tryWriteSameOrigin()
  }, [tryWriteSameOrigin])

  const handleLoadIsolated = useCallback(() => {
    if (!processIsolated || !preparedHtml?.trim()) {
      return
    }

    if (writtenHtmlRef.current === preparedHtml) {
      onReady?.()
    }
  }, [onReady, preparedHtml, processIsolated])

  return {
    iframeProps: processIsolated
      ? ({
          sandbox: 'allow-scripts allow-forms',
          onLoad: handleLoadIsolated,
        } as const)
      : ({
          src: 'about:blank',
          sandbox: 'allow-scripts allow-same-origin',
          onLoad: handleLoadSameOrigin,
        } as const),
    tryLoad,
  }
}

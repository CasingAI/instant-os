import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import {
  attachSafariFrameNavigation,
  type SafariFrameContextMenuRequest,
} from './attach-safari-frame-navigation.ts'
import { isEmbeddedAppOrigin } from './resolve-browser-navigation-url.ts'
import { STREAMING_PLACEHOLDER_HTML } from './extract-partial-html.ts'
import { prepareHtmlForSafariFrame } from './prepare-html-for-frame.ts'

const IFRAME_WRITE_DEBOUNCE_MS = 180

type SafariPageFrameProps = {
  frameKey: string
  pageUrl: string
  html: string
  streaming: boolean
  title: string
  onNavigate: (url: string) => void
  onFocus?: () => void
  onContextMenu?: (request: SafariFrameContextMenuRequest) => void
}

export function SafariPageFrame({
  frameKey,
  pageUrl,
  html,
  streaming,
  title,
  onNavigate,
  onFocus,
  onContextMenu,
}: SafariPageFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [emojiFontEpoch, setEmojiFontEpoch] = useState(0)
  const pendingHtmlRef = useRef('')
  const timerRef = useRef<number | undefined>(undefined)
  const lastWrittenRef = useRef('')
  const detachNavigationRef = useRef<(() => void) | undefined>(undefined)
  const onNavigateRef = useRef(onNavigate)
  const onFocusRef = useRef(onFocus)
  const onContextMenuRef = useRef(onContextMenu)
  const internalWriteRef = useRef(false)

  onNavigateRef.current = onNavigate
  onFocusRef.current = onFocus
  onContextMenuRef.current = onContextMenu

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      setEmojiFontEpoch((epoch) => epoch + 1)
    })

    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-emoji-font-mode', 'data-emoji-font-bundled'],
    })

    return () => observer.disconnect()
  }, [])

  const pageUrlRef = useRef(pageUrl)
  pageUrlRef.current = pageUrl

  const bindNavigation = useCallback((doc: Document) => {
    detachNavigationRef.current?.()
    detachNavigationRef.current = attachSafariFrameNavigation(
      doc,
      () => pageUrlRef.current,
      (url) => {
        onNavigateRef.current(url)
      },
      () => onFocusRef.current?.(),
      (request) => {
        const iframe = iframeRef.current
        const parent = iframe?.parentElement
        if (!parent) {
          return
        }

        const iframeRect = iframe.getBoundingClientRect()
        const parentRect = parent.getBoundingClientRect()
        onContextMenuRef.current?.({
          x: iframeRect.left - parentRect.left + request.x,
          y: iframeRect.top - parentRect.top + request.y,
          target: request.target,
        })
      },
    )
  }, [])

  const writeToIframe = useCallback(
    (source: string, force = false) => {
      const iframe = iframeRef.current
      if (!iframe) {
        return
      }

      const content = source
        ? prepareHtmlForSafariFrame(source, pageUrlRef.current)
        : STREAMING_PLACEHOLDER_HTML

      if (!force && content === lastWrittenRef.current) {
        return
      }

      const doc = iframe.contentDocument ?? iframe.contentWindow?.document
      if (!doc) {
        return
      }

      internalWriteRef.current = true
      lastWrittenRef.current = content
      doc.open()
      doc.write(content)
      doc.close()

      const activeDoc = iframe.contentDocument ?? iframe.contentWindow?.document
      if (activeDoc) {
        bindNavigation(activeDoc)
      }

      window.setTimeout(() => {
        internalWriteRef.current = false
      }, 0)
    },
    [bindNavigation],
  )

  const restoreIframeContent = useCallback(() => {
    if (!lastWrittenRef.current) {
      return
    }
    writeToIframe(lastWrittenRef.current, true)
  }, [writeToIframe])

  const scheduleWrite = (source: string) => {
    pendingHtmlRef.current = source

    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current)
    }

    timerRef.current = window.setTimeout(() => {
      writeToIframe(pendingHtmlRef.current)
    }, IFRAME_WRITE_DEBOUNCE_MS)
  }

  useLayoutEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) {
      return
    }

    const onFrameLoad = () => {
      if (internalWriteRef.current) {
        return
      }

      restoreIframeContent()
    }

    iframe.addEventListener('load', onFrameLoad)
    return () => iframe.removeEventListener('load', onFrameLoad)
  }, [frameKey, restoreIframeContent])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) {
      return
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) {
        return
      }

      const data = event.data as { type?: string; url?: string } | undefined
      if (!data || data.type !== 'instant-os-navigate' || typeof data.url !== 'string') {
        return
      }

      if (isEmbeddedAppOrigin(data.url)) {
        return
      }

      onNavigateRef.current(data.url)
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [frameKey])

  useLayoutEffect(() => {
    lastWrittenRef.current = ''
    writeToIframe(html, true)

    return () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current)
      }
      detachNavigationRef.current?.()
      detachNavigationRef.current = undefined
    }
  }, [frameKey, writeToIframe])

  useLayoutEffect(() => {
    if (!html) {
      return
    }

    scheduleWrite(html)

    return () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [html, writeToIframe])

  useLayoutEffect(() => {
    if (!html || !lastWrittenRef.current) {
      return
    }

    writeToIframe(html, true)
  }, [emojiFontEpoch, html, writeToIframe])

  useLayoutEffect(() => {
    if (streaming || !html) {
      return
    }

    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current)
    }

    writeToIframe(html, true)
  }, [streaming, html, writeToIframe])

  return (
    <iframe
      ref={iframeRef}
      class={`safari__frame ${streaming ? 'safari__frame--streaming' : ''}`}
      title={title}
      sandbox="allow-scripts allow-same-origin allow-forms"
      onContextMenu={(event) => event.preventDefault()}
    />
  )
}

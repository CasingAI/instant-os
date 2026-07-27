import { forwardRef, useEffect, useImperativeHandle, useRef } from 'preact/compat'
import { CHROMO_VIEWER_URL } from './chromo-config.ts'
import {
  createChromoBridge,
  type ChromoBridge,
  type ChromoBridgeHandlers,
  type ChromoConsoleReadResult,
  type ChromoErrorPayload,
  type ChromoLoadFailedPayload,
  type ChromoNavigatedPayload,
  type ChromoRpcOptions,
} from './chromo-bridge.ts'

export type ChromoViewerHandle = {
  navigate: (url: string) => void
  back: () => void
  forward: () => void
  reload: () => void
  ping: () => void
  evalInPage: (code: string, options?: ChromoRpcOptions) => Promise<unknown>
  readConsole: (
    options?: { after?: string; limit?: number } & ChromoRpcOptions,
  ) => Promise<ChromoConsoleReadResult>
  isReady: () => boolean
}

type ChromoViewerFrameProps = {
  active: boolean
  onReady?: ChromoBridgeHandlers['onReady']
  onNavigated?: (payload: ChromoNavigatedPayload) => void
  onNavigating?: ChromoBridgeHandlers['onNavigating']
  onLoading?: ChromoBridgeHandlers['onLoading']
  onLoadFailed?: (payload: ChromoLoadFailedPayload) => void
  onConsoleUpdated?: ChromoBridgeHandlers['onConsoleUpdated']
  onError?: (payload: ChromoErrorPayload) => void
}

export const ChromoViewerFrame = forwardRef<ChromoViewerHandle, ChromoViewerFrameProps>(
  function ChromoViewerFrame(
    {
      active,
      onReady,
      onNavigated,
      onNavigating,
      onLoading,
      onLoadFailed,
      onConsoleUpdated,
      onError,
    },
    ref,
  ) {
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const bridgeRef = useRef<ChromoBridge | null>(null)

    const onReadyRef = useRef(onReady)
    const onNavigatedRef = useRef(onNavigated)
    const onNavigatingRef = useRef(onNavigating)
    const onLoadingRef = useRef(onLoading)
    const onLoadFailedRef = useRef(onLoadFailed)
    const onConsoleUpdatedRef = useRef(onConsoleUpdated)
    const onErrorRef = useRef(onError)

    onReadyRef.current = onReady
    onNavigatedRef.current = onNavigated
    onNavigatingRef.current = onNavigating
    onLoadingRef.current = onLoading
    onLoadFailedRef.current = onLoadFailed
    onConsoleUpdatedRef.current = onConsoleUpdated
    onErrorRef.current = onError

    useEffect(() => {
      const iframe = iframeRef.current
      if (!iframe) {
        return
      }

      const bridge = createChromoBridge(iframe, {
        onReady: (payload) => onReadyRef.current?.(payload),
        onNavigated: (payload) => onNavigatedRef.current?.(payload),
        onNavigating: (payload) => onNavigatingRef.current?.(payload),
        onLoading: (payload) => onLoadingRef.current?.(payload),
        onLoadFailed: (payload) => onLoadFailedRef.current?.(payload),
        onConsoleUpdated: (payload) => onConsoleUpdatedRef.current?.(payload),
        onError: (payload) => onErrorRef.current?.(payload),
      })
      bridgeRef.current = bridge

      return () => {
        bridge.destroy()
        bridgeRef.current = null
      }
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        navigate(url: string) {
          bridgeRef.current?.navigate(url)
        },
        back() {
          bridgeRef.current?.back()
        },
        forward() {
          bridgeRef.current?.forward()
        },
        reload() {
          bridgeRef.current?.reload()
        },
        ping() {
          bridgeRef.current?.ping()
        },
        evalInPage(code: string, options?: ChromoRpcOptions) {
          return (
            bridgeRef.current?.evalInPage(code, options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        readConsole(options) {
          return (
            bridgeRef.current?.readConsole(options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        isReady() {
          return bridgeRef.current?.isReady() ?? false
        },
      }),
      [],
    )

    return (
      <iframe
        ref={iframeRef}
        class={['chromo__viewer', active ? '' : 'chromo__viewer--hidden'].filter(Boolean).join(' ')}
        src={CHROMO_VIEWER_URL}
        title="Chromo WebView"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      />
    )
  },
)

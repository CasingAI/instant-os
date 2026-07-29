import { forwardRef, useEffect, useImperativeHandle, useRef } from 'preact/compat'
import { CHROMO_VIEWER_URL } from './chromo-config.ts'
import {
  createChromoBridge,
  type ChromoBridge,
  type ChromoBridgeHandlers,
  type ChromoClickPayload,
  type ChromoConsoleReadResult,
  type ChromoErrorPayload,
  type ChromoHistoryPayload,
  type ChromoLoadFailedPayload,
  type ChromoLocationPayload,
  type ChromoNavigatedPayload,
  type ChromoNetworkHotProbeResult,
  type ChromoNetworkReadResult,
  type ChromoNetworkBodyReadResult,
  type ChromoNetworkBodyReadLinesOptions,
  type ChromoNetworkBodyReadLinesResult,
  type ChromoNetworkOptions,
  type ChromoNavigateOptions,
  type ChromoReadyPayload,
  type ChromoRpcOptions,
  type ChromoScreenshotOptions,
  type ChromoScreenshotResult,
} from './chromo-bridge.ts'

export type ChromoViewerHandle = {
  navigate: (url: string, options?: ChromoNavigateOptions) => void
  back: () => void
  forward: () => void
  reload: () => void
  /** Fatal recover: SW update + viewer reload, or remount iframe if bridge gone. */
  recoverFromFatal: () => void
  stop: () => void
  ping: () => void
  evalInPage: (code: string, options?: ChromoRpcOptions) => Promise<unknown>
  readConsole: (
    options?: { after?: string; limit?: number } & ChromoRpcOptions,
  ) => Promise<ChromoConsoleReadResult>
  readNetwork: (
    options?: { after?: string; limit?: number } & ChromoRpcOptions,
  ) => Promise<ChromoNetworkReadResult>
  readNetworkBody: (
    entryId: string,
    options?: ChromoRpcOptions,
  ) => Promise<ChromoNetworkBodyReadResult>
  readNetworkBodyLines: (
    entryId: string,
    options?: ChromoNetworkBodyReadLinesOptions,
  ) => Promise<ChromoNetworkBodyReadLinesResult>
  probeNetworkHot: (
    method: string,
    url: string,
    options?: ChromoRpcOptions,
  ) => Promise<ChromoNetworkHotProbeResult>
  setNetworkOptions: (options: ChromoNetworkOptions) => void
  setDebugPanelEnabled: (enabled: boolean) => void
  screenshot: (options?: ChromoScreenshotOptions) => Promise<ChromoScreenshotResult>
  clearState: (options?: ChromoRpcOptions) => Promise<void>
  listCookies: ChromoBridge['listCookies']
  deleteCookie: ChromoBridge['deleteCookie']
  clearCookies: ChromoBridge['clearCookies']
  clearAllCookies: ChromoBridge['clearAllCookies']
  listStorage: ChromoBridge['listStorage']
  setStorageItem: ChromoBridge['setStorageItem']
  removeStorageItem: ChromoBridge['removeStorageItem']
  clearStorage: ChromoBridge['clearStorage']
  getSwInfo: ChromoBridge['getSwInfo']
  getNetworkCacheStats: ChromoBridge['getNetworkCacheStats']
  listNetworkCache: ChromoBridge['listNetworkCache']
  clearNetworkCache: ChromoBridge['clearNetworkCache']
  clearAllNetworkCache: ChromoBridge['clearAllNetworkCache']
  listIdb: ChromoBridge['listIdb']
  deleteIdb: ChromoBridge['deleteIdb']
  listIdbStores: ChromoBridge['listIdbStores']
  getIdbAll: ChromoBridge['getIdbAll']
  listSiteCaches: ChromoBridge['listSiteCaches']
  listSiteCacheKeys: ChromoBridge['listSiteCacheKeys']
  deleteSiteCache: ChromoBridge['deleteSiteCache']
  isReady: () => boolean
}

type ChromoViewerFrameProps = {
  /** Parent-tab id for Disable cache isolation only (not a Worker session). */
  devtoolsId: string
  /** 建 tab 时若已有目标 URL，在 bridge 创建时入队，等 VC_READY 自动导航 */
  initialUrl?: string
  active: boolean
  disableNetworkCache?: boolean
  onReady?: (payload: ChromoReadyPayload) => void
  onNavigated?: (payload: ChromoNavigatedPayload) => void
  onNavigating?: ChromoBridgeHandlers['onNavigating']
  onLoading?: ChromoBridgeHandlers['onLoading']
  onLoadFailed?: (payload: ChromoLoadFailedPayload) => void
  onConsoleUpdated?: ChromoBridgeHandlers['onConsoleUpdated']
  onNetworkUpdated?: ChromoBridgeHandlers['onNetworkUpdated']
  onError?: (payload: ChromoErrorPayload) => void
  onClick?: (payload: ChromoClickPayload) => void
  onLocation?: (payload: ChromoLocationPayload) => void
  onHistory?: (payload: ChromoHistoryPayload) => void
}

export const ChromoViewerFrame = forwardRef<ChromoViewerHandle, ChromoViewerFrameProps>(
  function ChromoViewerFrame(
    {
      devtoolsId,
      initialUrl,
      active,
      disableNetworkCache = false,
      onReady,
      onNavigated,
      onNavigating,
      onLoading,
      onLoadFailed,
      onConsoleUpdated,
      onNetworkUpdated,
      onError,
      onClick,
      onLocation,
      onHistory,
    },
    ref,
  ) {
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const bridgeRef = useRef<ChromoBridge | null>(null)
    const initialUrlRef = useRef(initialUrl)
    const disableNetworkCacheRef = useRef(disableNetworkCache)

    disableNetworkCacheRef.current = disableNetworkCache

    const onReadyRef = useRef(onReady)
    const onNavigatedRef = useRef(onNavigated)
    const onNavigatingRef = useRef(onNavigating)
    const onLoadingRef = useRef(onLoading)
    const onLoadFailedRef = useRef(onLoadFailed)
    const onConsoleUpdatedRef = useRef(onConsoleUpdated)
    const onNetworkUpdatedRef = useRef(onNetworkUpdated)
    const onErrorRef = useRef(onError)
    const onClickRef = useRef(onClick)
    const onLocationRef = useRef(onLocation)
    const onHistoryRef = useRef(onHistory)

    onReadyRef.current = onReady
    onNavigatedRef.current = onNavigated
    onNavigatingRef.current = onNavigating
    onLoadingRef.current = onLoading
    onLoadFailedRef.current = onLoadFailed
    onConsoleUpdatedRef.current = onConsoleUpdated
    onNetworkUpdatedRef.current = onNetworkUpdated
    onErrorRef.current = onError
    onClickRef.current = onClick
    onLocationRef.current = onLocation
    onHistoryRef.current = onHistory

    useEffect(() => {
      const iframe = iframeRef.current
      if (!iframe) {
        return
      }

      const bridge = createChromoBridge(
        iframe,
        {
          onReady: (payload) => onReadyRef.current?.(payload),
          onNavigated: (payload) => onNavigatedRef.current?.(payload),
          onNavigating: (payload) => onNavigatingRef.current?.(payload),
          onLoading: (payload) => onLoadingRef.current?.(payload),
          onLoadFailed: (payload) => onLoadFailedRef.current?.(payload),
          onConsoleUpdated: (payload) => onConsoleUpdatedRef.current?.(payload),
          onNetworkUpdated: (payload) => onNetworkUpdatedRef.current?.(payload),
          onError: (payload) => onErrorRef.current?.(payload),
          onClick: (payload) => onClickRef.current?.(payload),
          onLocation: (payload) => onLocationRef.current?.(payload),
          onHistory: (payload) => onHistoryRef.current?.(payload),
        },
        '*',
        {
          devtoolsId,
          disableCache: disableNetworkCacheRef.current,
        },
      )
      bridgeRef.current = bridge

      const url = initialUrlRef.current?.trim()
      if (url) {
        // 在 VC_READY 前入队；ready 后 flush，不依赖父级 ref / onReady 时序
        bridge.navigate(url)
      }

      return () => {
        bridge.destroy()
        bridgeRef.current = null
      }
    }, [devtoolsId])

    useEffect(() => {
      bridgeRef.current?.setNetworkOptions({ disableCache: disableNetworkCache })
    }, [disableNetworkCache])

    useImperativeHandle(
      ref,
      () => ({
        navigate(url: string, options?: ChromoNavigateOptions) {
          bridgeRef.current?.navigate(url, options)
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
        recoverFromFatal() {
          if (bridgeRef.current) {
            // Fatal VC_RELOAD: SW update + viewer location.reload()
            bridgeRef.current.reload()
            return
          }
          const iframe = iframeRef.current
          if (!iframe) {
            return
          }
          const sep = CHROMO_VIEWER_URL.includes('?') ? '&' : '?'
          iframe.src = `${CHROMO_VIEWER_URL}${sep}_r=${Date.now()}`
        },
        stop() {
          bridgeRef.current?.stop()
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
        readNetwork(options) {
          return (
            bridgeRef.current?.readNetwork(options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        readNetworkBody(entryId, options) {
          return (
            bridgeRef.current?.readNetworkBody(entryId, options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        readNetworkBodyLines(entryId, options) {
          return (
            bridgeRef.current?.readNetworkBodyLines(entryId, options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        probeNetworkHot(method, url, options) {
          return (
            bridgeRef.current?.probeNetworkHot(method, url, options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        setNetworkOptions(options) {
          bridgeRef.current?.setNetworkOptions(options)
        },
        setDebugPanelEnabled(enabled: boolean) {
          bridgeRef.current?.setDebugPanelEnabled(enabled)
        },
        screenshot(options?: ChromoScreenshotOptions) {
          return (
            bridgeRef.current?.screenshot(options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        clearState(options) {
          return (
            bridgeRef.current?.clearState(options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        listCookies(options) {
          return (
            bridgeRef.current?.listCookies(options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        deleteCookie(cookieId, options) {
          return (
            bridgeRef.current?.deleteCookie(cookieId, options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        clearCookies(domain, options) {
          return (
            bridgeRef.current?.clearCookies(domain, options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        clearAllCookies(options) {
          return (
            bridgeRef.current?.clearAllCookies(options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        listStorage(type, options) {
          return (
            bridgeRef.current?.listStorage(type, options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        setStorageItem(type, key, value, options) {
          return (
            bridgeRef.current?.setStorageItem(type, key, value, options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        removeStorageItem(type, key, options) {
          return (
            bridgeRef.current?.removeStorageItem(type, key, options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        clearStorage(type, options) {
          return (
            bridgeRef.current?.clearStorage(type, options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        getSwInfo(options) {
          return (
            bridgeRef.current?.getSwInfo(options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        getNetworkCacheStats(options) {
          return (
            bridgeRef.current?.getNetworkCacheStats(options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        listNetworkCache(layer, options) {
          return (
            bridgeRef.current?.listNetworkCache(layer, options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        clearNetworkCache(origin, options) {
          return (
            bridgeRef.current?.clearNetworkCache(origin, options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        clearAllNetworkCache(layer, options) {
          return (
            bridgeRef.current?.clearAllNetworkCache(layer, options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        listIdb(options) {
          return (
            bridgeRef.current?.listIdb(options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        deleteIdb(name, options) {
          return (
            bridgeRef.current?.deleteIdb(name, options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        listIdbStores(name, options) {
          return (
            bridgeRef.current?.listIdbStores(name, options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        getIdbAll(name, store, options) {
          return (
            bridgeRef.current?.getIdbAll(name, store, options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        listSiteCaches(options) {
          return (
            bridgeRef.current?.listSiteCaches(options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        listSiteCacheKeys(cache, options) {
          return (
            bridgeRef.current?.listSiteCacheKeys(cache, options) ??
            Promise.reject(new Error('viewer not ready'))
          )
        },
        deleteSiteCache(cache, url, options) {
          return (
            bridgeRef.current?.deleteSiteCache(cache, url, options) ??
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
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
      />
    )
  },
)

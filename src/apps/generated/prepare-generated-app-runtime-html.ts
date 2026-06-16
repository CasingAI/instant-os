import { injectHostAssetBase } from '../../assets/3d/inject-host-asset-base.ts'
import { injectScene3dBridge } from '../../assets/3d/inject-scene3d-bridge.ts'
import { getHostAssetOrigin } from '../../assets/3d/resolve-host-asset-url.ts'
import type { GeneratedAppDataStore } from '../../os/generated-app-data-storage.ts'
import type { GeneratedAppId } from '../../os/types.ts'
import { injectIframeEmojiFonts } from '../../fonts/inject-iframe-emoji-fonts.ts'
import { generatedAppRuntimeUses3d } from './generated-app-tags.ts'
import { injectGeneratedAppAiBridge } from './inject-generated-app-ai-bridge.ts'
import { injectGeneratedAppErrorBridge } from './inject-generated-app-error-bridge.ts'
import { injectIframeLayoutNotify } from './inject-iframe-layout-notify.ts'
import { injectGeneratedAppStorageBridge } from './inject-generated-app-storage-bridge.ts'

export type PrepareGeneratedAppRuntimeHtmlOptions = {
  debug?: boolean
  reportingAppId?: GeneratedAppId
  /** Blob URL 进程隔离：根路径资源与 import map 须指向宿主 origin。 */
  processIsolated?: boolean
}

export function prepareGeneratedAppRuntimeHtml(
  html: string,
  appId: GeneratedAppId,
  initialData: GeneratedAppDataStore,
  options: PrepareGeneratedAppRuntimeHtmlOptions = {},
): string {
  if (!html.trim()) {
    return ''
  }

  const processIsolated = options.processIsolated === true
  const hostOrigin = processIsolated ? getHostAssetOrigin() : undefined

  let prepared = injectGeneratedAppStorageBridge(html, appId, initialData)
  prepared = injectIframeLayoutNotify(prepared)

  if (hostOrigin) {
    prepared = injectHostAssetBase(prepared, hostOrigin)
  }

  prepared = injectIframeEmojiFonts(prepared)

  if (generatedAppRuntimeUses3d(prepared)) {
    prepared = injectScene3dBridge(prepared, { absoluteAssetUrls: processIsolated })
  }

  prepared = injectGeneratedAppAiBridge(prepared, appId, { debug: options.debug })
  prepared = injectGeneratedAppErrorBridge(prepared, options.reportingAppId ?? appId)

  return prepared
}

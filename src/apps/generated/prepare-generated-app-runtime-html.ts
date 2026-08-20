import { injectHostAssetBase } from '../../assets/3d/inject-host-asset-base.ts'
import { injectScene3dBridge } from '../../assets/3d/inject-scene3d-bridge.ts'
import { getHostAssetOrigin } from '../../assets/3d/resolve-host-asset-url.ts'
import type { GeneratedAppDataStore } from '../../os/generated-app-data-storage.ts'
import type { GeneratedAppId } from '../../os/types.ts'
import { injectIframeEmojiFonts } from '../../fonts/inject-iframe-emoji-fonts.ts'
import { generatedAppRuntimeUses3d, generatedAppRuntimeUsesFiles, generatedAppRuntimeUsesTerminal } from './generated-app-tags.ts'
import { injectGeneratedAppAiBridge } from './inject-generated-app-ai-bridge.ts'
import { injectGeneratedAppErrorBridge } from './inject-generated-app-error-bridge.ts'
import { injectGeneratedAppFilesBridge } from './inject-generated-app-files-bridge.ts'
import { injectGeneratedAppTerminalBridge } from './inject-generated-app-terminal-bridge.ts'
import { injectIframeLayoutNotify } from './inject-iframe-layout-notify.ts'
import { injectGeneratedAppStorageBridge, type GeneratedAppStorageQuota } from './inject-generated-app-storage-bridge.ts'

export type PrepareGeneratedAppRuntimeHtmlOptions = {
  debug?: boolean
  reportingAppId?: GeneratedAppId
  /** Blob URL 进程隔离：根路径资源与 import map 须指向宿主 origin。 */
  processIsolated?: boolean
  /** 已授予 files 能力时强制注入 Files 桥 */
  enableFiles?: boolean
  /** 已授予 terminal 能力时强制注入 Terminal 桥 */
  enableTerminal?: boolean
  /** 存储桥配额预检信息（宿主从注册表内存缓存读取） */
  storageQuota?: GeneratedAppStorageQuota
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

  let prepared = injectGeneratedAppStorageBridge(html, appId, initialData, options.storageQuota)
  prepared = injectIframeLayoutNotify(prepared)

  if (hostOrigin) {
    prepared = injectHostAssetBase(prepared, hostOrigin)
  }

  prepared = injectIframeEmojiFonts(prepared)

  if (generatedAppRuntimeUses3d(prepared)) {
    prepared = injectScene3dBridge(prepared, { absoluteAssetUrls: processIsolated })
  }

  prepared = injectGeneratedAppAiBridge(prepared, appId, { debug: options.debug })

  if (options.enableFiles === true || generatedAppRuntimeUsesFiles(prepared)) {
    prepared = injectGeneratedAppFilesBridge(prepared, appId)
  }

  if (options.enableTerminal === true || generatedAppRuntimeUsesTerminal(prepared)) {
    prepared = injectGeneratedAppTerminalBridge(prepared, appId)
  }

  prepared = injectGeneratedAppErrorBridge(prepared, options.reportingAppId ?? appId)

  return prepared
}

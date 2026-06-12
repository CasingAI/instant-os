import { injectScene3dBridge } from '../../assets/3d/inject-scene3d-bridge.ts'
import type { GeneratedAppDataStore } from '../../os/generated-app-data-storage.ts'
import type { GeneratedAppId } from '../../os/types.ts'
import { injectIframeEmojiFonts } from '../../fonts/inject-iframe-emoji-fonts.ts'
import { generatedAppRuntimeUses3d } from './generated-app-tags.ts'
import { injectGeneratedAppAiBridge } from './inject-generated-app-ai-bridge.ts'
import { injectIframeLayoutNotify } from './inject-iframe-layout-notify.ts'
import { injectGeneratedAppStorageBridge } from './inject-generated-app-storage-bridge.ts'

export type PrepareGeneratedAppRuntimeHtmlOptions = {
  debug?: boolean
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

  let prepared = injectGeneratedAppStorageBridge(html, appId, initialData)
  prepared = injectIframeLayoutNotify(prepared)
  prepared = injectIframeEmojiFonts(prepared)

  if (generatedAppRuntimeUses3d(prepared)) {
    prepared = injectScene3dBridge(prepared)
  }

  prepared = injectGeneratedAppAiBridge(prepared, appId, { debug: options.debug })

  return prepared
}

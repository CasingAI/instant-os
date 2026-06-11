import { injectScene3dBridge } from '../../assets/3d/inject-scene3d-bridge.ts'
import type { GeneratedAppDataStore } from '../../os/generated-app-data-storage.ts'
import type { GeneratedAppId } from '../../os/types.ts'
import { injectIframeEmojiFonts } from '../../fonts/inject-iframe-emoji-fonts.ts'
import { generatedAppRuntimeUses3d } from '../generated/generated-app-tags.ts'
import { injectGeneratedAppAiBridge } from '../generated/inject-generated-app-ai-bridge.ts'
import { injectGeneratedAppStorageBridge } from '../generated/inject-generated-app-storage-bridge.ts'
import { injectIcodeConsoleBridge } from './inject-icode-console-bridge.ts'

export function prepareIcodePreviewHtml(
  html: string,
  appId: GeneratedAppId,
  initialData: GeneratedAppDataStore,
): string {
  if (!html.trim()) {
    return ''
  }

  let prepared = injectGeneratedAppStorageBridge(html, appId, initialData)
  prepared = injectIcodeConsoleBridge(prepared, appId)
  prepared = injectIframeEmojiFonts(prepared)

  if (generatedAppRuntimeUses3d(prepared)) {
    prepared = injectScene3dBridge(prepared)
  }

  prepared = injectGeneratedAppAiBridge(prepared, appId, { debug: true })

  return prepared
}

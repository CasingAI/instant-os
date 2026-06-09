import { injectScene3dBridge } from '../../assets/3d/inject-scene3d-bridge.ts'
import type { GeneratedAppDataStore } from '../../os/generated-app-data-storage.ts'
import type { GeneratedAppId } from '../../os/types.ts'
import { injectIframeEmojiFonts } from '../../fonts/inject-iframe-emoji-fonts.ts'
import { generatedAppNeeds3d } from '../generated/generated-app-tags.ts'
import { injectGeneratedAppStorageBridge } from '../generated/inject-generated-app-storage-bridge.ts'
import { injectIcodeConsoleBridge } from './inject-icode-console-bridge.ts'

type PreviewMeta = {
  name: string
  description: string
  category: string
  tags?: string[]
}

export function prepareIcodePreviewHtml(
  html: string,
  appId: GeneratedAppId,
  initialData: GeneratedAppDataStore,
  meta: PreviewMeta,
): string {
  if (!html.trim()) {
    return ''
  }

  let prepared = injectGeneratedAppStorageBridge(html, appId, initialData)
  prepared = injectIcodeConsoleBridge(prepared, appId)
  prepared = injectIframeEmojiFonts(prepared)

  if (
    generatedAppNeeds3d(prepared, {
      name: meta.name,
      description: meta.description,
      category: meta.category,
      tags: meta.tags,
    })
  ) {
    prepared = injectScene3dBridge(prepared)
  }

  return prepared
}

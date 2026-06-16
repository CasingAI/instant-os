import type { GeneratedAppDataStore } from '../../os/generated-app-data-storage.ts'
import type { GeneratedAppId } from '../../os/types.ts'
import { prepareGeneratedAppRuntimeHtml } from '../generated/prepare-generated-app-runtime-html.ts'
import { injectIcodeConsoleBridge } from './inject-icode-console-bridge.ts'

export function prepareIcodePreviewHtml(
  html: string,
  appId: GeneratedAppId,
  initialData: GeneratedAppDataStore,
  consoleAppId?: GeneratedAppId,
  processIsolated?: boolean,
): string {
  if (!html.trim()) {
    return ''
  }

  const prepared = prepareGeneratedAppRuntimeHtml(html, appId, initialData, {
    debug: true,
    reportingAppId: consoleAppId ?? appId,
    processIsolated: processIsolated === true,
  })
  return injectIcodeConsoleBridge(prepared, consoleAppId ?? appId)
}

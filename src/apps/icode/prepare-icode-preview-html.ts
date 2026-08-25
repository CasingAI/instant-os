import type { GeneratedAppDataStore } from '../../os/generated-app-data-storage.ts'
import type { GeneratedAppId } from '../../os/types.ts'
import { prepareGeneratedAppRuntimeHtml } from '../generated/prepare-generated-app-runtime-html.ts'
import { injectIcodeConsoleBridge } from './inject-icode-console-bridge.ts'

export type PrepareIcodePreviewHtmlOptions = {
  processIsolated?: boolean
  enableFiles?: boolean
  enableTerminal?: boolean
}

export function prepareIcodePreviewHtml(
  html: string,
  appId: GeneratedAppId,
  initialData: GeneratedAppDataStore,
  consoleAppId?: GeneratedAppId,
  processIsolatedOrOptions?: boolean | PrepareIcodePreviewHtmlOptions,
): string {
  if (html.length === 0) {
    return ''
  }

  const options: PrepareIcodePreviewHtmlOptions =
    typeof processIsolatedOrOptions === 'boolean'
      ? { processIsolated: processIsolatedOrOptions }
      : (processIsolatedOrOptions ?? {})

  const prepared = prepareGeneratedAppRuntimeHtml(html, appId, initialData, {
    debug: true,
    reportingAppId: consoleAppId ?? appId,
    processIsolated: options.processIsolated === true,
    enableFiles: options.enableFiles === true,
    enableTerminal: options.enableTerminal === true,
  })
  return injectIcodeConsoleBridge(prepared, consoleAppId ?? appId)
}

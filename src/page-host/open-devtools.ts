import type { OpenAppOptions } from '../os/types.ts'
import {
  makePageDevToolsSessionKey,
  type PageDevToolsDockSide,
} from './page-devtools-hub.ts'

export type OpenDevToolsMode = 'undocked' | 'embedded'

export type OpenDevToolsOptions = {
  hostId: string
  tabId: string
  /** Default: undocked */
  mode?: OpenDevToolsMode
  dockSide?: PageDevToolsDockSide
}

export type OpenDevToolsHost = {
  openApp: (appId: string, options?: OpenAppOptions) => void
  /** Set embedded open request for the host shell to observe. */
  requestEmbedded?: (options: {
    hostId: string
    tabId: string
    dockSide: PageDevToolsDockSide
  }) => void
}

/**
 * Open DevTools for a page-host tab.
 * Undocked opens the `page-devtools` multi-window app; embedded notifies the host shell.
 */
export function openDevTools(host: OpenDevToolsHost, options: OpenDevToolsOptions): void {
  const mode = options.mode ?? 'undocked'
  const dockSide = options.dockSide ?? 'bottom'
  if (mode === 'embedded') {
    host.requestEmbedded?.({
      hostId: options.hostId,
      tabId: options.tabId,
      dockSide,
    })
    return
  }
  const sessionKey = makePageDevToolsSessionKey(options.hostId, options.tabId)
  host.openApp('page-devtools', { documentId: sessionKey })
}

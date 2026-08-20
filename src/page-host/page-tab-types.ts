import type { ChromoConsoleEntry, ChromoNetworkEntry } from './page-bridge.ts'
import type { ChromoPageFault } from './page-fault.ts'
import type { PageDevToolsDockSide, PageDevToolsPanelTab } from './page-devtools-hub.ts'

export type { PageDevToolsDockSide, PageDevToolsPanelTab }

/** Shared tab state for Chromo / WebView page hosts. */
export type PageTab = {
  id: string
  /** Parent-tab id for Disable cache isolation only (not a Worker session). */
  devtoolsId: string
  url: string
  title: string
  inputUrl: string
  /** Target URL while a navigation is in flight (for loading UI). */
  pendingUrl?: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  ready: boolean
  bootstrapped: boolean
  pageFault?: ChromoPageFault
  consoleEntries: ChromoConsoleEntry[]
  networkEntries: ChromoNetworkEntry[]
  lastConsoleId: string
  lastNetworkId: string
  selectedNetworkId: string
  disableNetworkCache: boolean
  preserveConsole: boolean
  /** 该 tab 内嵌 DevTools 是否打开（undock 时为 false） */
  devtoolsOpen: boolean
  /** 该 tab 当前 DevTools 面板 */
  devtoolsTab: PageDevToolsPanelTab
  /** 该 tab 停靠方向（bottom/left/right） */
  devtoolsDockSide: PageDevToolsDockSide
  /** 该 tab 是否已在独立 OS 窗中打开 DevTools */
  devtoolsUndocked: boolean
}

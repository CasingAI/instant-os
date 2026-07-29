import type { ChromoScreenshotOptions, ChromoScreenshotResult } from '../../page-host/page-bridge.ts'
import type { PageTab } from '../../page-host/page-tab-types.ts'
import type { PageDevToolsDockSide } from '../../page-host/page-devtools-hub.ts'
import { makePageDevToolsSessionKey } from '../../page-host/page-devtools-hub.ts'
import { formatPageFault } from '../../page-host/page-fault.ts'
import { displayPageUrl, normalizePageUrl, pageTitleFromUrl } from '../../page-host/page-url.ts'
import type { PageViewerHandle } from '../../page-host/page-viewer-frame.tsx'
import type { RefObject } from 'preact'

export type WebViewUnitEvent =
  | { type: 'unitCreated'; unitId: string; tabId: string; url: string }
  | { type: 'unitDestroyed'; unitId: string }
  | { type: 'unitShown'; unitId: string }
  | { type: 'tabOpened'; unitId: string; tabId: string; url: string }
  | { type: 'tabClosed'; unitId: string; tabId: string }
  | { type: 'tabFault'; unitId: string; tabId: string; message: string }
  | { type: 'navigated'; unitId: string; tabId: string; url: string; title: string }

export type WebViewUnitRecord = {
  unitId: string
  ownerTerminalSessionId: string
  tabs: PageTab[]
  uiDisplayedTabId: string
  visible: boolean
  windowId?: string
  viewerRefs: Record<string, RefObject<PageViewerHandle>>
}

type Listener = (event: WebViewUnitEvent) => void

const units = new Map<string, WebViewUnitRecord>()
const listeners = new Set<Listener>()
let nextUnitSeq = 1
let nextTabSeq = 1

const CHANGED_EVENT = 'instant-webview-registry-changed'

function emit(event: WebViewUnitEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch {
      // ignore listener errors
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: event }))
  }
}

function notifyChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT))
  }
}

function createTab(initialUrl: string): PageTab {
  const id = `webview-tab-${nextTabSeq++}`
  const url = initialUrl ? normalizePageUrl(initialUrl) : ''
  return {
    id,
    devtoolsId: crypto.randomUUID(),
    url,
    title: url ? pageTitleFromUrl(url) : '新标签页',
    inputUrl: url ? displayPageUrl(url) : '',
    pendingUrl: url || undefined,
    loading: Boolean(url),
    canGoBack: false,
    canGoForward: false,
    ready: false,
    bootstrapped: Boolean(url),
    consoleEntries: [],
    networkEntries: [],
    lastConsoleId: '',
    lastNetworkId: '',
    selectedNetworkId: '',
    disableNetworkCache: false,
    preserveConsole: false,
    devtoolsOpen: false,
    devtoolsTab: 'console',
    devtoolsDockSide: 'bottom' as PageDevToolsDockSide,
    devtoolsUndocked: false,
  }
}

export function subscribeWebViewRegistry(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function onWebViewRegistryChanged(listener: () => void): () => void {
  const handler = () => listener()
  window.addEventListener(CHANGED_EVENT, handler)
  return () => window.removeEventListener(CHANGED_EVENT, handler)
}

export function listWebViewUnits(): WebViewUnitRecord[] {
  return [...units.values()]
}

export function getWebViewUnit(unitId: string): WebViewUnitRecord | undefined {
  return units.get(unitId)
}

export function createWebViewUnit(
  ownerTerminalSessionId: string,
  url: string,
): { unitId: string; tabId: string } {
  const trimmed = url.trim()
  if (!trimmed) {
    throw new Error('url 不能为空')
  }
  const unitId = `webview-unit-${nextUnitSeq++}`
  const tab = createTab(trimmed)
  const record: WebViewUnitRecord = {
    unitId,
    ownerTerminalSessionId,
    tabs: [tab],
    uiDisplayedTabId: tab.id,
    visible: false,
    viewerRefs: {},
  }
  units.set(unitId, record)
  emit({ type: 'unitCreated', unitId, tabId: tab.id, url: tab.url })
  notifyChanged()
  return { unitId, tabId: tab.id }
}

export function destroyWebViewUnit(unitId: string): void {
  const unit = units.get(unitId)
  if (!unit) {
    return
  }
  units.delete(unitId)
  emit({ type: 'unitDestroyed', unitId })
  notifyChanged()
}

/** Close OS windows for destroyed units. Call from UI / inject with closeWindow. */
export function destroyWebViewUnitWithWindow(
  unitId: string,
  closeWindow?: (windowId: string) => void,
): void {
  const unit = units.get(unitId)
  if (unit?.windowId && closeWindow) {
    closeWindow(unit.windowId)
  }
  destroyWebViewUnit(unitId)
}

export function destroyWebViewUnitsForOwner(
  ownerTerminalSessionId: string,
  closeWindow?: (windowId: string) => void,
): void {
  for (const unit of [...units.values()]) {
    if (unit.ownerTerminalSessionId === ownerTerminalSessionId) {
      destroyWebViewUnitWithWindow(unit.unitId, closeWindow)
    }
  }
}

export function setWebViewUnitVisible(
  unitId: string,
  visible: boolean,
  windowId?: string,
): void {
  const unit = units.get(unitId)
  // 单元已被终端/任务管理器销毁时，窗可能仍短暂挂着——静默忽略
  if (!unit) {
    return
  }
  const prevVisible = unit.visible
  const prevWindowId = unit.windowId
  unit.visible = visible
  if (!visible) {
    unit.windowId = undefined
  } else if (windowId !== undefined) {
    unit.windowId = windowId
  }
  if (prevVisible === unit.visible && prevWindowId === unit.windowId) {
    return
  }
  if (visible && !prevVisible) {
    emit({ type: 'unitShown', unitId })
  }
  notifyChanged()
}

export function setWebViewUiDisplayedTab(unitId: string, tabId: string): void {
  const unit = units.get(unitId)
  if (!unit) {
    throw new Error(`浏览单元不存在: ${unitId}`)
  }
  if (!unit.tabs.some((tab) => tab.id === tabId)) {
    throw new Error(`标签页不存在: ${tabId}`)
  }
  unit.uiDisplayedTabId = tabId
  notifyChanged()
}

export function updateWebViewTab(
  unitId: string,
  tabId: string,
  updater: (tab: PageTab) => PageTab,
): void {
  const unit = units.get(unitId)
  if (!unit) {
    throw new Error(`浏览单元不存在: ${unitId}`)
  }
  unit.tabs = unit.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab))
  notifyChanged()
}

export function addWebViewTab(unitId: string, url: string): string {
  const unit = units.get(unitId)
  if (!unit) {
    throw new Error(`浏览单元不存在: ${unitId}`)
  }
  const tab = createTab(url)
  unit.tabs = [...unit.tabs, tab]
  emit({ type: 'tabOpened', unitId, tabId: tab.id, url: tab.url })
  notifyChanged()
  return tab.id
}

export function closeWebViewTab(unitId: string, tabId: string): void {
  const unit = units.get(unitId)
  if (!unit) {
    throw new Error(`浏览单元不存在: ${unitId}`)
  }
  if (unit.tabs.length <= 1) {
    destroyWebViewUnit(unitId)
    return
  }
  const index = unit.tabs.findIndex((tab) => tab.id === tabId)
  if (index === -1) {
    return
  }
  unit.tabs = unit.tabs.filter((tab) => tab.id !== tabId)
  delete unit.viewerRefs[tabId]
  if (unit.uiDisplayedTabId === tabId) {
    unit.uiDisplayedTabId = unit.tabs[Math.max(0, index - 1)]?.id ?? unit.tabs[0]!.id
  }
  emit({ type: 'tabClosed', unitId, tabId })
  notifyChanged()
}

export function getWebViewTab(unitId: string, tabId: string): PageTab {
  const unit = units.get(unitId)
  if (!unit) {
    throw new Error(`浏览单元不存在: ${unitId}`)
  }
  const tab = unit.tabs.find((entry) => entry.id === tabId)
  if (!tab) {
    throw new Error(`标签页不存在: ${tabId}`)
  }
  return tab
}

export function requireLiveWebViewTab(unitId: string, tabId: string): PageTab {
  const tab = getWebViewTab(unitId, tabId)
  if (tab.pageFault) {
    throw new Error(formatPageFault(tab.pageFault) || tab.pageFault.message)
  }
  return tab
}

export function listWebViewTabs(unitId: string): PageTab[] {
  const unit = getWebViewUnit(unitId)
  if (!unit) {
    throw new Error(`浏览单元不存在: ${unitId}`)
  }
  return unit.tabs.map((tab) => ({ ...tab }))
}

export function makeWebViewDevToolsKey(unitId: string, tabId: string): string {
  return makePageDevToolsSessionKey(unitId, tabId)
}

export type WebViewUnitSummary = {
  unitId: string
  ownerTerminalSessionId: string
  visible: boolean
  windowId?: string
  tabCount: number
  title: string
  url: string
  loading: boolean
  hasFault: boolean
  status: string
}

export function summarizeWebViewUnit(unit: WebViewUnitRecord): WebViewUnitSummary {
  const displayed =
    unit.tabs.find((tab) => tab.id === unit.uiDisplayedTabId) ?? unit.tabs[0]
  const url = displayed?.pendingUrl || displayed?.url || ''
  let host = url
  try {
    host = url ? new URL(url).hostname : '空白页'
  } catch {
    host = url || '空白页'
  }
  const loading = Boolean(displayed?.loading)
  const hasFault = Boolean(displayed?.pageFault)
  let status = '离屏'
  if (hasFault) status = '错误'
  else if (loading) status = '加载中'
  else if (unit.visible) status = '已显示'
  return {
    unitId: unit.unitId,
    ownerTerminalSessionId: unit.ownerTerminalSessionId,
    visible: unit.visible,
    windowId: unit.windowId,
    tabCount: unit.tabs.length,
    title: `WebView — ${host}`,
    url,
    loading,
    hasFault,
    status,
  }
}

export async function evalWebViewTab(
  unitId: string,
  tabId: string,
  code: string,
  getViewer: (unitId: string, tabId: string) => PageViewerHandle | null | undefined,
): Promise<unknown> {
  requireLiveWebViewTab(unitId, tabId)
  const viewer = getViewer(unitId, tabId)
  if (!viewer?.isReady()) {
    throw new Error('网页尚未就绪')
  }
  return viewer.evalInPage(code)
}

export async function screenshotWebViewTab(
  unitId: string,
  tabId: string,
  options: ChromoScreenshotOptions | undefined,
  getViewer: (unitId: string, tabId: string) => PageViewerHandle | null | undefined,
): Promise<ChromoScreenshotResult> {
  requireLiveWebViewTab(unitId, tabId)
  const viewer = getViewer(unitId, tabId)
  if (!viewer?.isReady()) {
    throw new Error('网页尚未就绪')
  }
  return viewer.screenshot(options)
}

export { CHANGED_EVENT as WEBVIEW_REGISTRY_CHANGED_EVENT }

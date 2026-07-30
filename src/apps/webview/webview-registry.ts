import type { ChromoScreenshotOptions, ChromoScreenshotResult } from '../../page-host/page-bridge.ts'
import type { PageTab } from '../../page-host/page-tab-types.ts'
import type { PageDevToolsDockSide } from '../../page-host/page-devtools-hub.ts'
import { makePageDevToolsSessionKey } from '../../page-host/page-devtools-hub.ts'
import { formatPageFault } from '../../page-host/page-fault.ts'
import { displayPageUrl, normalizePageUrl, pageTitleFromUrl } from '../../page-host/page-url.ts'
import type { PageViewerHandle } from '../../page-host/page-viewer-frame.tsx'
import type { RefObject } from 'preact'
import {
  capturePageAgentMarkdown,
  capturePageAgentSnapshot,
  type PageAgentMarkdownResult,
  type PageAgentSnapshotResult,
} from '../../page-host/page-agent-scripts.ts'

export type WebViewUnitEvent =
  | { type: 'unitCreated'; unitId: string; tabId: string; url: string }
  | { type: 'unitDestroyed'; unitId: string; ownerTerminalSessionId: string }
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
  /** @deprecated 派生自 windowId；保留供 listUnits API 兼容 */
  visible: boolean
  windowId?: string
  /** Window Shell 提供的 viewport 挂载点；Runtime 据此 portal */
  viewportTarget: HTMLElement | null
  viewerRefs: Record<string, RefObject<PageViewerHandle>>
}

export type WebViewDisplayState = 'offscreen' | 'displayed' | 'minimized' | 'fault'

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
    viewportTarget: null,
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
  const ownerTerminalSessionId = unit.ownerTerminalSessionId
  units.delete(unitId)
  emit({ type: 'unitDestroyed', unitId, ownerTerminalSessionId })
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

/**
 * 绑定 / 解绑 OS Window 壳。
 * - windowId 有值：Session 进入「有窗」态（displayed / minimized 由 OS 派生）
 * - windowId 为 undefined：关壳回离屏，不清 viewportTarget（Shell unmount 会清）
 */
export function bindWebViewWindow(unitId: string, windowId: string | undefined): void {
  const unit = units.get(unitId)
  // 单元已被终端/任务管理器销毁时，窗可能仍短暂挂着——静默忽略
  if (!unit) {
    return
  }
  const prevWindowId = unit.windowId
  const prevVisible = unit.visible
  unit.windowId = windowId
  unit.visible = Boolean(windowId)
  if (prevWindowId === unit.windowId && prevVisible === unit.visible) {
    return
  }
  if (windowId && !prevWindowId) {
    emit({ type: 'unitShown', unitId })
  }
  notifyChanged()
}

/** @deprecated 使用 bindWebViewWindow */
export function setWebViewUnitVisible(
  unitId: string,
  visible: boolean,
  windowId?: string,
): void {
  if (!visible) {
    bindWebViewWindow(unitId, undefined)
    return
  }
  bindWebViewWindow(unitId, windowId)
}

export function setWebViewViewportTarget(
  unitId: string,
  target: HTMLElement | null,
): void {
  const unit = units.get(unitId)
  if (!unit) {
    return
  }
  if (unit.viewportTarget === target) {
    return
  }
  unit.viewportTarget = target
  notifyChanged()
}

export function getWebViewDisplayState(
  unit: WebViewUnitRecord,
  windows: { id: string; closing?: boolean; minimized?: boolean }[],
): WebViewDisplayState {
  const displayed =
    unit.tabs.find((tab) => tab.id === unit.uiDisplayedTabId) ?? unit.tabs[0]
  if (displayed?.pageFault) {
    return 'fault'
  }
  if (!unit.windowId) {
    return 'offscreen'
  }
  const win = windows.find((window) => window.id === unit.windowId && !window.closing)
  if (!win) {
    return 'offscreen'
  }
  if (win.minimized) {
    return 'minimized'
  }
  return 'displayed'
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
    emit({ type: 'tabClosed', unitId, tabId })
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

export function resolveWebViewTabId(unitId: string, tabId: string): string {
  const unit = units.get(unitId)
  if (!unit) {
    throw new Error(`浏览单元不存在: ${unitId}`)
  }
  const raw = tabId.trim()
  if (raw === '' || raw === 'default') {
    return unit.uiDisplayedTabId
  }
  if (!unit.tabs.some((tab) => tab.id === raw)) {
    throw new Error(`标签页不存在: ${raw}`)
  }
  return raw
}

export function assertWebViewUnitOwner(unitId: string, ownerTerminalSessionId: string): void {
  const unit = units.get(unitId)
  if (!unit) {
    throw new Error(`浏览单元不存在: ${unitId}`)
  }
  if (unit.ownerTerminalSessionId !== ownerTerminalSessionId) {
    throw new Error(`无权操作浏览单元: ${unitId}`)
  }
}

export function emitWebViewNavigated(
  unitId: string,
  tabId: string,
  url: string,
  title: string,
): void {
  emit({ type: 'navigated', unitId, tabId, url, title })
}

export function emitWebViewTabFault(unitId: string, tabId: string, message: string): void {
  emit({ type: 'tabFault', unitId, tabId, message })
}

export function findWebViewWindowId(
  unitId: string,
  windows: { id: string; appId: string; documentId?: string; closing?: boolean }[],
): string | undefined {
  const unit = units.get(unitId)
  if (unit?.windowId) {
    const stillOpen = windows.find((window) => window.id === unit.windowId && !window.closing)
    if (stillOpen) return unit.windowId
  }
  return windows.find(
    (window) => window.appId === 'webview' && !window.closing && window.documentId === unitId,
  )?.id
}

export function closeWebViewUnitWindows(
  unitId: string,
  windows: { id: string; appId: string; documentId?: string; closing?: boolean }[],
  closeWindow: (windowId: string) => void,
): void {
  const windowId = findWebViewWindowId(unitId, windows)
  if (windowId) {
    closeWindow(windowId)
  }
}

const DEFAULT_WAIT_TIMEOUT_MS = 30_000

function isTabReady(tab: PageTab): boolean {
  return Boolean(tab.ready && !tab.loading && !tab.pageFault)
}

export function waitWebViewTab(
  unitId: string,
  tabId: string,
  timeoutMs: number = DEFAULT_WAIT_TIMEOUT_MS,
): Promise<void> {
  const resolvedTabId = resolveWebViewTabId(unitId, tabId)
  const immediate = getWebViewTab(unitId, resolvedTabId)
  if (immediate.pageFault) {
    return Promise.reject(
      new Error(formatPageFault(immediate.pageFault) || immediate.pageFault.message),
    )
  }
  if (isTabReady(immediate)) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsub()
      fn()
    }

    const check = () => {
      const unit = units.get(unitId)
      if (!unit) {
        finish(() => reject(new Error(`浏览单元不存在: ${unitId}`)))
        return
      }
      const tab = unit.tabs.find((entry) => entry.id === resolvedTabId)
      if (!tab) {
        finish(() => reject(new Error(`标签页不存在: ${resolvedTabId}`)))
        return
      }
      if (tab.pageFault) {
        finish(() =>
          reject(new Error(formatPageFault(tab.pageFault) || tab.pageFault.message)),
        )
        return
      }
      if (isTabReady(tab)) {
        finish(() => resolve())
      }
    }

    // updateWebViewTab 只走 notifyChanged（CustomEvent），不走 typed listeners
    const unsub = onWebViewRegistryChanged(() => {
      check()
    })
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`等待网页就绪超时（${timeoutMs}ms）`)))
    }, Math.max(1, timeoutMs))
    check()
  })
}

export function buildWebViewFaultDocumentHtml(fault: {
  message: string
  code?: string
  url?: string
}): string {
  const title = '此页面已停止运行'
  const lines = [
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>`,
    '<style>body{font-family:system-ui,sans-serif;padding:24px;color:#111;background:#fafafa}h1{font-size:20px}pre{white-space:pre-wrap;color:#444}</style>',
    `</head><body><h1>${escapeHtml(title)}</h1>`,
    `<p>${escapeHtml(fault.message)}</p>`,
  ]
  if (fault.code) {
    lines.push(`<pre>code: ${escapeHtml(fault.code)}</pre>`)
  }
  if (fault.url) {
    lines.push(`<pre>url: ${escapeHtml(fault.url)}</pre>`)
  }
  lines.push('</body></html>')
  return lines.join('')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function injectWebViewFaultDocument(
  viewer: PageViewerHandle | null | undefined,
  fault: { message: string; code?: string; url?: string },
): void {
  if (!viewer?.isReady()) return
  const html = buildWebViewFaultDocumentHtml(fault)
  void viewer
    .evalInPage(
      `(function(){document.open();document.write(${JSON.stringify(html)});document.close();return true})()`,
    )
    .catch(() => {
      // bridge 可能已死；忽略
    })
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

export function summarizeWebViewUnit(
  unit: WebViewUnitRecord,
  windows: { id: string; closing?: boolean; minimized?: boolean }[] = [],
): WebViewUnitSummary {
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
  const displayState = getWebViewDisplayState(unit, windows)
  let status = '离屏'
  if (displayState === 'fault') status = '错误'
  else if (loading) status = '加载中'
  else if (displayState === 'minimized') status = '已最小化'
  else if (displayState === 'displayed') status = '已显示'
  return {
    unitId: unit.unitId,
    ownerTerminalSessionId: unit.ownerTerminalSessionId,
    visible: Boolean(unit.windowId),
    windowId: unit.windowId,
    tabCount: unit.tabs.length,
    title: `WebView — ${host}`,
    url,
    loading,
    hasFault,
    status,
  }
}

export function requireLiveWebViewTab(unitId: string, tabId: string): PageTab {
  const tab = getWebViewTab(unitId, tabId)
  if (tab.pageFault) {
    throw new Error(formatPageFault(tab.pageFault) || tab.pageFault.message)
  }
  return tab
}

export async function evalWebViewTab(
  unitId: string,
  tabId: string,
  code: string,
  getViewer: (unitId: string, tabId: string) => PageViewerHandle | null | undefined,
): Promise<unknown> {
  // fault 后允许读错误页 DOM；viewer 未就绪时再抛 fault / 尚未就绪
  const tab = getWebViewTab(unitId, tabId)
  const viewer = getViewer(unitId, tabId)
  if (!viewer?.isReady()) {
    if (tab.pageFault) {
      throw new Error(formatPageFault(tab.pageFault) || tab.pageFault.message)
    }
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

function requireReadyViewer(
  unitId: string,
  tabId: string,
  getViewer: (unitId: string, tabId: string) => PageViewerHandle | null | undefined,
): PageViewerHandle {
  requireLiveWebViewTab(unitId, tabId)
  const viewer = getViewer(unitId, tabId)
  if (!viewer?.isReady()) {
    throw new Error('网页尚未就绪')
  }
  return viewer
}

export async function snapshotWebViewTab(
  unitId: string,
  tabId: string,
  getViewer: (unitId: string, tabId: string) => PageViewerHandle | null | undefined,
): Promise<PageAgentSnapshotResult> {
  const viewer = requireReadyViewer(unitId, tabId, getViewer)
  const result = await capturePageAgentSnapshot((code, options) =>
    viewer.evalInPage(code, options),
  )
  if (result.error) {
    throw new Error(result.error)
  }
  return result
}

export async function markdownWebViewTab(
  unitId: string,
  tabId: string,
  ref: string | undefined,
  getViewer: (unitId: string, tabId: string) => PageViewerHandle | null | undefined,
): Promise<PageAgentMarkdownResult> {
  const viewer = requireReadyViewer(unitId, tabId, getViewer)
  const result = await capturePageAgentMarkdown(
    (code, options) => viewer.evalInPage(code, options),
    ref,
  )
  if (result.error) {
    throw new Error(result.error)
  }
  return result
}

export { CHANGED_EVENT as WEBVIEW_REGISTRY_CHANGED_EVENT }

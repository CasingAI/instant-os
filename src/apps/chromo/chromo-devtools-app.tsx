import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useOs, useWindowCloseGuard } from '../../os/os-context.tsx'
import { mergeConsoleDisplayEntries } from './chromo-console-types.ts'
import {
  getChromoDevToolsSession,
  subscribeChromoDevToolsSession,
  type ChromoDevToolsDockSide,
} from './chromo-devtools-hub.ts'
import { ChromoDevToolsPanel } from './chromo-devtools-panel.tsx'
import './chromo.css'

type ChromoDevToolsAppProps = {
  windowId?: string
}

export function ChromoDevToolsApp({ windowId }: ChromoDevToolsAppProps) {
  const { windows, closeWindow, setWindowTitle } = useOs()
  const appWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.closing)
    : undefined
  const sessionKey = appWindow?.documentId ?? ''
  const closingByRedockRef = useRef(false)

  const [session, setSession] = useState(() =>
    sessionKey ? getChromoDevToolsSession(sessionKey) : undefined,
  )

  useEffect(() => {
    if (!sessionKey) {
      setSession(undefined)
      return
    }
    setSession(getChromoDevToolsSession(sessionKey))
    return subscribeChromoDevToolsSession(sessionKey, () => {
      setSession(getChromoDevToolsSession(sessionKey))
    })
  }, [sessionKey])

  const snapshot = session?.snapshot
  const handlers = session?.handlers

  useEffect(() => {
    if (!windowId || !snapshot) {
      return
    }
    const title = snapshot.pageTitle
      ? `开发者工具 — ${snapshot.pageTitle}`
      : snapshot.pageUrl
        ? `开发者工具 — ${snapshot.pageUrl}`
        : '开发者工具'
    setWindowTitle(windowId, title)
  }, [snapshot, setWindowTitle, windowId])

  const notifyDetachedClosed = useCallback(() => {
    if (closingByRedockRef.current) {
      return
    }
    handlers?.onDetachedClosed()
  }, [handlers])

  useWindowCloseGuard(windowId, () => {
    notifyDetachedClosed()
    return true
  })

  const onClose = useCallback(() => {
    notifyDetachedClosed()
    if (windowId) {
      closeWindow(windowId)
    }
  }, [closeWindow, notifyDetachedClosed, windowId])

  const onDockSideChange = useCallback(
    (side: ChromoDevToolsDockSide) => {
      closingByRedockRef.current = true
      handlers?.onRedock(side)
      if (windowId) {
        closeWindow(windowId)
      }
    },
    [closeWindow, handlers, windowId],
  )

  const missing = !snapshot || !handlers

  const body = useMemo(() => {
    if (missing || !snapshot || !handlers) {
      return (
        <div class="chromo-devtools chromo-devtools--window">
          <div class="chromo-devtools__placeholder">开发者工具会话已断开</div>
        </div>
      )
    }

    return (
      <ChromoDevToolsPanel
        mode="window"
        activeTab={snapshot.panelTab}
        onTabChange={handlers.onPanelTabChange}
        onClose={onClose}
        dockSide={snapshot.dockSide}
        onDockSideChange={onDockSideChange}
        preserveLog={snapshot.preserveLog}
        onPreserveLogChange={handlers.onPreserveLogChange}
        onClear={handlers.onClear}
        entries={mergeConsoleDisplayEntries(snapshot.consoleEntries, snapshot.replEntries)}
        pageReady={snapshot.pageReady}
        evalInPage={handlers.evalInPage}
        replHistory={snapshot.replHistory}
        onReplHistoryChange={handlers.onReplHistoryChange}
        onAppendEntries={handlers.onAppendEntries}
        networkEntries={snapshot.networkEntries}
        selectedNetworkId={snapshot.selectedNetworkId || undefined}
        disableNetworkCache={snapshot.disableNetworkCache}
        onDisableNetworkCacheChange={handlers.onDisableNetworkCacheChange}
        readNetworkBody={handlers.readNetworkBody}
        probeNetworkHot={handlers.probeNetworkHot}
        pageLoading={snapshot.pageLoading}
        pageError={snapshot.pageError}
        pageFault={snapshot.pageFault}
        onSelectNetwork={handlers.onSelectNetwork}
        onCloseNetworkDetail={handlers.onCloseNetworkDetail}
        pageUrl={snapshot.pageUrl}
        vConsoleEnabled={snapshot.vConsoleEnabled}
        vConsoleBusy={snapshot.vConsoleBusy}
        vConsoleError={snapshot.vConsoleError}
        onVConsoleEnabledChange={handlers.onVConsoleEnabledChange}
        debugPanelEnabled={snapshot.debugPanelEnabled}
        onDebugPanelEnabledChange={handlers.onDebugPanelEnabledChange}
        viewerReady={snapshot.pageReady}
      />
    )
  }, [handlers, missing, onClose, onDockSideChange, snapshot])

  return <div class="chromo-devtools-window">{body}</div>
}

import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { getAppDefinition } from '../../os/app-registry.tsx'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { SpaceSnifferStartDialog } from './space-sniffer-start-dialog.tsx'
import { SpaceSnifferView } from './space-sniffer-view.tsx'
import './space-sniffer.css'

const APP_ID = 'space-sniffer' as const

type SpaceSnifferAppProps = {
  windowId?: string
}

function normalizeScanPath(path: string | undefined): string | undefined {
  if (!path) return undefined
  const trimmed = path.trim().replace(/\/+$/, '') || '/'
  if (!trimmed.startsWith('/') || trimmed === '/') return undefined
  return trimmed
}

export function SpaceSnifferApp({ windowId }: SpaceSnifferAppProps) {
  const {
    windows,
    openApp,
    setWindowTitle,
    setWindowDocumentId,
    closeWindow,
    closeWindowsForApp,
    minimizeWindow,
  } = useOs()
  const { showBuiltinAbout } = useAboutApp()

  const appWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.closing)
    : undefined
  const pendingDocumentId = normalizeScanPath(appWindow?.documentId)

  const [scanRoot, setScanRoot] = useState<string | undefined>(() => pendingDocumentId)
  const [showStart, setShowStart] = useState(() => !pendingDocumentId)
  const [consumedDocumentId, setConsumedDocumentId] = useState<string | undefined>(
    () => pendingDocumentId,
  )

  useEffect(() => {
    if (!pendingDocumentId || pendingDocumentId === consumedDocumentId) return
    setScanRoot(pendingDocumentId)
    setShowStart(false)
    setConsumedDocumentId(pendingDocumentId)
    if (windowId) {
      setWindowTitle(windowId, `空间嗅探 — ${pendingDocumentId}`)
      setWindowDocumentId(windowId, pendingDocumentId)
    }
  }, [
    consumedDocumentId,
    pendingDocumentId,
    setWindowDocumentId,
    setWindowTitle,
    windowId,
  ])

  useEffect(() => {
    if (!windowId || !scanRoot || showStart) return
    setWindowTitle(windowId, `空间嗅探 — ${scanRoot}`)
  }, [scanRoot, setWindowTitle, showStart, windowId])

  const beginScan = useCallback(
    (path: string) => {
      const normalized = normalizeScanPath(path)
      if (!normalized) return
      setScanRoot(normalized)
      setShowStart(false)
      setConsumedDocumentId(normalized)
      if (windowId) {
        setWindowTitle(windowId, `空间嗅探 — ${normalized}`)
        setWindowDocumentId(windowId, normalized)
      }
    },
    [setWindowDocumentId, setWindowTitle, windowId],
  )

  const openNewScanWindow = useCallback(() => {
    openApp(APP_ID)
  }, [openApp])

  const showStartDialog = useCallback(() => {
    setShowStart(true)
  }, [])

  const definition = getAppDefinition(APP_ID)

  const menuBar = useMemo((): MenuDefinition[] => {
    return [
      {
        label: definition?.name ?? '空间嗅探',
        items: [
          ...aboutAppMenuPrefix(`关于 ${definition?.name ?? '空间嗅探'}`, () =>
            showBuiltinAbout(APP_ID),
          ),
          {
            type: 'action',
            label: '新建扫描窗口',
            shortcut: '⌘N',
            onClick: openNewScanWindow,
          },
          {
            type: 'action',
            label: '重新选择路径…',
            onClick: showStartDialog,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: `隐藏${definition?.name ?? '空间嗅探'}`,
            shortcut: '⌘H',
            onClick: () => windowId && minimizeWindow(windowId),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: `退出${definition?.name ?? '空间嗅探'}`,
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
      {
        label: '文件',
        items: [
          {
            type: 'action',
            label: '新建扫描窗口',
            shortcut: '⌘N',
            onClick: openNewScanWindow,
          },
          {
            type: 'action',
            label: '重新选择路径…',
            onClick: showStartDialog,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '关闭窗口',
            shortcut: '⌘W',
            onClick: () => windowId && closeWindow(windowId),
          },
        ],
      },
    ]
  }, [
    closeWindow,
    closeWindowsForApp,
    definition?.name,
    minimizeWindow,
    openNewScanWindow,
    showBuiltinAbout,
    showStartDialog,
    windowId,
  ])

  useAppMenuBar(APP_ID, menuBar)

  if (showStart || !scanRoot) {
    return (
      <div class="space-sniffer">
        <SpaceSnifferStartDialog
          initialPath={pendingDocumentId}
          onStart={beginScan}
          onCancel={scanRoot ? () => setShowStart(false) : undefined}
        />
      </div>
    )
  }

  return (
    <div class="space-sniffer">
      <SpaceSnifferView rootPath={scanRoot} onNewScan={openNewScanWindow} />
    </div>
  )
}

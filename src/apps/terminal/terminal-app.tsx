import { useCallback, useMemo, useRef, useState } from 'preact/hooks'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import {
  TERMINAL_FS_MODE_LABEL,
  type TerminalFsMode,
} from '../../terminal/terminal-fs-mode.ts'
import { TerminalReplPanel, type TerminalReplHandle } from './terminal-repl-panel.tsx'
import './terminal-repl-shell.css'

const APP_ID = 'terminal' as const
const WORKSPACE_ROOT = '/user'

function menuCheckPrefix(active: boolean): string {
  return active ? '✓ ' : ''
}

/** 系统终端：原生 QuickJS / Node 兼容运行时，可操作虚拟文件系统与宿主能力。 */
export function TerminalApp({ windowId: _windowId }: { windowId?: string }) {
  const handleRef = useRef<TerminalReplHandle | null>(null)
  const busyRef = useRef(false)
  const [fsMode, setFsMode] = useState<TerminalFsMode>('normal')
  const [canRevert, setCanRevert] = useState(false)

  const welcomeLines = useMemo(
    () => [
      '终端 · InstantREPL',
      `工作区 ${WORKSPACE_ROOT} · 回车执行 · ⌘K 清屏 · .reset 重建实例`,
      'instant.openApp / openPath / openUrl / listApps / listWindows / focus / close / …',
      'webview.listUnits / create({ url }) / show / hide / snapshot / markdown / eval / listTabs / openDevTools / …',
    ],
    [],
  )

  const clearScreen = useCallback(() => {
    handleRef.current?.clear()
  }, [])

  const resetInstance = useCallback(() => {
    void handleRef.current?.runCode('.reset')
  }, [])

  const handleAbort = useCallback(() => {
    handleRef.current?.abort()
  }, [])

  const handleRevert = useCallback(() => {
    void (async () => {
      const ok = await handleRef.current?.revertLastChanges()
      if (ok) {
        setCanRevert(false)
      }
    })()
  }, [])

  const menuBar = useMemo((): MenuDefinition[] => {
    const modeItems: TerminalFsMode[] = ['normal', 'readonly', 'controlled']

    return [
      {
        label: '编辑',
        items: [
          {
            type: 'action',
            label: '清屏',
            shortcut: '⌘K',
            onClick: clearScreen,
          },
          {
            type: 'action',
            label: '重建实例',
            onClick: resetInstance,
          },
          {
            type: 'action',
            label: '停止',
            disabled: !busyRef.current,
            onClick: handleAbort,
          },
          {
            type: 'action',
            label: '撤销上一轮改动',
            disabled: !canRevert || fsMode !== 'controlled',
            onClick: handleRevert,
          },
          { type: 'separator' },
          ...modeItems.map((mode) => ({
            type: 'action' as const,
            label: `${menuCheckPrefix(fsMode === mode)}${TERMINAL_FS_MODE_LABEL[mode]}模式`,
            onClick: () => setFsMode(mode),
          })),
        ],
      },
    ]
  }, [
    canRevert,
    clearScreen,
    fsMode,
    handleAbort,
    handleRevert,
    resetInstance,
  ])

  useAppMenuBar(APP_ID, menuBar)

  return (
    <div class="terminal-repl-app">
      <TerminalReplPanel
        workspaceRoot={WORKSPACE_ROOT}
        handleRef={handleRef}
        welcomeLines={welcomeLines}
        fsMode={fsMode}
        onChangesAvailable={setCanRevert}
      />
    </div>
  )
}

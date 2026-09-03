/**
 * 文件长操作进度：无窗口会话展开后的系统迷你窗正文。
 * 标题栏 / 拖动 / 关闭由 window-frame（dialog chrome）提供。
 */
import { useEffect, useMemo, useState } from 'preact/hooks'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs, useWindowCloseGuard } from '../../os/os-context.tsx'
import {
  FILES_OP_PROGRESS_APP_ID,
  getFilesOpProgressSession,
  subscribeFilesOpProgress,
} from './files-op-progress-session.ts'
import { FilesOpProgressPanel } from './files-op-progress-window.tsx'

export function FilesOpProgressApp({ windowId }: { windowId?: string }) {
  const { windows, activeWindowId } = useOs()
  const appWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.closing)
    : undefined
  const sessionId = appWindow?.documentId
  const isActiveWindow = windowId !== undefined && activeWindowId === windowId
  const [tick, setTick] = useState(0)

  useEffect(() => subscribeFilesOpProgress(() => setTick((value) => value + 1)), [])

  const state = sessionId ? getFilesOpProgressSession(sessionId) : undefined
  void tick

  useWindowCloseGuard(windowId, () => {
    state?.onCancel?.()
    return true
  })

  const menuBar = useMemo((): MenuDefinition[] => [], [])
  useAppMenuBar(FILES_OP_PROGRESS_APP_ID, menuBar, isActiveWindow)

  if (!state) {
    return <div class="files-op-progress-app files-op-progress-app--empty">没有正在进行的操作</div>
  }

  return (
    <div class="files-op-progress-app">
      <FilesOpProgressPanel state={state} />
    </div>
  )
}

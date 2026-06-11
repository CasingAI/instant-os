import type { IconContextMenuItem } from './icon-context-menu.tsx'
import type { AppId, WindowState } from './types.ts'

type DockContextMenuOptions = {
  isPinnedToDock: boolean
  onPinToDock?: () => void
  onUnpinFromDock?: () => void
}

export type WindowSubmenuOptions = {
  onClose: () => void
  onHide: () => void
  onMaximize: () => void
  onFullscreen: () => void
  hideDisabled?: boolean
  maximizeDisabled?: boolean
  fullscreenDisabled?: boolean
}

type WindowSubmenuActions = {
  closeWindow: (windowId: string) => void
  minimizeWindow: (windowId: string) => void
  toggleMaximize: (windowId: string) => void
  toggleFullscreen: (windowId: string) => void
  restoreWindow: (windowId: string) => void
}

function resolvePrimaryAppWindow(windows: WindowState[], appId: AppId): WindowState | undefined {
  return windows
    .filter((window) => window.appId === appId)
    .sort((left, right) => right.zIndex - left.zIndex)[0]
}

export function buildDockWindowSubmenuOptions(
  windows: WindowState[],
  appId: AppId,
  actions: WindowSubmenuActions,
): WindowSubmenuOptions | undefined {
  const target = resolvePrimaryAppWindow(windows, appId)
  if (!target) {
    return undefined
  }

  const runAfterRestoreIfMinimized = (action: (windowId: string) => void) => {
    if (target.minimized) {
      actions.restoreWindow(target.id)
      window.requestAnimationFrame(() => action(target.id))
      return
    }
    action(target.id)
  }

  return {
    onClose: () => actions.closeWindow(target.id),
    onHide: () => actions.minimizeWindow(target.id),
    onMaximize: () => runAfterRestoreIfMinimized(actions.toggleMaximize),
    onFullscreen: () => runAfterRestoreIfMinimized(actions.toggleFullscreen),
    hideDisabled: target.minimized,
    maximizeDisabled: target.fullscreen,
  }
}

function appendWindowSubmenuItems(
  items: IconContextMenuItem[],
  windowSubmenu: WindowSubmenuOptions | undefined,
): IconContextMenuItem[] {
  if (!windowSubmenu) {
    return items
  }

  return [
    ...items,
    { type: 'separator' },
    {
      type: 'submenu',
      label: '窗口',
      items: [
        { type: 'action', label: '关闭', onClick: windowSubmenu.onClose },
        {
          type: 'action',
          label: '隐藏',
          disabled: windowSubmenu.hideDisabled,
          onClick: windowSubmenu.onHide,
        },
        {
          type: 'action',
          label: '最大化',
          disabled: windowSubmenu.maximizeDisabled,
          onClick: windowSubmenu.onMaximize,
        },
        {
          type: 'action',
          label: '全屏',
          disabled: windowSubmenu.fullscreenDisabled,
          onClick: windowSubmenu.onFullscreen,
        },
      ],
    },
  ]
}

function appendDockContextMenuItems(
  items: IconContextMenuItem[],
  options: DockContextMenuOptions | undefined,
): IconContextMenuItem[] {
  if (!options) {
    return items
  }

  const dockItems: IconContextMenuItem[] = [{ type: 'separator' }]

  if (options.isPinnedToDock) {
    if (options.onUnpinFromDock) {
      dockItems.push({ type: 'action', label: '从程序坞中移除', onClick: options.onUnpinFromDock })
    }
  } else if (options.onPinToDock) {
    dockItems.push({ type: 'action', label: '保留在程序坞中', onClick: options.onPinToDock })
  }

  if (dockItems.length === 1) {
    return items
  }

  return [...items, ...dockItems]
}

function appendForceQuitItem(
  items: IconContextMenuItem[],
  onForceQuit: (() => void) | undefined,
): IconContextMenuItem[] {
  if (!onForceQuit) {
    return items
  }

  return [
    ...items,
    { type: 'separator' },
    { type: 'action', label: '退出', destructive: true, onClick: onForceQuit },
  ]
}

export function buildBuiltinIconContextMenuItems(
  onOpen: () => void,
  dockOptions?: DockContextMenuOptions,
  options?: { onForceQuit?: () => void; windowSubmenu?: WindowSubmenuOptions },
): IconContextMenuItem[] {
  const items = appendWindowSubmenuItems([{ type: 'action', label: '打开', onClick: onOpen }], options?.windowSubmenu)

  return appendDockContextMenuItems(
    appendForceQuitItem(items, options?.onForceQuit),
    dockOptions,
  )
}

export function buildGeneratedIconContextMenuItems(options: {
  onOpen: () => void
  onViewInMarketplace: () => void
  onUninstall?: () => void
  onForceQuit?: () => void
  openDisabled?: boolean
  isPinnedToDock?: boolean
  onPinToDock?: () => void
  onUnpinFromDock?: () => void
  windowSubmenu?: WindowSubmenuOptions
}): IconContextMenuItem[] {
  const items: IconContextMenuItem[] = [
    { type: 'action', label: '打开', disabled: options.openDisabled, onClick: options.onOpen },
    { type: 'separator' },
    { type: 'action', label: '在应用集市中查看', onClick: options.onViewInMarketplace },
  ]

  const withWindowSubmenu = appendWindowSubmenuItems(items, options.windowSubmenu)
  const withForceQuit = appendForceQuitItem(withWindowSubmenu, options.onForceQuit)

  const withDock = appendDockContextMenuItems(withForceQuit, {
    isPinnedToDock: options.isPinnedToDock ?? false,
    onPinToDock: options.onPinToDock,
    onUnpinFromDock: options.onUnpinFromDock,
  })

  if (options.onUninstall) {
    withDock.push(
      { type: 'separator' },
      { type: 'action', label: '卸载', destructive: true, onClick: options.onUninstall },
    )
  }

  return withDock
}

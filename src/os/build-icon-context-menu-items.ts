import type { IconContextMenuItem } from './icon-context-menu.tsx'

type DockContextMenuOptions = {
  isPinnedToDock: boolean
  onPinToDock?: () => void
  onUnpinFromDock?: () => void
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
  options?: { onForceQuit?: () => void },
): IconContextMenuItem[] {
  return appendDockContextMenuItems(
    appendForceQuitItem([{ type: 'action', label: '打开', onClick: onOpen }], options?.onForceQuit),
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
}): IconContextMenuItem[] {
  const items: IconContextMenuItem[] = [
    { type: 'action', label: '打开', disabled: options.openDisabled, onClick: options.onOpen },
    { type: 'separator' },
    { type: 'action', label: '在应用集市中查看', onClick: options.onViewInMarketplace },
  ]

  const withForceQuit = appendForceQuitItem(items, options.onForceQuit)

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

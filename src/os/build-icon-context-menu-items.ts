import type { IconContextMenuItem } from './icon-context-menu.tsx'

export function buildBuiltinIconContextMenuItems(onOpen: () => void): IconContextMenuItem[] {
  return [{ type: 'action', label: '打开', onClick: onOpen }]
}

export function buildGeneratedIconContextMenuItems(options: {
  onOpen: () => void
  onViewInMarketplace: () => void
  openDisabled?: boolean
}): IconContextMenuItem[] {
  return [
    { type: 'action', label: '打开', disabled: options.openDisabled, onClick: options.onOpen },
    { type: 'separator' },
    { type: 'action', label: '在应用集市中查看', onClick: options.onViewInMarketplace },
  ]
}
